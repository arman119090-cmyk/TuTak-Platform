import { PaymentRoute, PrismaClient, PurchaseIntentStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PartnerContributionRuleService } from '../src/modules/partners/contribution/partner-contribution-rule.service';
import { PspPaymentService } from '../src/modules/psp/psp-payment.service';
import { PurchaseIntentRefundService } from '../src/modules/purchase-intents/purchase-intent-refund.service';
import { PurchaseIntentsService } from '../src/modules/purchase-intents/purchase-intents.service';
import { ContributionRuleKind, PspAttemptStatus, UnitOfMeasure } from '@prisma/client';
import { createCustomer, createPartner, createStaffUser } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Who a financial action is attributed to, and the ways it must not be
 * decidable by the caller.
 *
 * The rule set on 15.09.2026: an actor comes from the authenticated
 * request, never from a field in the body. These tests hold the *service*
 * layer to the shape that makes that enforceable — a method that accepts two
 * actor ids in one call can be driven by one person however careful the
 * controller above it is.
 */
describe('Actor identity on money paths (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let psp: PspPaymentService;
  let intents: PurchaseIntentsService;
  let rules: PartnerContributionRuleService;
  let refunds: PurchaseIntentRefundService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    psp = harness.app.get(PspPaymentService);
    intents = harness.app.get(PurchaseIntentsService);
    rules = harness.app.get(PartnerContributionRuleService);
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

  describe('two-person acts cannot be driven by one caller', () => {
    it('has no PSP reconciliation method that takes both people at once', () => {
      // The shape *is* the guarantee. A single method accepting
      // `reconciledByUserId` and `checkedByUserId` was the previous design,
      // and it let one authenticated caller type the second person's name.
      const service = psp as unknown as Record<string, unknown>;
      expect(typeof service.proposeManualReconciliation).toBe('function');
      expect(typeof service.confirmManualReconciliation).toBe('function');
      expect(service.reconcileAttemptManually).toBeUndefined();

      // Each half takes exactly one actor: (params) with a single actorId.
      expect(psp.proposeManualReconciliation.length).toBe(1);
      expect(psp.confirmManualReconciliation.length).toBe(1);
    });

    it('refuses a contribution rule approved by its own proposer', async () => {
      const proposal = await rules.propose({
        partnerId,
        actorId: financeA,
        kind: ContributionRuleKind.FIXED_PER_UNIT,
        fixedPerUnit: '10',
        unit: UnitOfMeasure.LITER,
      });

      await expect(rules.approve(proposal.id, { actorId: financeA })).rejects.toThrow(
        /second person has to approve/i,
      );
      expect(await rules.liveRule(partnerId)).toBeNull();

      await expect(rules.approve(proposal.id, { actorId: financeB })).resolves.toMatchObject({
        version: 1,
      });
    });

    it('refuses a PSP reconciliation confirmed by its own proposer', async () => {
      const attempt = await unresolvedAttempt('bill-actor');

      await psp.proposeManualReconciliation({
        attemptId: attempt.id,
        actorId: financeA,
        evidence: 'No transaction on the portal',
      });
      await expect(
        psp.confirmManualReconciliation({ attemptId: attempt.id, actorId: financeA }),
      ).rejects.toThrow(/second person has to confirm/i);

      // Still unresolved, so the purchase is still held.
      expect(
        (await prisma.pspPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).status,
      ).toBe(PspAttemptStatus.EXPIRED);
    });

    it('will not let a re-proposal be confirmed by the person who made it', async () => {
      const attempt = await unresolvedAttempt('bill-repropose');

      await psp.proposeManualReconciliation({
        attemptId: attempt.id,
        actorId: financeA,
        evidence: 'First reading',
      });
      // Somebody re-reads the statement and proposes again. The earlier
      // confirmation intent is void: what B was about to confirm is not what
      // is on the record any more.
      await psp.proposeManualReconciliation({
        attemptId: attempt.id,
        actorId: financeB,
        evidence: 'Second reading, more careful',
      });

      await expect(
        psp.confirmManualReconciliation({ attemptId: attempt.id, actorId: financeB }),
      ).rejects.toThrow(/second person has to confirm/i);

      const resolved = await psp.confirmManualReconciliation({
        attemptId: attempt.id,
        actorId: financeA,
      });
      expect(resolved.reconciledByUserId).toBe(financeB);
      expect(resolved.reconciliationCheckedByUserId).toBe(financeA);
    });

    it('refuses at the database level to write both halves in one statement', async () => {
      const attempt = await unresolvedAttempt('bill-db-both');

      await expect(
        prisma.pspPaymentAttempt.update({
          where: { id: attempt.id },
          data: {
            status: PspAttemptStatus.FAILED,
            resolutionBasis: 'MANUAL_RECONCILIATION',
            reconciledByUserId: financeA,
            reconciliationCheckedByUserId: financeA,
            reconciliationEvidence: 'both at once',
            reconciliationProposedAt: new Date(),
          },
        }),
      ).rejects.toThrow();
    });
  });

  // ── §13: the direct refund path is untouched ───────────────────────────

  describe('DIRECT refunds still work exactly as before', () => {
    it('refunds an ordinary cash purchase end to end', async () => {
      const customer = await createCustomer(prisma);
      const intent = await intents.create({ partnerId, grossAmount: '10000' }, customer.user.id);
      await intents.confirm(intent.id, staffId);

      const result = await refunds.refund({
        purchaseIntentId: intent.id,
        reason: 'Customer changed their mind',
        actorId: staffId,
        idempotencyKey: 'direct-refund-1',
      });
      expect(result).toBeDefined();

      // The reversal posted, and the partner's contribution came back.
      expect(
        await prisma.ledgerTransaction.count({ where: { kind: 'partner.contribution_refund' } }),
      ).toBe(1);
    });

    it('is idempotent on the same key', async () => {
      const customer = await createCustomer(prisma);
      const intent = await intents.create({ partnerId, grossAmount: '10000' }, customer.user.id);
      await intents.confirm(intent.id, staffId);

      const first = await refunds.refund({
        purchaseIntentId: intent.id,
        reason: 'Changed their mind',
        actorId: staffId,
        idempotencyKey: 'direct-refund-idem',
      });
      const second = await refunds.refund({
        purchaseIntentId: intent.id,
        reason: 'Changed their mind',
        actorId: staffId,
        idempotencyKey: 'direct-refund-idem',
      });
      expect(second).toEqual(first);
      expect(
        await prisma.ledgerTransaction.count({ where: { kind: 'partner.contribution_refund' } }),
      ).toBe(1);
    });

    it('still refuses a provider-collected purchase, and says why', async () => {
      const customer = await createCustomer(prisma);
      const intent = await intents.create(
        { partnerId, grossAmount: '10000', paymentRoute: PaymentRoute.TUTAK_PSP },
        customer.user.id,
      );
      await intents.approveForPayment(intent.id, staffId, {});
      await prisma.pspPaymentAttempt.create({
        data: {
          purchaseIntentId: intent.id,
          provider: 'idram',
          status: PspAttemptStatus.INITIATED,
          amount: new Decimal('10000'),
          providerBillId: 'bill-refund-blocked',
          liveKey: 'live',
        },
      });
      await psp.settleVerifiedConfirmation({
        billId: 'bill-refund-blocked',
        providerTransactionId: 'IDRAM-RB',
        amount: new Decimal('10000'),
        raw: {},
      });

      await expect(
        refunds.refund({
          purchaseIntentId: intent.id,
          reason: 'Changed their mind',
          actorId: staffId,
          idempotencyKey: 'psp-refund-blocked',
        }),
      ).rejects.toThrow(/do not refund it by hand or\s+in bonus points/is);

      // And the purchase is untouched — a refused refund reverses nothing.
      expect(
        (await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intent.id } })).status,
      ).toBe(PurchaseIntentStatus.CONFIRMED);
      expect(
        await prisma.ledgerTransaction.count({ where: { kind: 'partner.contribution_refund' } }),
      ).toBe(0);
    });
  });

  /** A purchase whose provider attempt timed out with nothing resolved. */
  async function unresolvedAttempt(billId: string) {
    const customer = await createCustomer(prisma);
    const intent = await intents.create(
      { partnerId, grossAmount: '15000', paymentRoute: PaymentRoute.TUTAK_PSP },
      customer.user.id,
    );
    await intents.approveForPayment(intent.id, staffId, {});
    return prisma.pspPaymentAttempt.create({
      data: {
        purchaseIntentId: intent.id,
        provider: 'idram',
        status: PspAttemptStatus.EXPIRED,
        amount: new Decimal('15000'),
        providerBillId: billId,
        resolvedAt: new Date(),
      },
    });
  }
});
