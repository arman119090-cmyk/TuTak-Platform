import {
  LedgerAccountType,
  PartnerSettlementStatus,
  PostingDirection,
  PrismaClient,
  ReconciliationOutcome,
  ReconciliationSource,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PartnerSettlementService } from '../src/modules/partner-settlements/partner-settlement.service';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { createPartner, createStaffUser } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * The settlement engine's hard invariants, against real PostgreSQL.
 *
 * Every assertion here is about money that must not move twice or vanish.
 * They are integration tests and not unit tests on purpose: the guarantees
 * being tested live in the database — unique indexes, CHECK constraints and
 * triggers — and a mocked Prisma would assert that the mock behaves, which is
 * exactly the reassurance nobody needs.
 */
describe('PartnerSettlementService (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let settlements: PartnerSettlementService;
  let ledger: LedgerService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    settlements = harness.app.get(PartnerSettlementService);
    ledger = harness.app.get(LedgerService);
  });

  afterAll(async () => {
    await harness.close();
  });

  let partnerId = '';
  let maker = '';
  let checker = '';
  /** A person on the partner's side — the payee, never the arbiter. */
  let partnerUser = '';

  beforeEach(async () => {
    await truncateAll(prisma);
    const partner = await createPartner(prisma);
    partnerId = partner.id;
    maker = (await createStaffUser(prisma)).id;
    checker = (await createStaffUser(prisma)).id;
    partnerUser = (await createStaffUser(prisma)).id;
    await prisma.partnerBankAccount.create({
      data: {
        partnerId,
        beneficiaryName: 'ООО Тест',
        accountNumber: 'AM00 0000 0000 0000',
        bankName: 'Тестбанк',
        createdByUserId: maker,
      },
    });
  });

  /** Credits the partner's payable the way a confirmed purchase does. */
  async function accrue(amount: string, kind = 'partner.bonus_redemption_compensation') {
    const [payable, bonus] = await Promise.all([
      ledger.accountFor({ type: LedgerAccountType.PARTNER_PAYABLE, partnerId }),
      ledger.accountFor({ type: LedgerAccountType.BONUS_LIABILITY }),
    ]);
    return ledger.post({
      kind,
      sourceType: 'PurchaseIntent',
      sourceId: `purchase-${Math.random().toString(36).slice(2)}`,
      postings: [
        { accountId: bonus.id, direction: PostingDirection.DEBIT, amount: new Decimal(amount) },
        { accountId: payable.id, direction: PostingDirection.CREDIT, amount: new Decimal(amount) },
      ],
    });
  }

  /** Debits it the way a refund does. */
  async function deduct(amount: string, kind = 'partner.bonus_redemption_compensation_refund') {
    const [payable, bonus] = await Promise.all([
      ledger.accountFor({ type: LedgerAccountType.PARTNER_PAYABLE, partnerId }),
      ledger.accountFor({ type: LedgerAccountType.BONUS_LIABILITY }),
    ]);
    return ledger.post({
      kind,
      sourceType: 'PurchaseIntentRefund',
      sourceId: `refund-${Math.random().toString(36).slice(2)}`,
      postings: [
        { accountId: payable.id, direction: PostingDirection.DEBIT, amount: new Decimal(amount) },
        { accountId: bonus.id, direction: PostingDirection.CREDIT, amount: new Decimal(amount) },
      ],
    });
  }

  const period = () => ({
    periodStart: new Date('2026-09-01T00:00:00Z'),
    periodEnd: new Date('2026-10-01T00:00:00Z'),
  });

  async function payInFull(reference: string) {
    const draft = await settlements.createDraft({ ...period(), partnerId, actorId: maker });
    await settlements.markReady(draft.id, { actorId: maker, documentNumber: 'ФАКТУРА-1' });
    await settlements.approve(draft.id, checker);
    return settlements.markPaid(draft.id, { actorId: checker, bankTransferReference: reference });
  }

  it('settles what is owed and leaves nothing unclaimed behind', async () => {
    await accrue('9000');
    await deduct('1000', 'partner.contribution');

    const paid = await payInFull('BANK-1');

    expect(paid.status).toBe(PartnerSettlementStatus.PAID);
    expect(new Decimal(paid.netPayableAmount).toFixed(2)).toBe('8000.00');
    expect(new Decimal(paid.accruedAmount).toFixed(2)).toBe('9000.00');
    expect(new Decimal(paid.deductionAmount).toFixed(2)).toBe('1000.00');

    const after = await settlements.unsettled(partnerId);
    expect(after.net.toFixed(2)).toBe('0.00');
    expect(after.entries).toHaveLength(0);
  });

  it('cannot pay for the same purchase twice, even from a second settlement', async () => {
    await accrue('5000');
    await payInFull('BANK-2');

    // Nothing is left, so a second settlement has nothing to claim.
    await expect(
      settlements.createDraft({ ...period(), partnerId, actorId: maker }),
    ).rejects.toThrow(/unsettled balance/i);
  });

  it('refuses a second draft that races the first for the same postings', async () => {
    await accrue('4000');

    const [first, second] = await Promise.allSettled([
      settlements.createDraft({ ...period(), partnerId, actorId: maker }),
      settlements.createDraft({ ...period(), partnerId, actorId: checker }),
    ]);

    const won = [first, second].filter((r) => r.status === 'fulfilled');
    expect(won).toHaveLength(1);

    // And the money is claimed exactly once.
    const claims = await prisma.partnerSettlementEntry.count({ where: { partnerId } });
    const postings = await prisma.ledgerPosting.count({
      where: { account: { type: LedgerAccountType.PARTNER_PAYABLE, partnerId } },
    });
    expect(claims).toBe(postings);
  });

  it('marks paid once when two administrators press it together', async () => {
    await accrue('7000');
    const draft = await settlements.createDraft({ ...period(), partnerId, actorId: maker });
    await settlements.markReady(draft.id, { actorId: maker });
    await settlements.approve(draft.id, checker);

    const results = await Promise.allSettled([
      settlements.markPaid(draft.id, { actorId: checker, bankTransferReference: 'BANK-3' }),
      settlements.markPaid(draft.id, { actorId: maker, bankTransferReference: 'BANK-4' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

    // Exactly one payout posting exists — the loser's rolled back with it.
    const payouts = await prisma.ledgerTransaction.count({
      where: { kind: 'partner.settlement.paid', sourceId: draft.id },
    });
    expect(payouts).toBe(1);
  });

  it('refuses to let the creator approve their own settlement', async () => {
    await accrue('3000');
    const draft = await settlements.createDraft({ ...period(), partnerId, actorId: maker });
    await settlements.markReady(draft.id, { actorId: maker });

    await expect(settlements.approve(draft.id, maker)).rejects.toThrow(/cannot approve it/i);
    await expect(settlements.approve(draft.id, checker)).resolves.toMatchObject({
      status: PartnerSettlementStatus.APPROVED,
    });
  });

  it('keeps a paid settlement immutable, at the database level', async () => {
    await accrue('6000');
    const paid = await payInFull('BANK-5');

    await expect(
      prisma.partnerSettlement.update({
        where: { id: paid.id },
        data: { netPayableAmount: new Decimal(1) },
      }),
    ).rejects.toThrow(/PAID and cannot be changed/i);

    await expect(prisma.partnerSettlement.delete({ where: { id: paid.id } })).rejects.toThrow(
      /PAID and cannot be changed/i,
    );
  });

  it('will not let one bank transfer close two settlements', async () => {
    await accrue('2000');
    await payInFull('BANK-SAME');

    await accrue('2500');
    const second = await settlements.createDraft({ ...period(), partnerId, actorId: maker });
    await settlements.markReady(second.id, { actorId: maker });
    await settlements.approve(second.id, checker);

    await expect(
      settlements.markPaid(second.id, { actorId: checker, bankTransferReference: 'BANK-SAME' }),
    ).rejects.toThrow();
  });

  describe('a refund after the partner has already been paid', () => {
    it('leaves the paid settlement alone and carries the debt forward', async () => {
      await accrue('9000');
      const paid = await payInFull('BANK-6');

      // The customer returns the purchase after the transfer went out.
      await deduct('9000');

      const frozen = await prisma.partnerSettlement.findUniqueOrThrow({ where: { id: paid.id } });
      expect(frozen.status).toBe(PartnerSettlementStatus.PAID);
      expect(new Decimal(frozen.netPayableAmount).toFixed(2)).toBe('9000.00');

      const owing = await settlements.unsettled(partnerId);
      expect(owing.net.toFixed(2)).toBe('-9000.00');

      // A debt is not settled — it waits for new earnings.
      await expect(
        settlements.createDraft({ ...period(), partnerId, actorId: maker }),
      ).rejects.toThrow(/-9000/);
    });

    it('offsets the debt against the next period, and says where it came from', async () => {
      await accrue('9000');
      await payInFull('BANK-7');
      await deduct('9000');
      await accrue('15000');

      const owing = await settlements.unsettled(partnerId);
      expect(owing.net.toFixed(2)).toBe('6000.00');

      // The provenance survives: the debt is still an itemised refund, not an
      // opening balance somebody typed in.
      const refundLegs = owing.entries.filter((e) => e.sourceType === 'PurchaseIntentRefund');
      expect(refundLegs).toHaveLength(1);
      const refundLeg = refundLegs[0]!;
      expect(refundLeg.amount.toFixed(2)).toBe('9000.00');
      expect(refundLeg.direction).toBe(PostingDirection.DEBIT);

      const next = await payInFull('BANK-8');
      expect(new Decimal(next.netPayableAmount).toFixed(2)).toBe('6000.00');
    });
  });

  it('never claims a transfer posting, so a payout is not deducted twice', async () => {
    await accrue('5000');
    await payInFull('BANK-9');

    // The payout itself wrote a DEBIT on the payable account. If it were
    // settleable, the next settlement would deduct the transfer again.
    const unsettled = await settlements.unsettled(partnerId);
    expect(unsettled.entries.map((e) => e.kind)).not.toContain('partner.settlement.paid');
    expect(unsettled.net.toFixed(2)).toBe('0.00');
  });

  it('releases its claims when a draft is cancelled', async () => {
    await accrue('1234.5678');
    const draft = await settlements.createDraft({ ...period(), partnerId, actorId: maker });
    expect((await settlements.unsettled(partnerId)).entries).toHaveLength(0);

    await settlements.cancel(draft.id, { actorId: maker, reason: 'wrong period' });

    const back = await settlements.unsettled(partnerId);
    expect(back.net.toFixed(4)).toBe('1234.5678');
  });

  it('flags a ledger kind nobody has classified instead of paying it out', async () => {
    await accrue('1000');
    await accrue('500', 'some.brand.new.kind');

    const unsettled = await settlements.unsettled(partnerId);
    expect(unsettled.unrecognised).toEqual(['some.brand.new.kind']);
    // Unclassified money is not paid: only the known 1000 is settleable.
    expect(unsettled.net.toFixed(2)).toBe('1000.00');
  });
  /**
   * Finding 3 of the product review of 15.09.2026, and it was a real bug rather
   * than a design preference.
   *
   * `FAILED` used to be terminal. The settlement kept its claimed
   * `PartnerSettlementEntry` rows — claiming is what freezes the figure, and
   * a claimed posting belongs to at most one settlement for ever — so after a
   * bounced transfer those postings could never be picked up by anything. The
   * partner was owed the money, the ledger said so, and no settlement in the
   * system could ever pay it. The old docblock claimed "a fresh settlement is
   * made for the retry", which could not happen for exactly that reason.
   *
   * The fix separates the statement of what is owed (the settlement, approved
   * once and frozen) from an attempt at moving it (`PartnerSettlement-
   * TransferAttempt`, one row per try).
   */
  describe('a bounced transfer', () => {
    async function approved(amount = '8000') {
      await accrue(amount);
      const draft = await settlements.createDraft({ ...period(), partnerId, actorId: maker });
      await settlements.markReady(draft.id, { actorId: maker, documentNumber: 'ФАКТУРА-R' });
      await settlements.approve(draft.id, checker);
      return draft;
    }

    it('leaves what is owed intact and pays it on the retry, exactly once', async () => {
      const settlement = await approved('8000');

      await settlements.markPaymentPending(settlement.id, checker);
      const failed = await settlements.markFailed(settlement.id, {
        actorId: checker,
        reason: 'Beneficiary account closed',
      });
      expect(failed.status).toBe(PartnerSettlementStatus.FAILED);

      // The entries are still claimed — the figure the partner was shown has
      // not changed — and the postings have not leaked back into unsettled.
      expect(
        await prisma.partnerSettlementEntry.count({ where: { settlementId: settlement.id } }),
      ).toBe(settlement.entryCount);
      expect((await settlements.unsettled(partnerId)).net.toFixed(2)).toBe('0.00');
      // Nothing was posted for a transfer that did not happen.
      expect(
        await prisma.ledgerTransaction.count({ where: { kind: 'partner.settlement.paid' } }),
      ).toBe(0);

      // The retry: a new bank reference against the same figure.
      const paid = await settlements.markPaid(settlement.id, {
        actorId: checker,
        bankTransferReference: 'BANK-RETRY',
      });
      expect(paid.status).toBe(PartnerSettlementStatus.PAID);
      expect(new Decimal(paid.netPayableAmount).toFixed(2)).toBe('8000.00');

      // Paid once, for 8,000, not twice.
      const payouts = await prisma.ledgerPosting.findMany({
        where: { transaction: { kind: 'partner.settlement.paid' } },
        include: { account: { select: { type: true } } },
      });
      expect(payouts).toHaveLength(2);
      const discharged = payouts.find((x) => x.account.type === LedgerAccountType.PARTNER_PAYABLE);
      expect(discharged?.direction).toBe(PostingDirection.DEBIT);
      expect(new Decimal(discharged!.amount).toFixed(2)).toBe('8000.00');

      // Both tries are on the record, and only the second says it worked.
      const attempts = await prisma.partnerSettlementTransferAttempt.findMany({
        where: { settlementId: settlement.id },
        orderBy: { attemptedAt: 'asc' },
      });
      expect(attempts).toHaveLength(2);
      expect(attempts[0]).toMatchObject({
        succeeded: false,
        failureReason: 'Beneficiary account closed',
      });
      expect(attempts[1]).toMatchObject({ succeeded: true, bankTransferReference: 'BANK-RETRY' });
      // And the partner's payable is square: 8,000 in, 8,000 out.
      expect((await payableBalance()).toFixed(2)).toBe('0.00');
    });

    it('records every bounce, and still pays only once at the end', async () => {
      const settlement = await approved('5000');

      for (const reason of ['Wrong IBAN', 'Bank rejected', 'Returned by beneficiary']) {
        await settlements.markFailed(settlement.id, { actorId: checker, reason });
      }
      await settlements.markPaid(settlement.id, {
        actorId: checker,
        bankTransferReference: 'BANK-FINALLY',
      });

      const attempts = await prisma.partnerSettlementTransferAttempt.findMany({
        where: { settlementId: settlement.id },
      });
      expect(attempts).toHaveLength(4);
      expect(attempts.filter((a) => a.succeeded)).toHaveLength(1);
      expect(
        await prisma.ledgerTransaction.count({ where: { kind: 'partner.settlement.paid' } }),
      ).toBe(1);
    });

    it('pays once when the retry races itself', async () => {
      const settlement = await approved('4000');
      await settlements.markFailed(settlement.id, { actorId: checker, reason: 'Timed out' });

      const results = await Promise.allSettled([
        settlements.markPaid(settlement.id, { actorId: checker, bankTransferReference: 'RACE-A' }),
        settlements.markPaid(settlement.id, { actorId: maker, bankTransferReference: 'RACE-B' }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(
        await prisma.ledgerTransaction.count({ where: { kind: 'partner.settlement.paid' } }),
      ).toBe(1);
      expect(
        await prisma.partnerSettlementTransferAttempt.count({
          where: { settlementId: settlement.id, succeeded: true },
        }),
      ).toBe(1);
    });

    it('will not let a second attempt claim success on the same settlement', async () => {
      const settlement = await approved('3000');
      await settlements.markPaid(settlement.id, {
        actorId: checker,
        bankTransferReference: 'BANK-ONE',
      });

      // Straight at the table, past every service check: the index refuses.
      await expect(
        prisma.partnerSettlementTransferAttempt.create({
          data: {
            settlementId: settlement.id,
            amount: new Decimal('3000'),
            succeeded: true,
            successKey: 'paid',
            bankTransferReference: 'BANK-TWO',
            resolvedAt: new Date(),
          },
        }),
      ).rejects.toThrow();
    });

    it('will not record an attempt for a different figure than the settlement', async () => {
      const settlement = await approved('3000');

      await expect(
        prisma.partnerSettlementTransferAttempt.create({
          data: { settlementId: settlement.id, amount: new Decimal('9999') },
        }),
      ).rejects.toThrow(/does not match settlement/i);
    });

    it('keeps the approved figure frozen while it waits for a retry', async () => {
      const settlement = await approved('6000');
      await settlements.markFailed(settlement.id, { actorId: checker, reason: 'Bounced' });

      // A purchase made after approval must not join the failed settlement.
      const late = await accrue('1500');
      await expect(
        prisma.partnerSettlementEntry.create({
          data: {
            settlementId: settlement.id,
            ledgerPostingId: (
              await prisma.ledgerPosting.findFirstOrThrow({
                where: {
                  transactionId: late.id,
                  account: { type: LedgerAccountType.PARTNER_PAYABLE },
                },
              })
            ).id,
            partnerId,
            amount: new Decimal('1500'),
            direction: PostingDirection.CREDIT,
            kind: 'partner.bonus_redemption_compensation',
            sourceType: 'PurchaseIntent',
            sourceId: 'late',
            occurredAt: new Date(),
          },
        }),
      ).rejects.toThrow(/entries are frozen/i);

      // It goes into the next settlement instead, which is where it belongs.
      expect((await settlements.unsettled(partnerId)).net.toFixed(2)).toBe('1500.00');
    });
  });

  /**
   * The third outcome, and the one that costs money if it is guessed at: the
   * bank's answer is ambiguous. Retrying a maybe is how a partner gets paid
   * twice; treating it as failed is the same thing by another name.
   */
  describe('an ambiguous bank result', () => {
    async function ambiguous(amount = '7000') {
      await accrue(amount);
      const draft = await settlements.createDraft({ ...period(), partnerId, actorId: maker });
      await settlements.markReady(draft.id, { actorId: maker });
      await settlements.approve(draft.id, checker);
      await settlements.markPaymentPending(draft.id, checker);
      await settlements.markRequiresReconciliation(draft.id, {
        actorId: checker,
        reason: 'Bank timed out; reference not found in the statement',
        bankTransferReference: 'MAYBE-1',
      });
      return draft;
    }

    it('never retries itself', async () => {
      const settlement = await ambiguous();

      await expect(
        settlements.markPaid(settlement.id, { actorId: checker, bankTransferReference: 'GUESS' }),
      ).rejects.toThrow(/needs reconciliation/i);
      await expect(settlements.markPaymentPending(settlement.id, checker)).rejects.toThrow(
        /REQUIRES_RECONCILIATION/,
      );
      expect(
        await prisma.ledgerTransaction.count({ where: { kind: 'partner.settlement.paid' } }),
      ).toBe(0);
    });

    it('records the attempt as unresolved, not as failed', async () => {
      const settlement = await ambiguous();
      const attempt = await prisma.partnerSettlementTransferAttempt.findFirstOrThrow({
        where: { settlementId: settlement.id },
      });
      // Unresolved is the whole point: nobody knows yet, and the row says so
      // rather than pretending one way or the other.
      expect(attempt.succeeded).toBe(false);
      expect(attempt.resolvedAt).toBeNull();
    });

    it('closes out when two people find the money did leave', async () => {
      const settlement = await ambiguous('7000');

      await settlements.proposeReconciliationOutcome(settlement.id, {
        actorId: maker,
        outcome: ReconciliationOutcome.MONEY_MOVED,
        evidence: 'Statement line 2026-09-14, debit 7,000.00, ref MAYBE-1',
        bankTransferReference: 'MAYBE-1',
      });
      const paid = await settlements.confirmReconciliationOutcome(settlement.id, {
        actorId: checker,
      });

      expect(paid.status).toBe(PartnerSettlementStatus.PAID);
      expect((await payableBalance()).toFixed(2)).toBe('0.00');
      expect(paid.reconciliationProposedByUserId).toBe(maker);
      expect(paid.reconciliationConfirmedByUserId).toBe(checker);
      expect(paid.reconciliationEvidence).toMatch(/Statement line/);

      // The same attempt turned out to have worked — not a new one beside it.
      const attempts = await prisma.partnerSettlementTransferAttempt.findMany({
        where: { settlementId: settlement.id },
      });
      expect(attempts).toHaveLength(1);
      expect(attempts[0]).toMatchObject({ succeeded: true, bankTransferReference: 'MAYBE-1' });
    });

    it('becomes retryable again when two people find it did not', async () => {
      const settlement = await ambiguous('7000');

      await settlements.proposeReconciliationOutcome(settlement.id, {
        actorId: maker,
        outcome: ReconciliationOutcome.MONEY_DID_NOT_MOVE,
        evidence: 'No debit on the account for 2026-09-14 or since',
      });
      const failed = await settlements.confirmReconciliationOutcome(settlement.id, {
        actorId: checker,
      });
      expect(failed.status).toBe(PartnerSettlementStatus.FAILED);

      const paid = await settlements.markPaid(settlement.id, {
        actorId: checker,
        bankTransferReference: 'AFTER-RECONCILE',
      });
      expect(paid.status).toBe(PartnerSettlementStatus.PAID);
      expect(
        await prisma.ledgerTransaction.count({ where: { kind: 'partner.settlement.paid' } }),
      ).toBe(1);
      expect((await payableBalance()).toFixed(2)).toBe('0.00');
    });

    it('moves nothing on the proposal alone', async () => {
      const settlement = await ambiguous('7000');

      const proposed = await settlements.proposeReconciliationOutcome(settlement.id, {
        actorId: maker,
        outcome: ReconciliationOutcome.MONEY_MOVED,
        evidence: 'Statement line 2026-09-14',
        bankTransferReference: 'MAYBE-1',
      });
      expect(proposed.status).toBe(PartnerSettlementStatus.REQUIRES_RECONCILIATION);
      expect(
        await prisma.ledgerTransaction.count({ where: { kind: 'partner.settlement.paid' } }),
      ).toBe(0);
    });

    it('will not let the proposer confirm their own reading', async () => {
      const settlement = await ambiguous('7000');
      await settlements.proposeReconciliationOutcome(settlement.id, {
        actorId: maker,
        outcome: ReconciliationOutcome.MONEY_MOVED,
        evidence: 'Statement line 2026-09-14',
        bankTransferReference: 'MAYBE-1',
      });

      await expect(
        settlements.confirmReconciliationOutcome(settlement.id, { actorId: maker }),
      ).rejects.toThrow(/second person has to confirm/i);
      expect(
        await prisma.ledgerTransaction.count({ where: { kind: 'partner.settlement.paid' } }),
      ).toBe(0);
    });

    it('will not confirm what nobody proposed', async () => {
      const settlement = await ambiguous('7000');
      await expect(
        settlements.confirmReconciliationOutcome(settlement.id, { actorId: checker }),
      ).rejects.toThrow(/Nobody has proposed/i);
    });

    it('demands evidence, and a reference for money it says moved', async () => {
      const settlement = await ambiguous('7000');

      await expect(
        settlements.proposeReconciliationOutcome(settlement.id, {
          actorId: maker,
          outcome: ReconciliationOutcome.MONEY_DID_NOT_MOVE,
          evidence: '   ',
        }),
      ).rejects.toThrow(/evidence is required/i);

      await expect(
        settlements.proposeReconciliationOutcome(settlement.id, {
          actorId: maker,
          outcome: ReconciliationOutcome.MONEY_MOVED,
          evidence: 'It looked right',
        }),
      ).rejects.toThrow(/has a bank reference/i);
    });

    it('refuses at the database level to record one person as both maker and checker', async () => {
      const settlement = await ambiguous('7000');

      await expect(
        prisma.partnerSettlement.update({
          where: { id: settlement.id },
          data: {
            reconciliationOutcome: ReconciliationOutcome.MONEY_MOVED,
            reconciliationEvidence: 'anything',
            reconciliationProposedByUserId: maker,
            reconciliationProposedAt: new Date(),
            reconciliationConfirmedByUserId: maker,
            reconciliationConfirmedAt: new Date(),
          },
        }),
      ).rejects.toThrow();
    });

    it('refuses at the database level to record a confirmation with no evidence', async () => {
      const settlement = await ambiguous('7000');

      await expect(
        prisma.partnerSettlement.update({
          where: { id: settlement.id },
          data: {
            reconciliationOutcome: ReconciliationOutcome.MONEY_MOVED,
            reconciliationProposedByUserId: maker,
            reconciliationProposedAt: new Date(),
          },
        }),
      ).rejects.toThrow();
    });
  });

  /**
   * A partner may say the money never arrived. A partner may not say whether
   * it moved — they are the payee, and a payee who can do both can order
   * their own second payment. The product decision of 15.09.2026.
   */
  describe('a partner reporting a missing transfer', () => {
    async function reported() {
      await accrue('6000');
      const draft = await settlements.createDraft({ ...period(), partnerId, actorId: maker });
      await settlements.markReady(draft.id, { actorId: maker });
      await settlements.approve(draft.id, checker);
      await settlements.markPaymentPending(draft.id, checker);
      await settlements.reportTransferProblem(draft.id, {
        partnerUserId: partnerUser,
        partnerId,
        reason: 'Nothing arrived on our account',
      });
      return draft;
    }

    it('flags it for finance and records who reported it', async () => {
      const settlement = await reported();
      const after = await prisma.partnerSettlement.findUniqueOrThrow({
        where: { id: settlement.id },
      });
      expect(after.status).toBe(PartnerSettlementStatus.REQUIRES_RECONCILIATION);
      expect(after.reconciliationSource).toBe(ReconciliationSource.PARTNER_REPORT);
      expect(after.reconciliationReportedByUserId).toBe(partnerUser);
      // A report is not a finding: nothing is proposed and nothing is paid.
      expect(after.reconciliationOutcome).toBeNull();
      expect(
        await prisma.ledgerTransaction.count({ where: { kind: 'partner.settlement.paid' } }),
      ).toBe(0);
    });

    it('will not let the reporting partner propose or confirm the answer', async () => {
      const settlement = await reported();

      await expect(
        settlements.proposeReconciliationOutcome(settlement.id, {
          actorId: partnerUser,
          outcome: ReconciliationOutcome.MONEY_DID_NOT_MOVE,
          evidence: 'We never got it',
        }),
      ).rejects.toThrow(/for finance to establish/i);

      await settlements.proposeReconciliationOutcome(settlement.id, {
        actorId: maker,
        outcome: ReconciliationOutcome.MONEY_DID_NOT_MOVE,
        evidence: 'No debit on the account',
      });
      await expect(
        settlements.confirmReconciliationOutcome(settlement.id, { actorId: partnerUser }),
      ).rejects.toThrow(/for finance to establish/i);
    });

    it('is resolved by two finance people, and then retryable', async () => {
      const settlement = await reported();

      await settlements.proposeReconciliationOutcome(settlement.id, {
        actorId: maker,
        outcome: ReconciliationOutcome.MONEY_DID_NOT_MOVE,
        evidence: 'Bank case 44812: the transfer was never submitted',
      });
      const failed = await settlements.confirmReconciliationOutcome(settlement.id, {
        actorId: checker,
      });
      expect(failed.status).toBe(PartnerSettlementStatus.FAILED);

      const paid = await settlements.markPaid(settlement.id, {
        actorId: checker,
        bankTransferReference: 'RESUBMITTED-1',
      });
      expect(paid.status).toBe(PartnerSettlementStatus.PAID);
      expect((await payableBalance()).toFixed(2)).toBe('0.00');
    });

    it('does not let a partner touch another partner’s settlement', async () => {
      const settlement = await reported();
      const stranger = (await createStaffUser(prisma)).id;
      const otherPartner = await createPartner(prisma, { displayName: 'Somebody Else' });

      await expect(
        settlements.reportTransferProblem(settlement.id, {
          partnerUserId: stranger,
          partnerId: otherPartner.id,
          reason: 'Nothing arrived',
        }),
      ).rejects.toThrow(/not found/i);
    });
  });

  /** Net movement on this partner's payable account, credits positive. */
  async function payableBalance(): Promise<Decimal> {
    const postings = await prisma.ledgerPosting.findMany({
      where: { account: { type: LedgerAccountType.PARTNER_PAYABLE, partnerId } },
      select: { amount: true, direction: true },
    });
    return postings.reduce(
      (sum, x) =>
        x.direction === PostingDirection.CREDIT
          ? sum.plus(new Decimal(x.amount))
          : sum.minus(new Decimal(x.amount)),
      new Decimal(0),
    );
  }
});
