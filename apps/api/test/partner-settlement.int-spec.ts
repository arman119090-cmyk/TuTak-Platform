import {
  LedgerAccountType,
  PartnerSettlementStatus,
  PostingDirection,
  PrismaClient,
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

  beforeEach(async () => {
    await truncateAll(prisma);
    const partner = await createPartner(prisma);
    partnerId = partner.id;
    maker = (await createStaffUser(prisma)).id;
    checker = (await createStaffUser(prisma)).id;
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

    await expect(
      prisma.partnerSettlement.delete({ where: { id: paid.id } }),
    ).rejects.toThrow(/PAID and cannot be changed/i);
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
});
