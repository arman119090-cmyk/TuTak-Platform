import { PaymentRoute, PrismaClient, PspAttemptStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PspPaymentService } from '../src/modules/psp/psp-payment.service';
import { PurchaseIntentsService } from '../src/modules/purchase-intents/purchase-intents.service';
import { createCustomer, createPartner, createStaffUser } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Audit of 21.09.2026, D06: an EXPIRED attempt with nothing in the inbox used
 * to read WAITING_PROVIDER to the customer — "still waiting for the provider
 * to confirm" — when nobody was waiting any more and the money may or may
 * not have moved. It now reads UNRESOLVED, with the pay button withheld,
 * the same as before: EXPIRED was always in the unsafe set.
 */
describe('Audit 21.09 — an expired PSP attempt is UNRESOLVED to the customer (D06)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let psp: PspPaymentService;
  let intents: PurchaseIntentsService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    psp = harness.app.get(PspPaymentService);
    intents = harness.app.get(PurchaseIntentsService);
  });

  afterAll(async () => {
    await harness.close();
  });

  let partnerId = '';
  let staffId = '';

  beforeEach(async () => {
    await truncateAll(prisma);
    partnerId = (await createPartner(prisma)).id;
    staffId = (await createStaffUser(prisma)).id;
  });

  async function attemptIn(status: PspAttemptStatus, billId: string) {
    const customer = await createCustomer(prisma);
    const intent = await intents.create(
      { partnerId, grossAmount: '15000', paymentRoute: PaymentRoute.TUTAK_PSP },
      customer.user.id,
    );
    await intents.approveForPayment(intent.id, staffId, {});
    await prisma.pspPaymentAttempt.create({
      data: {
        purchaseIntentId: intent.id,
        provider: 'idram',
        status,
        amount: new Decimal('15000'),
        providerBillId: billId,
        liveKey: status === PspAttemptStatus.INITIATED ? 'live' : null,
        resolvedAt: status === PspAttemptStatus.INITIATED ? null : new Date(),
      },
    });
    return { intent, customerId: customer.user.id };
  }

  it('EXPIRED reads UNRESOLVED, with no way to pay again', async () => {
    const { intent, customerId } = await attemptIn(PspAttemptStatus.EXPIRED, 'bill-expired');
    const status = await psp.customerPaymentStatus(intent.id, customerId);
    expect(status.state).toBe('UNRESOLVED');
    expect(status.canBeginPayment).toBe(false);
  });

  it('INITIATED still reads WAITING_PROVIDER; REQUIRES_RECONCILIATION still reads as such', async () => {
    const live = await attemptIn(PspAttemptStatus.INITIATED, 'bill-live');
    expect((await psp.customerPaymentStatus(live.intent.id, live.customerId)).state).toBe('WAITING_PROVIDER');
    const flagged = await attemptIn(PspAttemptStatus.REQUIRES_RECONCILIATION, 'bill-flagged');
    expect((await psp.customerPaymentStatus(flagged.intent.id, flagged.customerId)).state).toBe(
      'REQUIRES_RECONCILIATION',
    );
  });
});
