import { ConflictException } from '@nestjs/common';
import { LedgerAccountType, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PaymentEngineService } from '../src/modules/payments/payment-engine.service';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { SANDBOX_TOKENS } from '../src/modules/payments/sandbox-psp.adapter';
import { createCustomer, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Phase 3 of the financial core: a captured payment must move real money in
 * the ledger and nowhere else; a declined one must move nothing at all. Both
 * sit behind the IN_FLIGHT idempotency protocol proven in isolation by
 * idempotency.int-spec.ts — these tests prove it end to end, wired to an
 * actual PSP call and actual ledger postings.
 */
describe('PaymentEngineService (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let payments: PaymentEngineService;
  let ledger: LedgerService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    payments = harness.app.get(PaymentEngineService);
    ledger = harness.app.get(LedgerService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  const balanceOf = async (params: {
    type: LedgerAccountType;
    partnerId?: string;
  }): Promise<string> => {
    const account = await prisma.ledgerAccount.findFirst({
      where: { type: params.type, partnerId: params.partnerId ?? null },
    });
    return (account?.balance ?? new Decimal(0)).toFixed(4);
  };

  it('captures a payment and posts a balanced ledger transaction', async () => {
    const { user } = await createCustomer(prisma);
    const partner = await createPartner(prisma);

    const result = await payments.capture({
      userId: user.id,
      partnerId: partner.id,
      amount: '10000',
      sourceToken: 'tok_visa_test',
      idempotencyKey: 'pay-1',
    });

    expect(result.status).toBe('CAPTURED');
    expect(result.pspReference).toBeDefined();
    // 250bps (the schema default) of 10000 is 250.
    expect(result.commissionAmount).toBe('250.0000');

    const stored = await prisma.payment.findUniqueOrThrow({ where: { id: result.paymentId } });
    expect(stored.status).toBe('CAPTURED');
    expect(stored.ledgerTransactionId).not.toBeNull();

    // `balance` is DEBIT-positive / CREDIT-negative throughout this ledger
    // (see ledger.int-spec.ts) — not normalized per account type. PSP_RECEIVABLE
    // was debited and reads positive; PARTNER_PAYABLE and PLATFORM_REVENUE
    // were credited and read negative even though both are liabilities the
    // platform owes, which is the point: the sign tells you the posting
    // direction, not who the number is "good news" for.
    expect(await balanceOf({ type: LedgerAccountType.PSP_RECEIVABLE })).toBe('10000.0000');
    expect(await balanceOf({ type: LedgerAccountType.PARTNER_PAYABLE, partnerId: partner.id })).toBe(
      '-9750.0000',
    );
    expect(await balanceOf({ type: LedgerAccountType.PLATFORM_REVENUE })).toBe('-250.0000');

    // The ledger's own invariant: debits equal credits on every transaction.
    const transaction = await prisma.ledgerTransaction.findUniqueOrThrow({
      where: { id: stored.ledgerTransactionId! },
      include: { postings: true },
    });
    const net = transaction.postings.reduce(
      (acc, p) => acc + (p.direction === 'DEBIT' ? 1 : -1) * Number(p.amount),
      0,
    );
    expect(net).toBe(0);
  });

  it('declines a payment and moves nothing in the ledger', async () => {
    const { user } = await createCustomer(prisma);
    const partner = await createPartner(prisma);

    const result = await payments.capture({
      userId: user.id,
      partnerId: partner.id,
      amount: '5000',
      sourceToken: SANDBOX_TOKENS.DECLINE_INSUFFICIENT_FUNDS,
      idempotencyKey: 'pay-decline-1',
    });

    expect(result.status).toBe('DECLINED');
    expect(result.declineReason).toBe('insufficient_funds');
    expect(result.commissionAmount).toBe('0.0000');

    const stored = await prisma.payment.findUniqueOrThrow({ where: { id: result.paymentId } });
    expect(stored.ledgerTransactionId).toBeNull();
    expect(await prisma.ledgerTransaction.count()).toBe(0);
    expect(await prisma.ledgerAccount.count()).toBe(0);
  });

  it('replays the stored result on a retried idempotency key instead of charging twice', async () => {
    const { user } = await createCustomer(prisma);
    const partner = await createPartner(prisma);
    const request = {
      userId: user.id,
      partnerId: partner.id,
      amount: '2000',
      sourceToken: 'tok_visa_test',
      idempotencyKey: 'pay-replay-1',
    };

    const first = await payments.capture(request);
    const second = await payments.capture(request);

    expect(second).toEqual(first);
    expect(await prisma.payment.count()).toBe(1);
    expect(await prisma.ledgerTransaction.count()).toBe(1);
    expect(await balanceOf({ type: LedgerAccountType.PSP_RECEIVABLE })).toBe('2000.0000');
  });

  it('rejects a reused idempotency key with a different amount', async () => {
    const { user } = await createCustomer(prisma);
    const partner = await createPartner(prisma);

    await payments.capture({
      userId: user.id,
      partnerId: partner.id,
      amount: '1000',
      sourceToken: 'tok_visa_test',
      idempotencyKey: 'pay-mismatch-1',
    });

    await expect(
      payments.capture({
        userId: user.id,
        partnerId: partner.id,
        amount: '2000',
        sourceToken: 'tok_visa_test',
        idempotencyKey: 'pay-mismatch-1',
      }),
    ).rejects.toThrow(ConflictException);

    // The mismatched retry must not have charged anything either.
    expect(await prisma.payment.count()).toBe(1);
  });

  it('captures each of several concurrently racing identical requests exactly once', async () => {
    const { user } = await createCustomer(prisma);
    const partner = await createPartner(prisma);
    const request = {
      userId: user.id,
      partnerId: partner.id,
      amount: '3000',
      sourceToken: 'tok_visa_test',
      idempotencyKey: 'pay-race-1',
    };

    const results = await Promise.allSettled([
      payments.capture(request),
      payments.capture(request),
      payments.capture(request),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    // Every caller either got the real result or a 409 for the one still in
    // flight — none silently vanished and none produced a second charge.
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    expect(await prisma.payment.count()).toBe(1);
    expect(await prisma.ledgerTransaction.count()).toBe(1);
    expect(await balanceOf({ type: LedgerAccountType.PSP_RECEIVABLE })).toBe('3000.0000');
  });

  it('refuses to charge an inactive partner before ever calling the PSP', async () => {
    const { user } = await createCustomer(prisma);
    const partner = await createPartner(prisma);
    await prisma.partner.update({ where: { id: partner.id }, data: { isActive: false } });

    await expect(
      payments.capture({
        userId: user.id,
        partnerId: partner.id,
        amount: '1000',
        sourceToken: 'tok_visa_test',
        idempotencyKey: 'pay-inactive-1',
      }),
    ).rejects.toThrow('This partner is not currently active');

    expect(await prisma.payment.count()).toBe(0);
  });

  it('leaves the idempotency key immediately retryable after a PSP outage', async () => {
    const { user } = await createCustomer(prisma);
    const partner = await createPartner(prisma);
    const request = {
      userId: user.id,
      partnerId: partner.id,
      amount: '1500',
      sourceToken: SANDBOX_TOKENS.PSP_UNAVAILABLE,
      idempotencyKey: 'pay-outage-1',
    };

    await expect(payments.capture(request)).rejects.toThrow();
    expect(await prisma.payment.count()).toBe(0);
    expect(await prisma.idempotencyRecord.count()).toBe(0);

    // Same key, PSP is back — must go through cleanly, not 409.
    const recovered = await payments.capture({ ...request, sourceToken: 'tok_visa_test' });
    expect(recovered.status).toBe('CAPTURED');
  });

  it('reconciles account balances against a full replay of their postings', async () => {
    const { user } = await createCustomer(prisma);
    const partnerA = await createPartner(prisma, { displayName: 'A' });
    const partnerB = await createPartner(prisma, { displayName: 'B' });

    await payments.capture({
      userId: user.id,
      partnerId: partnerA.id,
      amount: '4000',
      sourceToken: 'tok_visa_test',
      idempotencyKey: 'pay-recon-a',
    });
    await payments.capture({
      userId: user.id,
      partnerId: partnerB.id,
      amount: '6000',
      sourceToken: 'tok_visa_test',
      idempotencyKey: 'pay-recon-b',
    });

    const pspAccount = await prisma.ledgerAccount.findFirstOrThrow({
      where: { type: LedgerAccountType.PSP_RECEIVABLE },
    });
    const replayed = await ledger.replayBalance(pspAccount.id);
    expect(replayed.toFixed(4)).toBe('10000.0000');
    expect(pspAccount.balance.toFixed(4)).toBe(replayed.toFixed(4));
  });
});
