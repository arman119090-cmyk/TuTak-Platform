import {
  BonusEntryType,
  ContributionRuleKind,
  LedgerAccountType,
  PostingDirection,
  PrismaClient,
  PurchaseIntentStatus,
  RoleName,
  UnitOfMeasure,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { CustomerBalanceService } from '../src/modules/customer-balance/customer-balance.service';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { PartnerContributionRuleService } from '../src/modules/partners/contribution/partner-contribution-rule.service';
import { PurchaseFundingService } from '../src/modules/purchase-intents/purchase-funding.service';
import { PurchaseIntentsService } from '../src/modules/purchase-intents/purchase-intents.service';
import { BonusEngineService } from '../src/modules/wallet/bonus-engine.service';
import {
  createCustomer,
  createPartner,
  createStaffUser,
  fundPrepaidBalance,
} from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * The canonical hybrid funding model (owner's brief, 20.09.2026):
 *
 *     grossAmount = bonusApplied + prepaidAmountApplied + externalAmountDue
 *
 * One purchase engine, one economics model, three ways to fund it. These
 * tests are the brief's own acceptance cases (§7, §39, §11–12), run against
 * the real database, and they assert the exact ledger postings — not that
 * "something balanced".
 *
 * Sign convention, as everywhere in this ledger: `PARTNER_PAYABLE` is
 * credit-normal. Its raw balance is negative when TuTak owes the partner and
 * positive when the partner owes TuTak. `owed()` below returns the negated
 * balance so a positive number reads "TuTak owes the partner this much".
 */
describe('Hybrid funding: prepaid + bonus + external (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let purchaseIntents: PurchaseIntentsService;
  let funding: PurchaseFundingService;
  let balance: CustomerBalanceService;
  let ledger: LedgerService;
  let engine: BonusEngineService;
  let rules: PartnerContributionRuleService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    purchaseIntents = harness.app.get(PurchaseIntentsService);
    funding = harness.app.get(PurchaseFundingService);
    balance = harness.app.get(CustomerBalanceService);
    ledger = harness.app.get(LedgerService);
    engine = harness.app.get(BonusEngineService);
    rules = harness.app.get(PartnerContributionRuleService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    await truncateAll(prisma);
  });

  // ── Helpers ─────────────────────────────────────────────────────────────

  /** A customer with `bonus` points available and `money` in stored balance. */
  const customer = async (bonus: string, money: string) => {
    const { user, wallet } = await createCustomer(prisma);
    if (new Decimal(bonus).greaterThan(0)) {
      await engine.accrue({
        walletId: wallet.id,
        type: BonusEntryType.ACCRUAL_PURCHASE,
        amount: bonus,
        pendingHours: 0,
      });
    }
    if (new Decimal(money).greaterThan(0)) {
      await fundPrepaidBalance(ledger, user.id, money);
    }
    return { user, wallet };
  };

  const staffMember = async (partnerId: string) => {
    const { user } = await createCustomer(prisma);
    const role = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.PARTNER_OWNER } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id, partnerId } });
    return user;
  };

  /** Positive = TuTak owes the partner; negative = the partner owes TuTak. */
  const owed = async (partnerId: string): Promise<string> => {
    const account = await prisma.ledgerAccount.findFirst({
      where: { type: LedgerAccountType.PARTNER_PAYABLE, partnerId },
    });
    return (account?.balance ?? new Decimal(0)).negated().toFixed(4);
  };

  /** Every posting on the partner's payable, by kind — the brief's "exact postings". */
  const payablePostings = async (partnerId: string) => {
    const postings = await prisma.ledgerPosting.findMany({
      where: { account: { type: LedgerAccountType.PARTNER_PAYABLE, partnerId } },
      select: { amount: true, direction: true, transaction: { select: { kind: true } } },
      orderBy: { transaction: { postedAt: 'asc' } },
    });
    return postings.map((p) => ({
      kind: p.transaction.kind,
      direction: p.direction,
      amount: p.amount.toFixed(4),
    }));
  };

  const postingsOn = async (type: LedgerAccountType) =>
    prisma.ledgerPosting.count({ where: { account: { type } } });

  /**
   * The cashier confirms: for a percentage partner nothing to echo; for a
   * per-unit partner the line item is read back, exactly as a cashier at the
   * pump would.
   */
  const cashierConfirms = async (intentId: string, staffId: string) => {
    const intent = await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intentId } });
    return purchaseIntents.confirm(intentId, staffId, {
      quantity: intent.quantity?.toString(),
      quantityUnit: intent.quantityUnit ?? undefined,
      unitPrice: intent.unitPrice?.toString(),
    });
  };

  /**
   * The brief's fixture: a partner on 5% (500 bps), so the contribution on
   * a 50 000 purchase is 2 500 in every case. `maxBonusPaymentPercent` is
   * raised so the 5 000 bonus is within the partner's ceiling.
   */
  const fivePercentPartner = () =>
    createPartner(prisma, { bonusAccrualRateBps: 500, maxBonusPaymentPercent: 50 });

  // ── §7 acceptance: four cases, one economics model ─────────────────────

  describe('acceptance cases on the 5% fixture (gross 50 000)', () => {
    it('CASE A — cash only: partner owes TuTak 2 500, nothing else posted', async () => {
      const partner = await fivePercentPartner();
      const staff = await staffMember(partner.id);
      const { user } = await customer('0', '0');

      const intent = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '50000' },
        user.id,
      );
      expect(intent.bonusAmountRequested.toFixed(4)).toBe('0.0000');
      expect(intent.prepaidAmountApplied.toFixed(4)).toBe('0.0000');
      expect(intent.ordinaryPaymentRemainder.toFixed(4)).toBe('50000.0000');

      await cashierConfirms(intent.id, staff.id);

      expect(await owed(partner.id)).toBe('-2500.0000');
      expect(await payablePostings(partner.id)).toEqual([
        { kind: 'partner.contribution', direction: PostingDirection.DEBIT, amount: '2500.0000' },
      ]);
      // §13: cash at the till is not TuTak money and posts nothing anywhere
      // on the money side.
      expect(await postingsOn(LedgerAccountType.PLATFORM_BANK)).toBe(0);
      expect(await postingsOn(LedgerAccountType.PSP_RECEIVABLE)).toBe(0);
      expect(await postingsOn(LedgerAccountType.CUSTOMER_PREPAID_BALANCE)).toBe(0);
      expect(await postingsOn(LedgerAccountType.CUSTOMER_PREPAID_RESERVED)).toBe(0);
    });

    it('CASE A still grants cashback: a cash-only purchase is a full purchase', async () => {
      const partner = await fivePercentPartner();
      const staff = await staffMember(partner.id);
      const { user, wallet } = await customer('0', '0');

      const intent = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '50000' },
        user.id,
      );
      await cashierConfirms(intent.id, staff.id);

      const confirmed = await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intent.id } });
      expect(confirmed.poolAmount?.toFixed(4)).toBe('2500.0000');
      expect(confirmed.greenAmount?.greaterThan(0)).toBe(true);
      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(after.availableBonus.toFixed(4)).toBe(confirmed.greenAmount!.toFixed(4));
    });

    it('CASE B — cash + bonus: TuTak owes the partner 2 500', async () => {
      const partner = await fivePercentPartner();
      const staff = await staffMember(partner.id);
      const { user } = await customer('5000', '0');

      const intent = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '50000', bonusAmountRequested: '5000' },
        user.id,
      );
      expect(intent.ordinaryPaymentRemainder.toFixed(4)).toBe('45000.0000');

      await cashierConfirms(intent.id, staff.id);

      expect(await owed(partner.id)).toBe('2500.0000');
      expect(await payablePostings(partner.id)).toEqual([
        { kind: 'partner.contribution', direction: PostingDirection.DEBIT, amount: '2500.0000' },
        {
          kind: 'partner.bonus_redemption_compensation',
          direction: PostingDirection.CREDIT,
          amount: '5000.0000',
        },
      ]);
      expect(await postingsOn(LedgerAccountType.CUSTOMER_PREPAID_RESERVED)).toBe(0);
    });

    it('CASE C — prepaid + bonus, nothing at the till: TuTak owes the partner 47 500', async () => {
      const partner = await fivePercentPartner();
      const staff = await staffMember(partner.id);
      const { user } = await customer('5000', '50000');

      const intent = await purchaseIntents.create(
        {
          partnerId: partner.id,
          grossAmount: '50000',
          bonusAmountRequested: '5000',
          prepaidAmountApplied: '45000',
        },
        user.id,
      );
      expect(intent.prepaidAmountApplied.toFixed(4)).toBe('45000.0000');
      // §19: the cashier's "receive from the customer" figure is zero — and
      // it is the server's zero, not the client's.
      expect(intent.ordinaryPaymentRemainder.toFixed(4)).toBe('0.0000');

      // §11: held, not spent. Available drops, reserved rises, book is flat.
      expect(await balance.getBalanceDetail(user.id)).toMatchObject({
        available: '5000.0000',
        reserved: '45000.0000',
        book: '50000.0000',
      });
      // Nothing is owed to anyone until the cashier confirms.
      expect(await owed(partner.id)).toBe('0.0000');

      await cashierConfirms(intent.id, staff.id);

      expect(await owed(partner.id)).toBe('47500.0000');
      expect(await payablePostings(partner.id)).toEqual([
        { kind: 'partner.contribution', direction: PostingDirection.DEBIT, amount: '2500.0000' },
        {
          kind: 'partner.bonus_redemption_compensation',
          direction: PostingDirection.CREDIT,
          amount: '5000.0000',
        },
        { kind: 'partner.prepaid_funding', direction: PostingDirection.CREDIT, amount: '45000.0000' },
      ]);
      // §12: reservation → partner payable; the customer keeps what is left.
      expect(await balance.getBalanceDetail(user.id)).toMatchObject({
        available: '5000.0000',
        reserved: '0.0000',
        book: '5000.0000',
      });
      // §13: no cash leg at all — the prepaid money never touches the bank
      // accounts on its way to the partner.
      expect(await postingsOn(LedgerAccountType.PLATFORM_BANK)).toBe(0);
    });

    it('CASE D — cash + prepaid + bonus: TuTak owes the partner 22 500', async () => {
      const partner = await fivePercentPartner();
      const staff = await staffMember(partner.id);
      const { user } = await customer('5000', '20000');

      const intent = await purchaseIntents.create(
        {
          partnerId: partner.id,
          grossAmount: '50000',
          bonusAmountRequested: '5000',
          prepaidAmountApplied: '20000',
        },
        user.id,
      );
      expect(intent.ordinaryPaymentRemainder.toFixed(4)).toBe('25000.0000');

      await cashierConfirms(intent.id, staff.id);

      expect(await owed(partner.id)).toBe('22500.0000');
      expect(await payablePostings(partner.id)).toEqual([
        { kind: 'partner.contribution', direction: PostingDirection.DEBIT, amount: '2500.0000' },
        {
          kind: 'partner.bonus_redemption_compensation',
          direction: PostingDirection.CREDIT,
          amount: '5000.0000',
        },
        { kind: 'partner.prepaid_funding', direction: PostingDirection.CREDIT, amount: '20000.0000' },
      ]);
      expect(await balance.getBalanceDetail(user.id)).toMatchObject({
        available: '0.0000',
        reserved: '0.0000',
        book: '0.0000',
      });
    });

    it('§14: the loyalty economics are identical across all four fundings', async () => {
      // Same partner, same gross, four fundings — the pool split must not
      // know or care where the money came from.
      const partner = await fivePercentPartner();
      const staff = await staffMember(partner.id);
      const splits: string[] = [];
      for (const [bonus, prepaid] of [
        ['0', '0'],
        ['5000', '0'],
        ['5000', '45000'],
        ['5000', '20000'],
      ] as const) {
        const { user } = await customer(bonus, prepaid);
        const intent = await purchaseIntents.create(
          {
            partnerId: partner.id,
            grossAmount: '50000',
            bonusAmountRequested: bonus,
            prepaidAmountApplied: prepaid,
          },
          user.id,
        );
        await cashierConfirms(intent.id, staff.id);
        const row = await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intent.id } });
        splits.push(
          [row.poolAmount, row.greenAmount, row.deferredAmount, row.tutakAmount]
            .map((d) => d!.toFixed(4))
            .join('/'),
        );
      }
      expect(new Set(splits).size).toBe(1);
      expect(splits[0]!.startsWith('2500.0000/')).toBe(true);
    });
  });

  // ── §39: the contribution rule is whatever the contract says ───────────

  describe('contribution kinds (§6, §39): the funding split never hardcodes 5%', () => {
    let adminId = '';
    let checkerId = '';
    beforeEach(async () => {
      adminId = (await createStaffUser(prisma)).id;
      checkerId = (await createStaffUser(prisma)).id;
    });

    const agreeTerms = async (
      partnerId: string,
      terms: {
        kind: ContributionRuleKind;
        percentBps?: number;
        fixedPerUnit?: string;
        unit?: UnitOfMeasure;
      },
    ) => {
      const proposal = await rules.propose({ partnerId, actorId: adminId, ...terms });
      return rules.approve(proposal.id, { actorId: checkerId });
    };

    it('FIXED_PER_UNIT: 50 litres × 10 = 500 contribution, prepaid + bonus funded', async () => {
      const partner = await createPartner(prisma, { maxBonusPaymentPercent: 50 });
      await agreeTerms(partner.id, {
        kind: ContributionRuleKind.FIXED_PER_UNIT,
        fixedPerUnit: '10',
        unit: UnitOfMeasure.LITER,
      });
      const staff = await staffMember(partner.id);
      const { user } = await customer('1000', '10000');

      const intent = await purchaseIntents.create(
        {
          partnerId: partner.id,
          grossAmount: '15000',
          quantity: '50',
          quantityUnit: UnitOfMeasure.LITER,
          unitPrice: '300',
          bonusAmountRequested: '1000',
          prepaidAmountApplied: '10000',
        },
        user.id,
      );
      expect(intent.ordinaryPaymentRemainder.toFixed(4)).toBe('4000.0000');
      await cashierConfirms(intent.id, staff.id);

      // 1 000 bonus + 10 000 prepaid − 500 contribution.
      expect(await owed(partner.id)).toBe('10500.0000');
      expect(await payablePostings(partner.id)).toEqual([
        { kind: 'partner.contribution', direction: PostingDirection.DEBIT, amount: '500.0000' },
        {
          kind: 'partner.bonus_redemption_compensation',
          direction: PostingDirection.CREDIT,
          amount: '1000.0000',
        },
        { kind: 'partner.prepaid_funding', direction: PostingDirection.CREDIT, amount: '10000.0000' },
      ]);
    });

    it('HYBRID: 2% of 15 000 + 50 × 5 = 550 contribution, cash-only funded', async () => {
      const partner = await createPartner(prisma);
      await agreeTerms(partner.id, {
        kind: ContributionRuleKind.HYBRID,
        percentBps: 200,
        fixedPerUnit: '5',
        unit: UnitOfMeasure.LITER,
      });
      const staff = await staffMember(partner.id);
      const { user } = await customer('0', '0');

      const intent = await purchaseIntents.create(
        {
          partnerId: partner.id,
          grossAmount: '15000',
          quantity: '50',
          quantityUnit: UnitOfMeasure.LITER,
          unitPrice: '300',
        },
        user.id,
      );
      await cashierConfirms(intent.id, staff.id);

      expect(await owed(partner.id)).toBe('-550.0000');
      expect(await payablePostings(partner.id)).toEqual([
        { kind: 'partner.contribution', direction: PostingDirection.DEBIT, amount: '550.0000' },
      ]);
    });
  });

  // ── §2, §22: the server is authoritative ────────────────────────────────

  describe('quote (§2, §22)', () => {
    it('returns the breakdown, the ceilings and the balances the client must not compute itself', async () => {
      const partner = await fivePercentPartner();
      const { user } = await customer('5000', '30000');

      const quote = await funding.quote({
        customerId: user.id,
        partnerId: partner.id,
        grossAmount: '50000',
        bonusAmountRequested: '5000',
        prepaidAmountApplied: '20000',
      });

      expect(quote).toMatchObject({
        grossAmount: '50000.0000',
        bonusApplied: '5000.0000',
        prepaidAmountApplied: '20000.0000',
        externalAmountDue: '25000.0000',
        availableBonus: '5000.0000',
        maxBonusAllowed: '25000.0000',
        prepaid: { state: 'AVAILABLE', availablePrepaidBalance: '30000.0000', reservedPrepaid: '0.0000' },
        canProceed: true,
        problems: [],
      });
    });

    it('refuses, with a code, everything §22 lists — and create() refuses the same', async () => {
      const partner = await createPartner(prisma, { maxBonusPaymentPercent: 10 });
      const { user } = await customer('1000', '3000');

      const problems = async (bonus: string, prepaid: string) =>
        (
          await funding.quote({
            customerId: user.id,
            partnerId: partner.id,
            grossAmount: '10000',
            bonusAmountRequested: bonus,
            prepaidAmountApplied: prepaid,
          })
        ).problems.map((p) => p.code);

      expect(await problems('2000', '0')).toEqual(
        expect.arrayContaining(['BONUS_EXCEEDS_PARTNER_MAX', 'BONUS_EXCEEDS_AVAILABLE']),
      );
      expect(await problems('0', '3001')).toEqual(['PREPAID_EXCEEDS_AVAILABLE']);
      expect(await problems('1000', '9500')).toEqual(
        expect.arrayContaining(['PREPAID_EXCEEDS_AVAILABLE', 'COMPONENTS_EXCEED_GROSS']),
      );

      await expect(
        purchaseIntents.create(
          { partnerId: partner.id, grossAmount: '10000', prepaidAmountApplied: '3001' },
          user.id,
        ),
      ).rejects.toThrow(/Insufficient available balance/);
      await expect(
        purchaseIntents.create(
          {
            partnerId: partner.id,
            grossAmount: '10000',
            bonusAmountRequested: '1000',
            prepaidAmountApplied: '9500',
          },
          user.id,
        ),
      ).rejects.toThrow(/together cannot exceed grossAmount/);
      await expect(
        purchaseIntents.create(
          { partnerId: partner.id, grossAmount: '10000', prepaidAmountApplied: '-1' },
          user.id,
        ),
      ).rejects.toThrow();
      // A refused create leaves no purchase and no hold behind.
      expect(await prisma.purchaseIntent.count()).toBe(0);
      expect(await postingsOn(LedgerAccountType.CUSTOMER_PREPAID_RESERVED)).toBe(0);
    });
  });

  // ── §11–12: the hold ────────────────────────────────────────────────────

  describe('prepaid hold (§11, §12)', () => {
    it('two concurrent 45 000 purchases against a 50 000 balance: exactly one is funded', async () => {
      const partnerA = await fivePercentPartner();
      const partnerB = await fivePercentPartner();
      const { user } = await customer('0', '50000');

      const results = await Promise.allSettled([
        purchaseIntents.create(
          { partnerId: partnerA.id, grossAmount: '45000', prepaidAmountApplied: '45000' },
          user.id,
        ),
        purchaseIntents.create(
          { partnerId: partnerB.id, grossAmount: '45000', prepaidAmountApplied: '45000' },
          user.id,
        ),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(String((rejected[0] as PromiseRejectedResult).reason)).toMatch(
        /Insufficient available balance/,
      );

      // Never negative, never oversubscribed — and reconstructable: the
      // materialised balance equals the replay of its postings.
      const detail = await balance.getBalanceDetail(user.id);
      expect(detail).toMatchObject({ available: '5000.0000', reserved: '45000.0000', book: '50000.0000' });
      const reserved = await ledger.accountFor({
        type: LedgerAccountType.CUSTOMER_PREPAID_RESERVED,
        userId: user.id,
      });
      expect((await ledger.replayBalance(reserved.id)).toFixed(4)).toBe(reserved.balance.toFixed(4));
      expect(await prisma.purchaseIntent.count()).toBe(1);
      // The loser's source transaction is closed, not left dangling.
      expect(await prisma.transaction.count({ where: { status: 'FAILED' } })).toBe(1);
    });

    it.each([
      ['cancel', async (id: string, userId: string) => purchaseIntents.cancel(id, userId)],
      [
        'reject',
        async (id: string, _userId: string, staffId: string) =>
          purchaseIntents.reject(id, staffId, { reasonCode: 'CUSTOMER_LEFT' }),
      ],
      [
        'expiry',
        async (id: string) => {
          await prisma.purchaseIntent.update({
            where: { id },
            data: { expiresAt: new Date(Date.now() - 1000) },
          });
          await purchaseIntents.expireStale();
        },
      ],
    ])('%s releases the hold back to available, exactly once', async (_name, exit) => {
      const partner = await fivePercentPartner();
      const staff = await staffMember(partner.id);
      const { user } = await customer('0', '50000');

      const intent = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '45000', prepaidAmountApplied: '45000' },
        user.id,
      );
      expect((await balance.getBalanceDetail(user.id)).available).toBe('5000.0000');

      await exit(intent.id, user.id, staff.id);
      // A second run of the same exit is a no-op, not a second release.
      await exit(intent.id, user.id, staff.id).catch(() => undefined);

      expect(await balance.getBalanceDetail(user.id)).toMatchObject({
        available: '50000.0000',
        reserved: '0.0000',
        book: '50000.0000',
      });
      const kinds = await prisma.ledgerTransaction.findMany({
        where: { sourceType: 'PurchaseIntent', sourceId: intent.id },
        select: { kind: true },
        orderBy: { postedAt: 'asc' },
      });
      expect(kinds.map((k) => k.kind)).toEqual([
        'customer.prepaid.hold',
        'customer.prepaid.hold_released',
      ]);
      expect(await owed(partner.id)).toBe('0.0000');
    });

    it('a failure after the hold and before the row rolls the hold back with it', async () => {
      const partner = await fivePercentPartner();
      const { user } = await customer('0', '50000');

      const real = balance.holdForPurchase.bind(balance);
      jest.spyOn(balance, 'holdForPurchase').mockImplementation(async (params, tx) => {
        await real(params, tx);
        throw new Error('simulated crash between hold and insert');
      });

      await expect(
        purchaseIntents.create(
          { partnerId: partner.id, grossAmount: '45000', prepaidAmountApplied: '45000' },
          user.id,
        ),
      ).rejects.toThrow(/simulated crash/);

      expect(await balance.getBalanceDetail(user.id)).toMatchObject({
        available: '50000.0000',
        reserved: '0.0000',
      });
      expect(await prisma.purchaseIntent.count()).toBe(0);
      expect(
        await prisma.ledgerTransaction.count({ where: { kind: { startsWith: 'customer.prepaid' } } }),
      ).toBe(0);
    });

    it('the database refuses a purchase whose components do not sum to its gross', async () => {
      const partner = await fivePercentPartner();
      const { user } = await customer('0', '0');
      const intent = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '10000' },
        user.id,
      );
      await expect(
        prisma.purchaseIntent.update({
          where: { id: intent.id },
          data: { prepaidAmountApplied: new Decimal(1) },
        }),
      ).rejects.toThrow(/funding_sums_to_gross|prepaid_hold_matches_amount/);
    });

    it('a purchase with no prepaid component never touches the money accounts', async () => {
      const partner = await fivePercentPartner();
      const staff = await staffMember(partner.id);
      const { user } = await customer('1000', '50000');
      const intent = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '10000', bonusAmountRequested: '1000' },
        user.id,
      );
      expect(intent.status).toBe(PurchaseIntentStatus.AWAITING_CONFIRMATION);
      await cashierConfirms(intent.id, staff.id);
      expect(await balance.getBalanceDetail(user.id)).toMatchObject({
        available: '50000.0000',
        reserved: '0.0000',
      });
      expect(await postingsOn(LedgerAccountType.CUSTOMER_PREPAID_RESERVED)).toBe(0);
    });
  });
});
