import { ConflictException } from '@nestjs/common';
import {
  CollectionStatus,
  LedgerAccountType,
  PartnerSettlementStatus,
  PostingDirection,
  PrismaClient,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { randomUUID } from 'node:crypto';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { PartnerSettlementService } from '../src/modules/partner-settlements/partner-settlement.service';
import { PartnerCollectionService } from '../src/modules/payouts/partner-collection.service';
import { PayoutEngineService } from '../src/modules/payouts/payout-engine.service';
import { createPartner, createStaffUser } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Audit of 21.09.2026, findings D01–D04, reproduced on a real PostgreSQL
 * against the actual services rather than against a substituted DB.
 *
 * The auditor's counter-examples ran the settlement arithmetic with a fake
 * repository. Here the same four situations are produced by the real
 * writers — the payout engine, the collection service, the ledger — and the
 * settlement engine is asked what it would pay. Every case also asserts the
 * position identity `ledgerBalance = net + inOpenSettlements + underReview`,
 * which is the invariant D01–D03 break silently.
 *
 * The fix these prove: a ledger posting on the partner's payable is one of
 * three things — an *economic* accrual/adjustment a settlement pays for, an
 * *allocation* (money that already moved against the unclaimed residual: a
 * legacy payout, a collection) that the next settlement must net out, or the
 * *settled* counterpart of entries already claimed (`partner.settlement.paid`)
 * which is never claimed again. `psp.payment.captured` is the first, and was
 * missing from the list altogether.
 */
describe('Audit 21.09 — settlement allocation D01–D04 (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let settlements: PartnerSettlementService;
  let payouts: PayoutEngineService;
  let collections: PartnerCollectionService;
  let ledger: LedgerService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    settlements = harness.app.get(PartnerSettlementService);
    payouts = harness.app.get(PayoutEngineService);
    collections = harness.app.get(PartnerCollectionService);
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
    partnerId = (await createPartner(prisma)).id;
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

  /** Posts one leg on the partner's payable with a matching leg on `counter`. */
  async function payable(
    kind: string,
    direction: PostingDirection,
    amount: string,
    counter: LedgerAccountType = LedgerAccountType.BONUS_LIABILITY,
  ) {
    const [account, other] = await Promise.all([
      ledger.accountFor({ type: LedgerAccountType.PARTNER_PAYABLE, partnerId }),
      ledger.accountFor({ type: counter }),
    ]);
    const flipped = direction === PostingDirection.CREDIT ? PostingDirection.DEBIT : PostingDirection.CREDIT;
    return ledger.post({
      kind,
      sourceType: 'Fixture',
      sourceId: randomUUID(),
      postings: [
        { accountId: account.id, direction, amount: new Decimal(amount) },
        { accountId: other.id, direction: flipped, amount: new Decimal(amount) },
      ],
    });
  }

  const accrue = (amount: string) =>
    payable('partner.bonus_redemption_compensation', PostingDirection.CREDIT, amount);
  const contribution = (amount: string) =>
    payable('partner.contribution', PostingDirection.DEBIT, amount);

  const period = () => ({
    periodStart: new Date('2026-09-01T00:00:00Z'),
    periodEnd: new Date('2026-10-01T00:00:00Z'),
  });
  const fixed = (value: Decimal) => value.toFixed(4);

  /** The identity the partner's page rests on, checked after every step. */
  async function expectConsistent() {
    const position = await settlements.position(partnerId);
    expect(fixed(position.ledgerBalance)).toBe(
      fixed(position.net.plus(position.inOpenSettlements).plus(position.underReview)),
    );
    return position;
  }

  async function collect(amount: string) {
    const recorded = await collections.record({
      partnerId,
      amount,
      bankReference: `REF-${amount}`,
      bankTransactionId: `TX-${randomUUID()}`,
      actorId: maker,
      idempotencyKey: randomUUID(),
    });
    if (recorded.status === CollectionStatus.PENDING) {
      await collections.confirm(recorded.collectionId, checker);
    }
  }

  // ── D01 ─────────────────────────────────────────────────────────────────

  it('D01: a provider capture is money TuTak holds for the partner, and a settlement pays it', async () => {
    await payable('psp.payment.captured', PostingDirection.CREDIT, '14000', LedgerAccountType.PSP_RECEIVABLE);
    await accrue('1000');
    await contribution('500');

    const unsettled = await settlements.unsettled(partnerId);
    expect(unsettled.unrecognised).toEqual([]);
    expect(fixed(unsettled.net)).toBe('14500.0000');

    const position = await expectConsistent();
    expect(fixed(position.ledgerBalance)).toBe('14500.0000');
    expect(fixed(position.net)).toBe('14500.0000');

    const draft = await settlements.createDraft({ ...period(), partnerId, actorId: maker });
    expect(fixed(draft.netPayableAmount)).toBe('14500.0000');
    expect(draft.entryCount).toBe(3);
  });

  // ── D02 ─────────────────────────────────────────────────────────────────

  it('D02a: after a legacy payout took the entitlement, the next draft finds nothing to pay', async () => {
    await accrue('50000');
    const payout = await payouts.requestPayout({
      partnerId,
      amount: '50000',
      actorId: maker,
      idempotencyKey: 'legacy-1',
    });
    expect(payout.remainingBalance).toBe('0.0000');

    // The 50 000 credit is still unclaimed, but the payout debit against it
    // is unclaimed too: they net to nothing, and nothing is what is owed.
    const unsettled = await settlements.unsettled(partnerId);
    expect(fixed(unsettled.net)).toBe('0.0000');
    expect(unsettled.unrecognised).toEqual([]);
    await expect(settlements.createDraft({ ...period(), partnerId, actorId: maker })).rejects.toThrow(
      /Nothing to pay/,
    );
    let position = await expectConsistent();
    expect(fixed(position.ledgerBalance)).toBe('0.0000');

    // New sales: the draft claims the new credit *and* the two old postings
    // that cancel each other, so the itemisation explains the history and
    // the figure is exactly the new sales.
    await accrue('29000');
    const draft = await settlements.createDraft({ ...period(), partnerId, actorId: maker });
    expect(fixed(draft.netPayableAmount)).toBe('29000.0000');
    const kinds = (
      await prisma.partnerSettlementEntry.findMany({ where: { settlementId: draft.id }, select: { kind: true } })
    )
      .map((e) => e.kind)
      .sort();
    expect(kinds).toEqual([
      'partner.bonus_redemption_compensation',
      'partner.bonus_redemption_compensation',
      'payout.requested',
    ]);
    position = await expectConsistent();
    expect(fixed(position.inOpenSettlements)).toBe('29000.0000');
    expect(fixed(position.net)).toBe('0.0000');
  });

  it('D02b: a draft that claimed the entitlement blocks a legacy payout of the same money', async () => {
    await accrue('50000');
    const draft = await settlements.createDraft({ ...period(), partnerId, actorId: maker });
    expect(fixed(draft.netPayableAmount)).toBe('50000.0000');

    // The ledger still says 50 000 — the draft posts nothing — but every
    // dram of it is spoken for.
    expect((await payouts.availableBalance(partnerId)).toFixed(4)).toBe('0.0000');
    await expect(
      payouts.requestPayout({ partnerId, amount: '50000', actorId: maker, idempotencyKey: 'legacy-2' }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      payouts.requestPayout({ partnerId, amount: '1', actorId: maker, idempotencyKey: 'legacy-3' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await prisma.payout.count()).toBe(0);

    // Cancelling the draft hands the money back to the legacy path.
    await settlements.cancel(draft.id, { actorId: maker, reason: 'use the legacy payout' });
    expect((await payouts.availableBalance(partnerId)).toFixed(4)).toBe('50000.0000');
    const payout = await payouts.requestPayout({
      partnerId,
      amount: '50000',
      actorId: maker,
      idempotencyKey: 'legacy-4',
    });
    expect(payout.remainingBalance).toBe('0.0000');
    await expectConsistent();
  });

  it('D02c: a failed legacy payout returns the money and the next draft pays it once', async () => {
    await accrue('50000');
    const payout = await payouts.requestPayout({
      partnerId,
      amount: '50000',
      actorId: maker,
      idempotencyKey: 'legacy-5',
    });
    await payouts.markFailed(payout.payoutId, 'bank refused');

    const unsettled = await settlements.unsettled(partnerId);
    expect(fixed(unsettled.net)).toBe('50000.0000');
    expect(unsettled.unrecognised).toEqual([]);
    const draft = await settlements.createDraft({ ...period(), partnerId, actorId: maker });
    expect(fixed(draft.netPayableAmount)).toBe('50000.0000');
    // The request, its reversal and the sale all travel in one statement.
    expect(draft.entryCount).toBe(3);
    await expectConsistent();
  });

  // ── D03 ─────────────────────────────────────────────────────────────────

  it('D03: a partner paying their debt closes it in the settlement view exactly once', async () => {
    await contribution('500');
    let position = await expectConsistent();
    expect(fixed(position.ledgerBalance)).toBe('-500.0000');
    expect(fixed(position.net)).toBe('-500.0000');

    await collect('500');
    position = await expectConsistent();
    expect(fixed(position.ledgerBalance)).toBe('0.0000');
    // Before the fix this read -500: the collection was a "transfer" the
    // settlement engine ignored, so the debt it paid stayed deductible.
    expect(fixed(position.net)).toBe('0.0000');

    await accrue('29000');
    const draft = await settlements.createDraft({ ...period(), partnerId, actorId: maker });
    expect(fixed(draft.netPayableAmount)).toBe('29000.0000');
    position = await expectConsistent();
    expect(fixed(position.net)).toBe('0.0000');
    expect(fixed(position.inOpenSettlements)).toBe('29000.0000');
  });

  it('D03b: a refund after a paid settlement, then a collection, leaves nothing owed either way', async () => {
    await accrue('9000');
    const draft = await settlements.createDraft({ ...period(), partnerId, actorId: maker });
    await settlements.markReady(draft.id, { actorId: maker, documentNumber: 'Ф-1' });
    await settlements.approve(draft.id, checker);
    await settlements.markPaid(draft.id, { actorId: checker, bankTransferReference: 'BANK-1' });
    await payable('partner.bonus_redemption_compensation_refund', PostingDirection.DEBIT, '2500');

    let position = await expectConsistent();
    expect(fixed(position.net)).toBe('-2500.0000');
    await collect('2500');
    position = await expectConsistent();
    expect(fixed(position.net)).toBe('0.0000');
    expect(fixed(position.ledgerBalance)).toBe('0.0000');
    expect(fixed(position.paidTotal)).toBe('9000.0000');
    await expect(settlements.createDraft({ ...period(), partnerId, actorId: maker })).rejects.toThrow(
      /Nothing to pay/,
    );
  });

  // ── D04 ─────────────────────────────────────────────────────────────────

  it('D04: the position is one snapshot — the identity holds while drafts are created and cancelled underneath it', async () => {
    await accrue('50000');
    const reads: Promise<unknown>[] = [];
    for (let round = 0; round < 12; round += 1) {
      reads.push(expectConsistent());
      const draft = await settlements.createDraft({ ...period(), partnerId, actorId: maker });
      reads.push(expectConsistent());
      await settlements.cancel(draft.id, { actorId: maker, reason: `round ${round}` });
    }
    await Promise.all(reads);
    const final = await expectConsistent();
    expect(fixed(final.net)).toBe('50000.0000');
    expect(fixed(final.inOpenSettlements)).toBe('0.0000');
  });

  it('D04b: the reconciliation view of the same identity agrees with the position', async () => {
    await accrue('50000');
    await contribution('500');
    await payouts.requestPayout({ partnerId, amount: '10000', actorId: maker, idempotencyKey: 'legacy-6' });
    await collect('0.0001').catch(() => undefined); // the partner owes nothing; refused, and that is fine
    const draft = await settlements.createDraft({ ...period(), partnerId, actorId: maker });
    expect(fixed(draft.netPayableAmount)).toBe('39500.0000');
    const position = await expectConsistent();
    expect(fixed(position.ledgerBalance)).toBe('39500.0000');
    expect(position.inOpenSettlements.equals(draft.netPayableAmount)).toBe(true);
    expect(draft.status).toBe(PartnerSettlementStatus.DRAFT);
  });
});
