import {
  ContributionRuleKind,
  LedgerAccountType,
  PaymentRoute,
  PostingDirection,
  PrismaClient,
  PspAttemptStatus,
  PurchaseIntentStatus,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PartnerContributionRuleService } from '../src/modules/partners/contribution/partner-contribution-rule.service';
import { PspPaymentService } from '../src/modules/psp/psp-payment.service';
import { PurchaseIntentsService } from '../src/modules/purchase-intents/purchase-intents.service';
import { BonusEngineService } from '../src/modules/wallet/bonus-engine.service';
import { CustomerFixture, createCustomer, createPartner, createStaffUser } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';
import { BonusEntryType } from '@prisma/client';

/**
 * Versioned commercial terms, and the HAZE numbers the brief asks for.
 *
 * ## Why this exists
 *
 * TuTak's share of a HAZE sale is 10 AMD of every 300 AMD litre — one
 * thirtieth, 333.33 basis points. `Partner.bonusAccrualRateBps` is an integer
 * on a 50-point grid (`partners_commission_rate_on_grid`, live since
 * 16.08.2026), so that rate does not exist in the platform: the nearest
 * available are 300 bps (share 450) and 350 bps (share 525), and the brief's
 * own figure of 500 is unreachable between them.
 *
 * Arman's decision of 15.09.2026 was to fix neither by rounding the contract
 * nor by loosening the grid for everybody, but to admit that a per-litre
 * margin is a different kind of number from a percentage. Hence
 * `ContributionRuleKind.FIXED_PER_UNIT`, and hence these tests, which assert
 * the brief's figures exactly:
 *
 *     50 L × 300 AMD = 15,000 gross
 *     TuTak          = 50 × 10 = 500
 *     entitlement    = 14,500
 *
 * ## What "without duplicating ledger economics" looks like in a test
 *
 * The three route cases below are not three code paths. They are one pool
 * figure — 500 — reaching the ledger through machinery that has not changed
 * at all. If a future change adds a per-unit branch to `settlePurchase`, the
 * DIRECT and PSP cases here will keep passing while being wrong, so the tests
 * assert the individual postings by kind rather than only the net.
 */
describe('Partner contribution rules (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let rules: PartnerContributionRuleService;
  let intents: PurchaseIntentsService;
  let psp: PspPaymentService;
  let bonusEngine: BonusEngineService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    rules = harness.app.get(PartnerContributionRuleService);
    intents = harness.app.get(PurchaseIntentsService);
    psp = harness.app.get(PspPaymentService);
    bonusEngine = harness.app.get(BonusEngineService);
  });

  afterAll(async () => {
    await harness.close();
  });

  let partnerId = '';
  let staffId = '';
  let adminId = '';

  beforeEach(async () => {
    await truncateAll(prisma);
    partnerId = (await createPartner(prisma)).id;
    staffId = (await createStaffUser(prisma)).id;
    adminId = (await createStaffUser(prisma)).id;
  });

  /** HAZE's terms: 10 AMD of every litre. */
  async function hazeTerms() {
    return rules.open({
      partnerId,
      actorId: adminId,
      kind: ContributionRuleKind.FIXED_PER_UNIT,
      fixedPerUnit: '10',
      unit: 'L',
      note: 'HAZE: 300 AMD/л клиенту, 290 партнёру, 10 TuTak',
    });
  }

  /** 50 litres at 300 — the brief's own example. */
  const fiftyLitres = {
    grossAmount: '15000',
    quantity: '50',
    quantityUnit: 'L',
    unitPrice: '300',
  };

  async function customerWithBonus(amount?: string): Promise<CustomerFixture> {
    const customer = await createCustomer(prisma);
    if (amount) {
      await bonusEngine.accrue({
        walletId: customer.wallet.id,
        type: BonusEntryType.ACCRUAL_PURCHASE,
        amount,
        pendingHours: 0,
      });
    }
    return customer;
  }

  /** Net movement on the partner's payable, credits positive. */
  async function payable(): Promise<Decimal> {
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

  /** The same, broken down by what wrote it. */
  async function payableByKind(): Promise<Map<string, Decimal>> {
    const postings = await prisma.ledgerPosting.findMany({
      where: { account: { type: LedgerAccountType.PARTNER_PAYABLE, partnerId } },
      select: { amount: true, direction: true, transaction: { select: { kind: true } } },
    });
    const out = new Map<string, Decimal>();
    for (const x of postings) {
      const signed =
        x.direction === PostingDirection.CREDIT
          ? new Decimal(x.amount)
          : new Decimal(x.amount).negated();
      out.set(x.transaction.kind, (out.get(x.transaction.kind) ?? new Decimal(0)).plus(signed));
    }
    return out;
  }

  // ── The brief's three cases ────────────────────────────────────────────

  describe('HAZE, 50 L × 300 AMD', () => {
    it('DIRECT without bonus: the partner took 15,000 and owes TuTak 500', async () => {
      await hazeTerms();
      const customer = await customerWithBonus();

      const intent = await intents.create({ partnerId, ...fiftyLitres }, customer.user.id);
      expect(new Decimal(intent.quantity!).toFixed(2)).toBe('50.00');
      expect(intent.contributionRuleKind).toBe(ContributionRuleKind.FIXED_PER_UNIT);
      expect(intent.contributionRuleVersion).toBe(1);

      const confirmed = await intents.confirm(intent.id, staffId);
      // 50 × 10 = 500, exactly. Not 450 and not 525.
      expect(new Decimal(confirmed.poolAmount!).toFixed(2)).toBe('500.00');

      // The customer paid the partner in full, so the only movement is
      // TuTak's share: Net Position −500, as the brief says.
      expect((await payable()).toFixed(2)).toBe('-500.00');
      expect((await payableByKind()).get('partner.contribution')?.toFixed(2)).toBe('-500.00');
    });

    it('DIRECT with 1,000 bonus: the partner took 14,000, so Net Position is +500', async () => {
      await hazeTerms();
      const customer = await customerWithBonus('1000');

      const intent = await intents.create(
        { partnerId, ...fiftyLitres, bonusAmountRequested: '1000' },
        customer.user.id,
      );
      expect(new Decimal(intent.ordinaryPaymentRemainder).toFixed(2)).toBe('14000.00');

      const confirmed = await intents.confirm(intent.id, staffId);
      expect(new Decimal(confirmed.poolAmount!).toFixed(2)).toBe('500.00');

      // Entitlement 14,500, received 14,000 → +500.
      expect((await payable()).toFixed(2)).toBe('500.00');
      const byKind = await payableByKind();
      expect(byKind.get('partner.bonus_redemption_compensation')?.toFixed(2)).toBe('1000.00');
      expect(byKind.get('partner.contribution')?.toFixed(2)).toBe('-500.00');
    });

    it('PSP with 1,000 bonus: TuTak took 14,000, so it owes the whole 14,500', async () => {
      await hazeTerms();
      const customer = await customerWithBonus('1000');

      const intent = await intents.create(
        {
          partnerId,
          ...fiftyLitres,
          bonusAmountRequested: '1000',
          paymentRoute: PaymentRoute.TUTAK_PSP,
        },
        customer.user.id,
      );
      await prisma.pspPaymentAttempt.create({
        data: {
          purchaseIntentId: intent.id,
          provider: 'idram',
          status: PspAttemptStatus.INITIATED,
          amount: new Decimal('14000'),
          providerBillId: 'bill-haze-rule',
          liveKey: 'live',
        },
      });
      await psp.settleVerifiedConfirmation({
        billId: 'bill-haze-rule',
        providerTransactionId: 'IDRAM-HAZE-RULE',
        amount: new Decimal('14000'),
        raw: { EDP_BILL_NO: 'bill-haze-rule' },
      });

      const after = await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intent.id } });
      expect(after.status).toBe(PurchaseIntentStatus.CONFIRMED);
      expect(new Decimal(after.poolAmount!).toFixed(2)).toBe('500.00');

      // The partner received nothing at the pump. Net Position +14,500.
      expect((await payable()).toFixed(2)).toBe('14500.00');
      const byKind = await payableByKind();
      expect(byKind.get('psp.payment.captured')?.toFixed(2)).toBe('14000.00');
      expect(byKind.get('partner.bonus_redemption_compensation')?.toFixed(2)).toBe('1000.00');
      expect(byKind.get('partner.contribution')?.toFixed(2)).toBe('-500.00');
    });

    it('charges the same 500 whichever route collected it', async () => {
      await hazeTerms();

      const a = await intents.create(
        { partnerId, ...fiftyLitres },
        (await customerWithBonus()).user.id,
      );
      await intents.confirm(a.id, staffId);
      const direct = new Decimal(
        (await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: a.id } })).poolAmount!,
      );

      const customerB = await customerWithBonus('1000');
      const b = await intents.create(
        {
          partnerId,
          ...fiftyLitres,
          bonusAmountRequested: '1000',
          paymentRoute: PaymentRoute.TUTAK_PSP,
        },
        customerB.user.id,
      );
      await prisma.pspPaymentAttempt.create({
        data: {
          purchaseIntentId: b.id,
          provider: 'idram',
          status: PspAttemptStatus.INITIATED,
          amount: new Decimal('14000'),
          providerBillId: 'bill-parity',
          liveKey: 'live',
        },
      });
      await psp.settleVerifiedConfirmation({
        billId: 'bill-parity',
        providerTransactionId: 'IDRAM-PARITY',
        amount: new Decimal('14000'),
        raw: {},
      });
      const viaPsp = new Decimal(
        (await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: b.id } })).poolAmount!,
      );

      expect(direct.toFixed(2)).toBe('500.00');
      expect(viaPsp.toFixed(2)).toBe(direct.toFixed(2));
    });
  });

  // ── Versioning ─────────────────────────────────────────────────────────

  describe('versions', () => {
    it('numbers versions and keeps exactly one live', async () => {
      const first = await hazeTerms();
      expect(first.version).toBe(1);

      const second = await rules.open({
        partnerId,
        actorId: adminId,
        kind: ContributionRuleKind.FIXED_PER_UNIT,
        fixedPerUnit: '12',
        unit: 'L',
      });
      expect(second.version).toBe(2);

      const live = await prisma.partnerContributionRule.findMany({
        where: { partnerId, liveKey: { not: null } },
      });
      expect(live).toHaveLength(1);
      expect(live[0]?.id).toBe(second.id);

      const closed = await prisma.partnerContributionRule.findUniqueOrThrow({
        where: { id: first.id },
      });
      expect(closed.effectiveUntil).not.toBeNull();
    });

    it('prices yesterday’s purchase at yesterday’s terms', async () => {
      await hazeTerms();
      const customer = await customerWithBonus();
      const intent = await intents.create({ partnerId, ...fiftyLitres }, customer.user.id);

      // The contract is renegotiated while the customer is still at the pump.
      await rules.open({
        partnerId,
        actorId: adminId,
        kind: ContributionRuleKind.FIXED_PER_UNIT,
        fixedPerUnit: '25',
        unit: 'L',
      });

      const confirmed = await intents.confirm(intent.id, staffId);
      // 500, not 1,250. The purchase named version 1 and version 1 is
      // immutable, so there is nothing for the new terms to reach.
      expect(new Decimal(confirmed.poolAmount!).toFixed(2)).toBe('500.00');
      expect(confirmed.contributionRuleVersion).toBe(1);
    });

    it('lets exactly one of two concurrent version opens win', async () => {
      await hazeTerms();

      const results = await Promise.allSettled([
        rules.open({
          partnerId,
          actorId: adminId,
          kind: ContributionRuleKind.FIXED_PER_UNIT,
          fixedPerUnit: '11',
          unit: 'L',
        }),
        rules.open({
          partnerId,
          actorId: staffId,
          kind: ContributionRuleKind.FIXED_PER_UNIT,
          fixedPerUnit: '12',
          unit: 'L',
        }),
      ]);
      // Whatever happened, the partner has one live rule and no duplicate
      // version numbers — which is the only thing that matters.
      const live = await prisma.partnerContributionRule.findMany({
        where: { partnerId, liveKey: { not: null } },
      });
      expect(live).toHaveLength(1);
      expect(results.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);

      const versions = (
        await prisma.partnerContributionRule.findMany({ where: { partnerId } })
      ).map((r) => r.version);
      expect(new Set(versions).size).toBe(versions.length);
    });

    it('refuses to rewrite terms that have already priced money', async () => {
      const rule = await hazeTerms();

      await expect(
        prisma.partnerContributionRule.update({
          where: { id: rule.id },
          data: { fixedPerUnit: new Decimal('999') },
        }),
      ).rejects.toThrow(/immutable; open a new version/i);

      await expect(
        prisma.partnerContributionRule.delete({ where: { id: rule.id } }),
      ).rejects.toThrow(/cannot be deleted/i);
    });

    it('refuses a rule whose numbers do not match its kind', async () => {
      await expect(
        prisma.partnerContributionRule.create({
          data: {
            partnerId,
            version: 1,
            kind: ContributionRuleKind.FIXED_PER_UNIT,
            percentBps: 350,
            liveKey: 'live',
          },
        }),
      ).rejects.toThrow();
    });
  });

  // ── The other two kinds ────────────────────────────────────────────────

  describe('the other kinds', () => {
    it('prices a percentage rule off the 50-point grid, which the partner column cannot', async () => {
      // 333 bps is not on the grid `partners_commission_rate_on_grid`
      // enforces, and that is the point: a rule row is the negotiated
      // contract, not a tidy headline rate.
      await rules.open({
        partnerId,
        actorId: adminId,
        kind: ContributionRuleKind.PERCENT_BPS,
        percentBps: 333,
      });
      const customer = await customerWithBonus();
      const intent = await intents.create({ partnerId, grossAmount: '15000' }, customer.user.id);
      const confirmed = await intents.confirm(intent.id, staffId);

      // 15,000 × 333 / 10,000 = 499.50 — which is exactly why HAZE is not a
      // percentage partner.
      expect(new Decimal(confirmed.poolAmount!).toFixed(2)).toBe('499.50');
    });

    it('adds both legs on a hybrid rule, rounding once at the end', async () => {
      await rules.open({
        partnerId,
        actorId: adminId,
        kind: ContributionRuleKind.HYBRID,
        percentBps: 100,
        fixedPerUnit: '10',
        unit: 'L',
      });
      const customer = await customerWithBonus();
      const intent = await intents.create({ partnerId, ...fiftyLitres }, customer.user.id);
      const confirmed = await intents.confirm(intent.id, staffId);

      // 1 % of 15,000 = 150, plus 50 × 10 = 500 → 650.
      expect(new Decimal(confirmed.poolAmount!).toFixed(2)).toBe('650.00');
    });
  });

  // ── Backward compatibility, which is the part that must not break ─────

  describe('partners with no rule', () => {
    it('prices exactly as before, from the snapshotted basis points', async () => {
      // 500 bps is `createPartner`'s default and the grid's own value.
      const customer = await customerWithBonus();
      const intent = await intents.create({ partnerId, grossAmount: '10000' }, customer.user.id);
      expect(intent.contributionRuleId).toBeNull();
      expect(intent.contributionRuleKind).toBeNull();

      const confirmed = await intents.confirm(intent.id, staffId);
      expect(new Decimal(confirmed.poolAmount!).toFixed(2)).toBe('500.00');
      expect((await payable()).toFixed(2)).toBe('-500.00');
    });

    it('accepts a purchase with no quantity, as every percentage partner sends', async () => {
      await rules.open({
        partnerId,
        actorId: adminId,
        kind: ContributionRuleKind.PERCENT_BPS,
        percentBps: 500,
      });
      const customer = await customerWithBonus();
      await expect(
        intents.create({ partnerId, grossAmount: '10000' }, customer.user.id),
      ).resolves.toBeDefined();
    });
  });

  // ── Refusals ───────────────────────────────────────────────────────────

  describe('a per-unit partner with nothing to multiply', () => {
    it('refuses a purchase that does not say how many were sold', async () => {
      await hazeTerms();
      const customer = await customerWithBonus();

      await expect(
        intents.create({ partnerId, grossAmount: '15000' }, customer.user.id),
      ).rejects.toThrow(/prices per L/i);
    });

    it('refuses a purchase measured in the wrong unit', async () => {
      await hazeTerms();
      const customer = await customerWithBonus();

      await expect(
        intents.create(
          { partnerId, grossAmount: '15000', quantity: '50', quantityUnit: 'kg', unitPrice: '300' },
          customer.user.id,
        ),
      ).rejects.toThrow(/prices per L/i);
    });

    it('refuses a line item whose arithmetic does not close', async () => {
      await hazeTerms();
      const customer = await customerWithBonus();

      await expect(
        intents.create(
          { partnerId, grossAmount: '14000', quantity: '50', quantityUnit: 'L', unitPrice: '300' },
          customer.user.id,
        ),
      ).rejects.toThrow(/must equal/i);
    });

    it('refuses a half-filled line item', async () => {
      const customer = await customerWithBonus();
      await expect(
        intents.create(
          { partnerId, grossAmount: '15000', quantity: '50' },
          customer.user.id,
        ),
      ).rejects.toThrow(/needs all of quantity/i);
    });
  });

  it('refuses at the database level to price a purchase with another partner’s terms', async () => {
    const rule = await hazeTerms();
    const other = await createPartner(prisma, { displayName: 'Somebody Else' });
    const customer = await customerWithBonus();

    await expect(
      prisma.purchaseIntent.create({
        data: {
          customerId: customer.user.id,
          partnerId: other.id,
          status: PurchaseIntentStatus.AWAITING_CONFIRMATION,
          confirmationCode: '9999',
          grossAmount: new Decimal('15000'),
          bonusAmountRequested: new Decimal(0),
          ordinaryPaymentRemainder: new Decimal('15000'),
          negotiatedRateBps: 500,
          maxBonusPaymentPercent: 100,
          quantity: new Decimal('50'),
          quantityUnit: 'L',
          unitPrice: new Decimal('300'),
          contributionRuleId: rule.id,
          contributionRuleVersion: rule.version,
          contributionRuleKind: rule.kind,
          expiresAt: new Date(Date.now() + 180_000),
        },
      }),
    ).rejects.toThrow(/cannot be priced by partner/i);
  });
});
