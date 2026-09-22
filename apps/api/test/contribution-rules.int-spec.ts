import {
  ContributionRuleKind,
  ContributionRuleStatus,
  LedgerAccountType,
  PaymentRoute,
  PostingDirection,
  PrismaClient,
  PspAttemptStatus,
  PurchaseIntentStatus,
  UnitOfMeasure,
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
 * The product decision of 15.09.2026 was to fix neither by rounding the contract
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
  /** The second pair of eyes. Terms take two people since 15.09.2026. */
  let checkerId = '';

  beforeEach(async () => {
    await truncateAll(prisma);
    partnerId = (await createPartner(prisma)).id;
    staffId = (await createStaffUser(prisma, { partnerId })).id;
    adminId = (await createStaffUser(prisma)).id;
    checkerId = (await createStaffUser(prisma)).id;
  });

  /**
   * HAZE's terms, proposed and approved — which since 15.09.2026 is two acts
   * by two people, so every test that needs live terms goes through both.
   */
  async function hazeTerms() {
    return agreeTerms({
      kind: ContributionRuleKind.FIXED_PER_UNIT,
      fixedPerUnit: '10',
      unit: UnitOfMeasure.LITER,
      note: 'HAZE: 300 AMD/л клиенту, 290 партнёру, 10 TuTak',
    });
  }

  /** Propose as one person, approve as another. */
  async function agreeTerms(terms: {
    kind: ContributionRuleKind;
    percentBps?: number;
    fixedPerUnit?: string;
    unit?: UnitOfMeasure;
    note?: string;
  }) {
    const proposal = await rules.propose({ partnerId, actorId: adminId, ...terms });
    return rules.approve(proposal.id, { actorId: checkerId });
  }

  /** 50 litres at 300 — the brief's own example. */
  const fiftyLitres = {
    grossAmount: '15000',
    quantity: '50',
    quantityUnit: UnitOfMeasure.LITER,
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

  /**
   * Confirm a direct purchase the way a cashier does.
   *
   * `confirm()` stamps the merchant approval on the way past, so for a
   * percentage partner this is unchanged. For a per-unit partner the cashier
   * has to type the line item back, which is the whole point of decision 3 —
   * so this helper reads the purchase and echoes what is on it, exactly as a
   * cashier reading the pump would.
   */
  async function approveAndConfirm(intentId: string) {
    const intent = await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intentId } });
    return intents.confirm(intentId, staffId, {
      quantity: intent.quantity?.toString(),
      quantityUnit: intent.quantityUnit ?? undefined,
      unitPrice: intent.unitPrice?.toString(),
    });
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

      const confirmed = await approveAndConfirm(intent.id);
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

      const confirmed = await approveAndConfirm(intent.id);
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
      await intents.approveForPayment(intent.id, staffId, {
        quantity: '50',
        quantityUnit: UnitOfMeasure.LITER,
        unitPrice: '300',
      });
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
      await approveAndConfirm(a.id);
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
      await intents.approveForPayment(b.id, staffId, {
        quantity: '50',
        quantityUnit: UnitOfMeasure.LITER,
        unitPrice: '300',
      });
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

  describe('versions, proposed and approved', () => {
    it('numbers versions and keeps exactly one live', async () => {
      const first = await hazeTerms();
      expect(first.version).toBe(1);
      expect(first.status).toBe(ContributionRuleStatus.ACTIVE);

      const second = await agreeTerms({
        kind: ContributionRuleKind.FIXED_PER_UNIT,
        fixedPerUnit: '12',
        unit: UnitOfMeasure.LITER,
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
      expect(closed.status).toBe(ContributionRuleStatus.SUPERSEDED);
      expect(closed.effectiveUntil).not.toBeNull();
    });

    it('prices yesterday’s purchase at yesterday’s terms', async () => {
      await hazeTerms();
      const customer = await customerWithBonus();
      const intent = await intents.create({ partnerId, ...fiftyLitres }, customer.user.id);

      // The contract is renegotiated while the customer is still at the pump.
      await agreeTerms({
        kind: ContributionRuleKind.FIXED_PER_UNIT,
        fixedPerUnit: '25',
        unit: UnitOfMeasure.LITER,
      });

      const confirmed = await approveAndConfirm(intent.id);
      // 500, not 1,250. The purchase named version 1 and version 1 is
      // immutable, so there is nothing for the new terms to reach.
      expect(new Decimal(confirmed.poolAmount!).toFixed(2)).toBe('500.00');
      expect(confirmed.contributionRuleVersion).toBe(1);
    });

    // ── Maker/checker ────────────────────────────────────────────────────

    it('changes nothing on a proposal alone', async () => {
      await hazeTerms();
      const proposal = await rules.propose({
        partnerId,
        actorId: adminId,
        kind: ContributionRuleKind.FIXED_PER_UNIT,
        fixedPerUnit: '25',
        unit: UnitOfMeasure.LITER,
      });

      expect(proposal.status).toBe(ContributionRuleStatus.PROPOSED);
      // A proposal is inert: no number, no window, no claim to be in force.
      // That is what stops a losing concurrent write becoming "the next
      // version" — it never had a number to keep.
      expect(proposal.version).toBeNull();
      expect(proposal.liveKey).toBeNull();

      const live = await rules.liveRule(partnerId);
      expect(new Decimal(live!.fixedPerUnit!).toFixed(2)).toBe('10.00');

      // And a purchase made right now is still priced at 10 AMD per litre.
      const customer = await customerWithBonus();
      const intent = await intents.create({ partnerId, ...fiftyLitres }, customer.user.id);
      const confirmed = await approveAndConfirm(intent.id);
      expect(new Decimal(confirmed.poolAmount!).toFixed(2)).toBe('500.00');
    });

    it('will not let the proposer approve their own terms', async () => {
      const proposal = await rules.propose({
        partnerId,
        actorId: adminId,
        kind: ContributionRuleKind.FIXED_PER_UNIT,
        fixedPerUnit: '10',
        unit: UnitOfMeasure.LITER,
      });

      await expect(rules.approve(proposal.id, { actorId: adminId })).rejects.toThrow(
        /second person has to approve/i,
      );
      expect(await rules.liveRule(partnerId)).toBeNull();
    });

    it('refuses at the database level to record one person as both maker and checker', async () => {
      const proposal = await rules.propose({
        partnerId,
        actorId: adminId,
        kind: ContributionRuleKind.FIXED_PER_UNIT,
        fixedPerUnit: '10',
        unit: UnitOfMeasure.LITER,
      });

      await expect(
        prisma.partnerContributionRule.update({
          where: { id: proposal.id },
          data: {
            status: ContributionRuleStatus.ACTIVE,
            version: 1,
            liveKey: 'live',
            approvedByUserId: adminId,
            approvedAt: new Date(),
          },
        }),
      ).rejects.toThrow();
    });

    /**
     * The failure this whole redesign exists for.
     *
     * `open()` used to write a live rule and retry on conflict, so two
     * administrators changing a margin at the same moment did not collide:
     * one won version 4 and the loser's retry re-read the state and became
     * version 5. Both looked deliberate and audited. Nobody agreed to the
     * combination, and the partner ended up on whichever was written second.
     */
    it('does not let two competing approvals both become versions', async () => {
      await hazeTerms(); // version 1, 10 AMD/L

      const a = await rules.propose({
        partnerId,
        actorId: adminId,
        kind: ContributionRuleKind.FIXED_PER_UNIT,
        fixedPerUnit: '11',
        unit: UnitOfMeasure.LITER,
      });
      const b = await rules.propose({
        partnerId,
        actorId: adminId,
        kind: ContributionRuleKind.FIXED_PER_UNIT,
        fixedPerUnit: '12',
        unit: UnitOfMeasure.LITER,
      });

      const results = await Promise.allSettled([
        rules.approve(a.id, { actorId: checkerId }),
        rules.approve(b.id, { actorId: staffId }),
      ]);

      // Exactly one. Not "one now and the other a moment later".
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const loser = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(String(loser.reason)).toMatch(/approved a moment ago/i);

      const active = await prisma.partnerContributionRule.findMany({
        where: { partnerId, status: ContributionRuleStatus.ACTIVE },
      });
      expect(active).toHaveLength(1);
      expect(active[0]?.version).toBe(2);

      // The loser is still a proposal for a human to look at, not a silently
      // applied second change.
      const proposals = await rules.pendingProposals(partnerId);
      expect(proposals).toHaveLength(1);
      expect(proposals[0]?.version).toBeNull();

      const versions = (
        await prisma.partnerContributionRule.findMany({
          where: { partnerId, version: { not: null } },
        })
      ).map((r) => r.version);
      expect(versions.sort()).toEqual([1, 2]);
    });

    it('lets many proposals coexist without conflicting', async () => {
      const proposed = await Promise.all(
        ['11', '12', '13', '14'].map((amount) =>
          rules.propose({
            partnerId,
            actorId: adminId,
            kind: ContributionRuleKind.FIXED_PER_UNIT,
            fixedPerUnit: amount,
            unit: UnitOfMeasure.LITER,
          }),
        ),
      );
      // Four suggestions is a normal thing for people to make. None of them
      // prices anything, so none of them can collide.
      expect(proposed).toHaveLength(4);
      expect(await rules.liveRule(partnerId)).toBeNull();
      expect(await rules.pendingProposals(partnerId)).toHaveLength(4);
    });

    it('records a rejection rather than losing it', async () => {
      const proposal = await rules.propose({
        partnerId,
        actorId: adminId,
        kind: ContributionRuleKind.FIXED_PER_UNIT,
        fixedPerUnit: '99',
        unit: UnitOfMeasure.LITER,
      });

      await expect(rules.reject(proposal.id, { actorId: adminId, reason: 'no' })).rejects.toThrow(
        /somebody else has to turn them down/i,
      );

      const rejected = await rules.reject(proposal.id, {
        actorId: checkerId,
        reason: 'Not what was agreed with the partner',
      });
      expect(rejected.status).toBe(ContributionRuleStatus.REJECTED);
      expect(rejected.version).toBeNull();
      expect(await rules.liveRule(partnerId)).toBeNull();

      await expect(rules.approve(proposal.id, { actorId: checkerId })).rejects.toThrow(
        /only a proposal can be approved/i,
      );
    });

    it('refuses to rewrite terms that have already priced money', async () => {
      const rule = await hazeTerms();

      await expect(
        prisma.partnerContributionRule.update({
          where: { id: rule.id },
          data: { fixedPerUnit: new Decimal('999') },
        }),
      ).rejects.toThrow(/immutable; propose a new version/i);

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
            status: ContributionRuleStatus.ACTIVE,
            approvedByUserId: checkerId,
            approvedAt: new Date(),
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
      await agreeTerms({ kind: ContributionRuleKind.PERCENT_BPS, percentBps: 333 });
      const customer = await customerWithBonus();
      const intent = await intents.create({ partnerId, grossAmount: '15000' }, customer.user.id);
      const confirmed = await approveAndConfirm(intent.id);

      // 15,000 × 333 / 10,000 = 499.50 — which is exactly why HAZE is not a
      // percentage partner.
      expect(new Decimal(confirmed.poolAmount!).toFixed(2)).toBe('499.50');
    });

    it('adds both legs on a hybrid rule, rounding once at the end', async () => {
      await agreeTerms({
        kind: ContributionRuleKind.HYBRID,
        percentBps: 100,
        fixedPerUnit: '10',
        unit: UnitOfMeasure.LITER,
      });
      const customer = await customerWithBonus();
      const intent = await intents.create({ partnerId, ...fiftyLitres }, customer.user.id);
      const confirmed = await approveAndConfirm(intent.id);

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

      const confirmed = await approveAndConfirm(intent.id);
      expect(new Decimal(confirmed.poolAmount!).toFixed(2)).toBe('500.00');
      expect((await payable()).toFixed(2)).toBe('-500.00');
    });

    it('accepts a purchase with no quantity, as every percentage partner sends', async () => {
      await agreeTerms({ kind: ContributionRuleKind.PERCENT_BPS, percentBps: 500 });
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
          {
            partnerId,
            grossAmount: '15000',
            quantity: '50',
            quantityUnit: UnitOfMeasure.KILOGRAM,
            unitPrice: '300',
          },
          customer.user.id,
        ),
      ).rejects.toThrow(/prices per L/i);
    });

    it('refuses a line item whose arithmetic does not close', async () => {
      await hazeTerms();
      const customer = await customerWithBonus();

      await expect(
        intents.create(
          {
            partnerId,
            grossAmount: '14000',
            quantity: '50',
            quantityUnit: UnitOfMeasure.LITER,
            unitPrice: '300',
          },
          customer.user.id,
        ),
      ).rejects.toThrow(/must equal/i);
    });

    it('refuses a half-filled line item', async () => {
      const customer = await customerWithBonus();
      await expect(
        intents.create({ partnerId, grossAmount: '15000', quantity: '50' }, customer.user.id),
      ).rejects.toThrow(/needs all of quantity/i);
    });
  });

  /**
   * A unit of measure is an identifier the arithmetic compares, not a label.
   *
   * It used to be a free string, and the product decision of 15.09.2026 names the
   * consequence: "L", "l", "л", "litre" and "liter" are five different units
   * to an equality check, and that check decides whether 10 AMD per litre may
   * be multiplied by a quantity. A partner whose till sends "л" while their
   * contract says "L" is a partner whose purchases are silently refused —
   * or, worse, a mismatch some later helpful normalisation resolves the wrong
   * way.
   */
  describe('units', () => {
    it('refuses a unit outside the vocabulary, at the database level', async () => {
      await hazeTerms();
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE "partner_contribution_rules" SET "unit" = 'л' WHERE "partnerId" = $1`,
          partnerId,
        ),
      ).rejects.toThrow();
    });

    it('will not let a purchase be measured in a unit that does not exist', async () => {
      await hazeTerms();
      const customer = await customerWithBonus();

      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO "purchase_intents"
             ("id","customerId","partnerId","confirmationCode","grossAmount",
              "ordinaryPaymentRemainder","negotiatedRateBps","maxBonusPaymentPercent",
              "quantity","quantityUnit","unitPrice","expiresAt")
           VALUES (gen_random_uuid()::text, $1, $2, '7777', 15000, 15000, 500, 100,
                   50, 'litre', 300, now() + interval '3 minutes')`,
          customer.user.id,
          partnerId,
        ),
      ).rejects.toThrow();
    });

    it('matches a purchase to its terms by the same value, not by spelling', async () => {
      await hazeTerms(); // priced per LITER
      const customer = await customerWithBonus();

      // KWH is a real unit and a real mismatch, and it is caught as a
      // mismatch rather than as a string that happens not to be equal.
      await expect(
        intents.create(
          {
            partnerId,
            grossAmount: '15000',
            quantity: '50',
            quantityUnit: UnitOfMeasure.KWH,
            unitPrice: '300',
          },
          customer.user.id,
        ),
      ).rejects.toThrow(/prices per LITER/i);
    });

    it('carries the unit onto the purchase as the same enum the terms hold', async () => {
      const rule = await hazeTerms();
      const customer = await customerWithBonus();
      const intent = await intents.create({ partnerId, ...fiftyLitres }, customer.user.id);

      expect(rule.unit).toBe(UnitOfMeasure.LITER);
      expect(intent.quantityUnit).toBe(UnitOfMeasure.LITER);
      expect(intent.quantityUnit).toBe(rule.unit);
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
          quantityUnit: UnitOfMeasure.LITER,
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
