import {
  PaymentRoute,
  PrismaClient,
  PspAttemptStatus,
  PspResolutionBasis,
  PurchaseIntentStatus,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PspAttemptAgeingService } from '../src/modules/psp/psp-attempt-ageing.service';
import { PspPaymentService } from '../src/modules/psp/psp-payment.service';
import { PurchaseIntentRefundService } from '../src/modules/purchase-intents/purchase-intent-refund.service';
import { PurchaseIntentsService } from '../src/modules/purchase-intents/purchase-intents.service';
import { createCustomer, createPartner, createStaffUser } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Two of Arman's decisions of 15.09.2026, both stated as nevers, both tested
 * where a never has to live — in the database as well as in the service.
 *
 *  - **Time never resolves a payment.** A timeout is the absence of an
 *    answer, not the answer "no". Ageing escalates and never releases.
 *  - **A provider-collected purchase is not refunded by hand or in points.**
 *    Until the provider's refund API is confirmed to exist, the honest
 *    behaviour is to refuse and say so.
 */
describe('PSP timeouts and refunds (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let psp: PspPaymentService;
  let ageing: PspAttemptAgeingService;
  let intents: PurchaseIntentsService;
  let refunds: PurchaseIntentRefundService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    psp = harness.app.get(PspPaymentService);
    ageing = harness.app.get(PspAttemptAgeingService);
    intents = harness.app.get(PurchaseIntentsService);
    refunds = harness.app.get(PurchaseIntentRefundService);
  });

  afterAll(async () => {
    await harness.close();
  });

  let partnerId = '';
  let staffId = '';
  let financeA = '';
  let financeB = '';

  beforeEach(async () => {
    await truncateAll(prisma);
    partnerId = (await createPartner(prisma)).id;
    staffId = (await createStaffUser(prisma)).id;
    financeA = (await createStaffUser(prisma)).id;
    financeB = (await createStaffUser(prisma)).id;
  });

  /** A provider-routed purchase with an attempt opened `ageMinutes` ago. */
  async function attemptAged(ageMinutes: number, billId: string) {
    const customer = await createCustomer(prisma);
    const intent = await intents.create(
      { partnerId, grossAmount: '15000', paymentRoute: PaymentRoute.TUTAK_PSP },
      customer.user.id,
    );
    const attempt = await prisma.pspPaymentAttempt.create({
      data: {
        purchaseIntentId: intent.id,
        provider: 'idram',
        status: PspAttemptStatus.INITIATED,
        amount: new Decimal('15000'),
        providerBillId: billId,
        liveKey: 'live',
      },
    });
    // Backdated rather than waited for. The sweep reads `createdAt`.
    await prisma.$executeRawUnsafe(
      'UPDATE "psp_payment_attempts" SET "createdAt" = $1 WHERE "id" = $2',
      new Date(Date.now() - ageMinutes * 60_000),
      attempt.id,
    );
    return { intent, attempt };
  }

  // ── Time never resolves ────────────────────────────────────────────────

  describe('ageing', () => {
    it('times a stale attempt out without calling it a failure', async () => {
      const { intent, attempt } = await attemptAged(90, 'bill-stale');

      const result = await ageing.escalateStaleAttempts();
      expect(result.expired).toBe(1);

      const after = await prisma.pspPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
      expect(after.status).toBe(PspAttemptStatus.EXPIRED);
      // The whole point: EXPIRED is not FAILED, and nothing claims to know
      // what the provider did.
      expect(after.resolutionBasis).toBeNull();
      // So the purchase is still not safe for another route.
      expect(await psp.hasUnsafeAttempt(intent.id)).toBe(true);
    });

    it('leaves a young attempt alone', async () => {
      const { attempt } = await attemptAged(5, 'bill-young');
      await ageing.escalateStaleAttempts();

      const after = await prisma.pspPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
      expect(after.status).toBe(PspAttemptStatus.INITIATED);
      expect(after.escalationCount).toBe(0);
    });

    it('escalates, gets louder, and still never resolves anything', async () => {
      const { attempt } = await attemptAged(90, 'bill-loud');

      for (let round = 0; round < 6; round += 1) {
        await ageing.escalateStaleAttempts();
        // Push the escalation clock back so the next round is due.
        await prisma.$executeRawUnsafe(
          'UPDATE "psp_payment_attempts" SET "escalatedAt" = $1 WHERE "id" = $2',
          new Date(Date.now() - 4 * 60 * 60_000),
          attempt.id,
        );
      }

      const after = await prisma.pspPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
      expect(after.escalationCount).toBe(6);
      expect(after.status).toBe(PspAttemptStatus.EXPIRED);
      expect(after.resolutionBasis).toBeNull();

      // It got louder on the way: warnings first, critical once it had been
      // ignored for long enough.
      const raised = harness.alerts.matching('psp.attempt-unresolved');
      expect(raised.length).toBeGreaterThanOrEqual(2);
      expect(raised.some((a) => a.severity === 'critical')).toBe(true);
    });

    it('never touches an attempt the provider already answered', async () => {
      const { attempt } = await attemptAged(90, 'bill-answered');
      await prisma.pspPaymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: PspAttemptStatus.FAILED,
          resolutionBasis: PspResolutionBasis.PROVIDER_CALLBACK,
          failureReason: 'Declined by issuer',
          liveKey: null,
          resolvedAt: new Date(),
        },
      });

      const result = await ageing.escalateStaleAttempts();
      expect(result.escalated).toBe(0);
      const after = await prisma.pspPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
      expect(after.escalationCount).toBe(0);
    });

    it('refuses at the database level to fail an attempt on age alone', async () => {
      const { attempt } = await attemptAged(90, 'bill-cannot-fail');

      // Exactly what a well-meaning cleanup script would try.
      await expect(
        prisma.pspPaymentAttempt.update({
          where: { id: attempt.id },
          data: {
            status: PspAttemptStatus.FAILED,
            failureReason: 'timed out',
            liveKey: null,
            resolvedAt: new Date(),
          },
        }),
      ).rejects.toThrow(/a timeout is not a provider saying no/i);
    });

    it('refuses at the database level to change status and escalate in one write', async () => {
      const { attempt } = await attemptAged(90, 'bill-two-things');

      await expect(
        prisma.pspPaymentAttempt.update({
          where: { id: attempt.id },
          data: {
            status: PspAttemptStatus.EXPIRED,
            liveKey: null,
            resolvedAt: new Date(),
            escalationCount: { increment: 1 },
          },
        }),
      ).rejects.toThrow(/cannot change status and escalate in one write/i);
    });
  });

  // ── The only two ways out ──────────────────────────────────────────────

  describe('releasing a timed-out attempt', () => {
    it('takes two people and evidence', async () => {
      const { intent, attempt } = await attemptAged(90, 'bill-release');
      await ageing.escalateStaleAttempts();

      await expect(
        psp.reconcileAttemptManually({
          attemptId: attempt.id,
          reconciledByUserId: financeA,
          checkedByUserId: financeA,
          evidence: 'Idram portal shows no transaction for this bill',
        }),
      ).rejects.toThrow(/two different people/i);

      await expect(
        psp.reconcileAttemptManually({
          attemptId: attempt.id,
          reconciledByUserId: financeA,
          checkedByUserId: financeB,
          evidence: '   ',
        }),
      ).rejects.toThrow(/evidence is required/i);

      // Still blocked while nobody has done it properly.
      expect(await psp.hasUnsafeAttempt(intent.id)).toBe(true);
    });

    it('releases the purchase once two people have read the provider’s record', async () => {
      const { intent, attempt } = await attemptAged(90, 'bill-released');
      await ageing.escalateStaleAttempts();

      const released = await psp.reconcileAttemptManually({
        attemptId: attempt.id,
        reconciledByUserId: financeA,
        checkedByUserId: financeB,
        evidence: 'Idram portal, 2026-09-15: no transaction exists for bill-released',
      });

      expect(released.status).toBe(PspAttemptStatus.FAILED);
      expect(released.resolutionBasis).toBe(PspResolutionBasis.MANUAL_RECONCILIATION);
      expect(released.reconciledByUserId).toBe(financeA);
      expect(released.reconciliationCheckedByUserId).toBe(financeB);
      expect(await psp.hasUnsafeAttempt(intent.id)).toBe(false);

      // And the customer may buy at that business again.
      await prisma.purchaseIntent.update({
        where: { id: intent.id },
        data: { status: PurchaseIntentStatus.EXPIRED },
      });
      await expect(
        intents.create({ partnerId, grossAmount: '5000' }, intent.customerId),
      ).resolves.toBeDefined();
    });

    it('never lets a human assert that a payment succeeded', async () => {
      const { attempt } = await attemptAged(90, 'bill-no-success');
      await ageing.escalateStaleAttempts();

      // There is no method for it, and the table refuses the shape: money
      // arriving is settled by a verified provider confirmation, never on
      // somebody's word.
      await expect(
        prisma.pspPaymentAttempt.update({
          where: { id: attempt.id },
          data: {
            status: PspAttemptStatus.SUCCEEDED,
            resolutionBasis: PspResolutionBasis.MANUAL_RECONCILIATION,
            reconciledByUserId: financeA,
            reconciliationCheckedByUserId: financeB,
            reconciliationEvidence: 'we think it worked',
          },
        }),
      ).rejects.toThrow();
    });

    it('refuses to reconcile an attempt that is still live', async () => {
      const { attempt } = await attemptAged(5, 'bill-still-live');

      await expect(
        psp.reconcileAttemptManually({
          attemptId: attempt.id,
          reconciledByUserId: financeA,
          checkedByUserId: financeB,
          evidence: 'looks stuck',
        }),
      ).rejects.toThrow(/only a timed-out or disputed attempt/i);
    });
  });

  // ── Refunds ────────────────────────────────────────────────────────────

  describe('refunding a provider-collected purchase', () => {
    it('refuses, and says not to do it by hand or in points', async () => {
      const customer = await createCustomer(prisma);
      const intent = await intents.create(
        { partnerId, grossAmount: '15000', paymentRoute: PaymentRoute.TUTAK_PSP },
        customer.user.id,
      );
      await prisma.pspPaymentAttempt.create({
        data: {
          purchaseIntentId: intent.id,
          provider: 'idram',
          status: PspAttemptStatus.INITIATED,
          amount: new Decimal('15000'),
          providerBillId: 'bill-refund',
          liveKey: 'live',
        },
      });
      await psp.settleVerifiedConfirmation({
        billId: 'bill-refund',
        providerTransactionId: 'IDRAM-REFUND',
        amount: new Decimal('15000'),
        raw: {},
      });

      await expect(
        refunds.refund({
          purchaseIntentId: intent.id,
          reason: 'Customer changed their mind',
          actorId: staffId,
          idempotencyKey: 'refund-key-1',
        }),
      ).rejects.toThrow(/not available yet.*do not refund it by hand or\s+in bonus points/is);

      // Nothing was reversed behind the refusal.
      expect(await prisma.ledgerTransaction.count({ where: { kind: /* reversal */ 'partner.contribution_refund' } })).toBe(0);
    });

    it('still refunds an ordinary partner-direct purchase', async () => {
      const customer = await createCustomer(prisma);
      const intent = await intents.create({ partnerId, grossAmount: '10000' }, customer.user.id);
      await intents.confirm(intent.id, staffId);

      await expect(
        refunds.refund({
          purchaseIntentId: intent.id,
          reason: 'Customer changed their mind',
          actorId: staffId,
          idempotencyKey: 'refund-key-2',
        }),
      ).resolves.toBeDefined();
    });
  });
});
