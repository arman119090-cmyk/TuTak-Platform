import { PaymentStatus, PrismaClient } from '@prisma/client';
import { PaymentEngineService } from '../src/modules/payments/payment-engine.service';
import { createCustomer, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * What happens to an idempotency key when the database dies mid-capture.
 *
 * `IdempotencyService` writes its record in a **different transaction** from
 * the work it protects, and its failure path deletes the record so the next
 * attempt can claim cleanly. Both are reasonable in isolation and together
 * they leave a window: the payment commits, the record is then deleted or
 * never marked COMPLETED, and the key's only memory is gone. A retry — which
 * is exactly what a client does when its request times out — then finds
 * nothing and charges the customer again.
 *
 * This is not theoretical. `scripts/chaos-postgres.sh` stopped Postgres with
 * `-m immediate` under load and produced precisely one payment with no
 * idempotency record behind it, out of 5,220. Replaying that key produced a
 * second charge.
 *
 * The fix is to stop treating a separate table as the guarantee. The key now
 * lives on the payment under a unique index, so the database refuses the
 * second charge whatever happened to the record. These tests construct that
 * state directly rather than racing for it — a race that reproduces once in
 * five thousand attempts is not a test, it is a lottery.
 */
describe('Payment idempotency key durability (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let payments: PaymentEngineService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    payments = harness.app.get(PaymentEngineService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    await harness.resetAlerts();
    jest.restoreAllMocks();
  });

  const setup = async () => {
    const { user } = await createCustomer(prisma);
    const partner = await createPartner(prisma);
    return { user, partner };
  };

  it('refuses to charge twice when the idempotency record has been lost', async () => {
    const { user, partner } = await setup();
    const key = 'key-lost-record';

    const first = await payments.capture({
      userId: user.id,
      partnerId: partner.id,
      amount: '1000.00',
      sourceToken: 'tok_ok',
      idempotencyKey: key,
    });
    expect(first.status).toBe(PaymentStatus.CAPTURED);

    // Exactly what the crash window leaves behind: the money is committed,
    // the record that remembered it is not there.
    const removed = await prisma.idempotencyRecord.deleteMany({ where: { key } });
    expect(removed.count).toBe(1);

    const retry = await payments.capture({
      userId: user.id,
      partnerId: partner.id,
      amount: '1000.00',
      sourceToken: 'tok_ok',
      idempotencyKey: key,
    });

    // The same payment, not a new one. Before the key was stored on the
    // payment this returned a second paymentId and the customer was charged
    // 2,000 for a 1,000 purchase.
    expect(retry.paymentId).toBe(first.paymentId);
    await expect(prisma.payment.count({ where: { userId: user.id } })).resolves.toBe(1);
  });

  it('does not charge twice when the record is stuck IN_FLIGHT and its lease lapses', async () => {
    const { user, partner } = await setup();
    const key = 'key-stuck-in-flight';

    const first = await payments.capture({
      userId: user.id,
      partnerId: partner.id,
      amount: '1000.00',
      sourceToken: 'tok_ok',
      idempotencyKey: key,
    });

    // The other half of the window: the payment committed but the update to
    // COMPLETED never landed, so the record still claims the work is running.
    // Backdated past the lease so the next attempt reclaims it rather than
    // refusing with a conflict.
    await prisma.idempotencyRecord.updateMany({
      where: { key },
      data: { status: 'IN_FLIGHT', responseBody: undefined, createdAt: new Date(Date.now() - 60 * 60 * 1000) },
    });

    const retry = await payments.capture({
      userId: user.id,
      partnerId: partner.id,
      amount: '1000.00',
      sourceToken: 'tok_ok',
      idempotencyKey: key,
    });

    expect(retry.paymentId).toBe(first.paymentId);
    await expect(prisma.payment.count({ where: { userId: user.id } })).resolves.toBe(1);
  });

  it('records the key on the payment so a lost record can be reconciled', async () => {
    const { user, partner } = await setup();

    const result = await payments.capture({
      userId: user.id,
      partnerId: partner.id,
      amount: '750.00',
      sourceToken: 'tok_ok',
      idempotencyKey: 'key-on-the-row',
    });

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: result.paymentId } });
    expect(payment.idempotencyKey).toBe('key-on-the-row');
  });

  it('keeps one customer’s key from colliding with another’s', async () => {
    const { user: first, partner } = await setup();
    const { user: second } = await createCustomer(prisma);

    // Two clients picking the same key is not a conflict — a key is only ever
    // a promise about one caller's own retries. Scoping the unique index to
    // the user is what keeps `capture` from handing customer B customer A's
    // payment.
    const a = await payments.capture({
      userId: first.id,
      partnerId: partner.id,
      amount: '100.00',
      sourceToken: 'tok_ok',
      idempotencyKey: 'shared-key',
    });
    const b = await payments.capture({
      userId: second.id,
      partnerId: partner.id,
      amount: '100.00',
      sourceToken: 'tok_ok',
      idempotencyKey: 'shared-key',
    });

    expect(b.paymentId).not.toBe(a.paymentId);
    await expect(prisma.payment.count()).resolves.toBe(2);
  });

  it('leaves a declined payment replayable rather than chargeable again', async () => {
    const { user, partner } = await setup();
    const key = 'key-declined';

    const declined = await payments.capture({
      userId: user.id,
      partnerId: partner.id,
      amount: '500.00',
      sourceToken: 'tok_decline_generic',
      idempotencyKey: key,
    });
    expect(declined.status).toBe(PaymentStatus.DECLINED);

    await prisma.idempotencyRecord.deleteMany({ where: { key } });

    const retry = await payments.capture({
      userId: user.id,
      partnerId: partner.id,
      amount: '500.00',
      sourceToken: 'tok_decline_generic',
      idempotencyKey: key,
    });

    // A decline moved no money, so replaying it is harmless — but it must
    // still be the same decline rather than a second trip to the acquirer,
    // which is what a card-testing attacker would want.
    expect(retry.paymentId).toBe(declined.paymentId);
    await expect(prisma.payment.count({ where: { userId: user.id } })).resolves.toBe(1);
  });
});
