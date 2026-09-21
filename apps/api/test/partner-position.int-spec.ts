import { LedgerAccountType, PartnerSettlementStatus, PostingDirection, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PartnerSettlementService } from '../src/modules/partner-settlements/partner-settlement.service';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { createPartner, createStaffUser } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * The figures a partner reads must not lie when a settlement is in flight.
 *
 * The case that produced this file: TuTak owes 50 000, an administrator
 * drafts a settlement for it, and the partner's page — which showed
 * `unsettled().net` as "accruing now" — drops to zero. Nothing has been
 * paid. The position endpoint now returns the ledger total alongside the
 * unsettled remainder and the sums held in settlements, and this proves the
 * three never double-count and never lose the 50 000 between them.
 */
describe('PartnerSettlementService.position (integration)', () => {
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

  async function accrue(amount: string) {
    const [payable, bonus] = await Promise.all([
      ledger.accountFor({ type: LedgerAccountType.PARTNER_PAYABLE, partnerId }),
      ledger.accountFor({ type: LedgerAccountType.BONUS_LIABILITY }),
    ]);
    return ledger.post({
      kind: 'partner.bonus_redemption_compensation',
      sourceType: 'PurchaseIntent',
      sourceId: `purchase-${Math.random().toString(36).slice(2)}`,
      postings: [
        { accountId: bonus.id, direction: PostingDirection.DEBIT, amount: new Decimal(amount) },
        { accountId: payable.id, direction: PostingDirection.CREDIT, amount: new Decimal(amount) },
      ],
    });
  }

  async function deduct(amount: string) {
    const [payable, bonus] = await Promise.all([
      ledger.accountFor({ type: LedgerAccountType.PARTNER_PAYABLE, partnerId }),
      ledger.accountFor({ type: LedgerAccountType.BONUS_LIABILITY }),
    ]);
    return ledger.post({
      kind: 'partner.bonus_redemption_compensation_refund',
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

  const fixed = (value: Decimal) => value.toFixed(2);

  /** The identity the page relies on. Checked after every step below. */
  async function expectConsistent() {
    const position = await settlements.position(partnerId);
    expect(fixed(position.ledgerBalance)).toBe(
      fixed(position.net.plus(position.inOpenSettlements).plus(position.underReview)),
    );
    return position;
  }

  it('starts at zero everywhere for a partner with no account yet', async () => {
    const position = await expectConsistent();
    expect(fixed(position.ledgerBalance)).toBe('0.00');
    expect(fixed(position.net)).toBe('0.00');
    expect(fixed(position.paidTotal)).toBe('0.00');
  });

  it('a draft moves 50 000 from "not yet settled" to "in a settlement" and the total stays 50 000', async () => {
    await accrue('50000');

    let position = await expectConsistent();
    expect(fixed(position.net)).toBe('50000.00');
    expect(fixed(position.inOpenSettlements)).toBe('0.00');
    expect(fixed(position.ledgerBalance)).toBe('50000.00');

    const draft = await settlements.createDraft({ ...period(), partnerId, actorId: maker });
    expect(draft.status).toBe(PartnerSettlementStatus.DRAFT);

    position = await expectConsistent();
    // This is the number the page used to show alone, as "accruing now".
    expect(fixed(position.net)).toBe('0.00');
    // And these two are what stop it being read as "paid".
    expect(fixed(position.inOpenSettlements)).toBe('50000.00');
    expect(fixed(position.ledgerBalance)).toBe('50000.00');
    expect(fixed(position.paidTotal)).toBe('0.00');
  });

  it('only PAID moves money out of the total, and it is not added back anywhere', async () => {
    await accrue('50000');
    await deduct('5000');
    const draft = await settlements.createDraft({ ...period(), partnerId, actorId: maker });
    await settlements.markReady(draft.id, { actorId: maker, documentNumber: 'ФАКТУРА-1' });
    await settlements.approve(draft.id, checker);

    let position = await expectConsistent();
    expect(fixed(position.inOpenSettlements)).toBe('45000.00');
    expect(fixed(position.ledgerBalance)).toBe('45000.00');

    await settlements.markPaid(draft.id, { actorId: checker, bankTransferReference: 'BANK-1' });

    position = await expectConsistent();
    expect(fixed(position.net)).toBe('0.00');
    expect(fixed(position.inOpenSettlements)).toBe('0.00');
    expect(fixed(position.paidTotal)).toBe('45000.00');
    expect(fixed(position.ledgerBalance)).toBe('0.00');
  });

  it('a cancelled draft hands its postings back to "not yet settled"', async () => {
    await accrue('12000');
    const draft = await settlements.createDraft({ ...period(), partnerId, actorId: maker });
    await settlements.cancel(draft.id, { actorId: maker, reason: 'wrong period' });

    const position = await expectConsistent();
    expect(fixed(position.net)).toBe('12000.00');
    expect(fixed(position.inOpenSettlements)).toBe('0.00');
    expect(fixed(position.ledgerBalance)).toBe('12000.00');
  });

  it('a refund after payout makes the total negative — the partner owes TuTak — without touching paid history', async () => {
    await accrue('9000');
    const draft = await settlements.createDraft({ ...period(), partnerId, actorId: maker });
    await settlements.markReady(draft.id, { actorId: maker, documentNumber: 'ФАКТУРА-2' });
    await settlements.approve(draft.id, checker);
    await settlements.markPaid(draft.id, { actorId: checker, bankTransferReference: 'BANK-2' });
    await deduct('2500');

    const position = await expectConsistent();
    expect(fixed(position.ledgerBalance)).toBe('-2500.00');
    expect(fixed(position.net)).toBe('-2500.00');
    expect(fixed(position.paidTotal)).toBe('9000.00');
  });
});
