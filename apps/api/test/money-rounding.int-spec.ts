import {
  BonusEntryType,
  PostingDirection,
  PrismaClient,
  PurchaseIntentStatus,
  RoleName,
  TransactionStatus,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { EvSessionsService } from '../src/modules/ev-charging/ev-sessions.service';
import { QrPaymentsService } from '../src/modules/qr-payments/qr-payments.service';
import { PurchaseIntentsService } from '../src/modules/purchase-intents/purchase-intents.service';
import { BonusEngineService } from '../src/modules/wallet/bonus-engine.service';
import { MONEY_SCALE } from '../src/common/utils/money';
import {
  COMMISSION_RATE_MAX_BPS,
  COMMISSION_RATE_MIN_BPS,
  COMMISSION_RATE_STEP_BPS,
} from '../src/common/validators/is-commission-rate-bps.validator';
import { createCustomer, createDynamicInvoiceQr, createEvConnector, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';
import { assertWalletIntegrity } from './setup/invariants';

/**
 * Money that does not divide evenly.
 *
 * Every monetary column is `Decimal(18,4)` and `parseMoney` refuses anything
 * with more than four decimal places — correctly, because a value the column
 * cannot hold is a value Postgres would silently round on the way in. But
 * `parseMoney` guards *caller-supplied* amounts, and the amounts that actually
 * overflow that scale are the ones the platform computes for itself:
 *
 *   energy × price      3 dp × 2 dp = 5 dp
 *   amount × bps ÷ 10⁴  4 dp ÷ 10⁴  = 8 dp
 *
 * The financial core already rounds explicitly at every such point. The
 * loyalty and EV paths did not, so the guard meant to protect the ledger
 * refused the platform's own arithmetic — a charging session with a
 * fractional meter reading and a fractional tariff could not be stopped at
 * all, and an accrual on a fractional amount failed the payment that earned
 * it.
 *
 * These tests use deliberately awkward numbers. Whole amounts and round rates
 * happen to divide cleanly, which is why this survived every earlier suite.
 */
describe('Money rounding (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let sessions: EvSessionsService;
  let qr: QrPaymentsService;
  let engine: BonusEngineService;
  let purchaseIntents: PurchaseIntentsService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    sessions = harness.app.get(EvSessionsService);
    qr = harness.app.get(QrPaymentsService);
    engine = harness.app.get(BonusEngineService);
    purchaseIntents = harness.app.get(PurchaseIntentsService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  const backdate = (sessionId: string, hours = 3) =>
    prisma.evSession.update({
      where: { id: sessionId },
      data: { startedAt: new Date(Date.now() - hours * 3_600_000) },
    });

  /**
   * Every stored money value must fit the column that holds it.
   *
   * Named in the assertion so a failure says *which* value overflowed rather
   * than just reporting a number of decimal places.
   */
  const assertStorable = (value: Decimal, what: string) => {
    expect({ what, decimals: value.decimalPlaces() <= MONEY_SCALE }).toEqual({
      what,
      decimals: true,
    });
  };

  describe('EV charging', () => {
    it('bills a fractional meter reading at a fractional tariff', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
      // 100.25 AMD/kWh — a tariff with minor units, which the column allows
      // and a real operator would set.
      const connector = await createEvConnector(prisma, {
        partnerId: partner.id,
        pricePerKwh: '100.25',
      });

      const session = await sessions.start({ connectorId: connector.id }, user.id);
      await backdate(session.id);
      // 3 decimal places, which `energyKwh` is declared to hold.
      await sessions.reportMeterValue(session.id, '25.123', user.id);

      const result = await sessions.stop(session.id, user.id, {});

      // 25.123 × 100.25 = 2518.58075 — five decimals, rounded to four.
      expect(result.cost).toBe('2518.5808');
      const charge = await prisma.transaction.findFirstOrThrow({
        where: { userId: user.id, type: 'EV_CHARGING' },
      });
      expect(charge.status).toBe(TransactionStatus.COMPLETED);
      assertStorable(charge.amount, 'transaction amount');
    });

    it('accrues a storable number of points on that bill', async () => {
      const { user, wallet } = await createCustomer(prisma);
      // 350 bps (3.5%) is on the commission-rate grid; 333 (the value this
      // test used before the grid existed) is not.
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 350 });
      const connector = await createEvConnector(prisma, {
        partnerId: partner.id,
        pricePerKwh: '100.25',
      });

      const session = await sessions.start({ connectorId: connector.id }, user.id);
      await backdate(session.id);
      await sessions.reportMeterValue(session.id, '25.123', user.id);
      const result = await sessions.stop(session.id, user.id, {});

      // 2518.5808 × 350 ÷ 10000 = 88.150328 — six decimals before rounding
      // to a pool of 88.1503. FastCharge settles like every other purchase
      // (business decision, 2026-08-18): TuTak takes 40% off the top
      // (35.2601), leaving 52.8902 to split 20/30/20/30 — the customer's
      // immediate green share is 20% of that = 10.578.
      const earned = new Decimal(result.bonusEarned);
      assertStorable(earned, 'bonus earned');
      expect(earned.toString()).toBe('10.578');

      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(after.pendingBonus.plus(after.availableBonus).toString()).toBe('10.578');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('bills a reading whose product needs no rounding, unchanged', async () => {
      // The regression guard on the fix: rounding must not perturb the values
      // that were already exact, which is every whole-number case.
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
      const connector = await createEvConnector(prisma, {
        partnerId: partner.id,
        pricePerKwh: '100.00',
      });

      const session = await sessions.start({ connectorId: connector.id }, user.id);
      await backdate(session.id);
      await sessions.reportMeterValue(session.id, '25', user.id);
      const result = await sessions.stop(session.id, user.id, {});

      expect(result.cost).toBe('2500');
      // 5% of 2500 = 125 pool → 75 remainder after TuTak's 40% upfront cut
      // → 15 green (20% of 75).
      expect(result.bonusEarned).toBe('15');
    });
  });

  describe('QR payments', () => {
    it('accrues on an amount whose commission does not divide evenly', async () => {
      const { user, wallet } = await createCustomer(prisma);
      // 350 bps (3.5%) is on the commission-rate grid; 333 (the value this
      // test used before the grid existed) is not.
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 350 });
      const code = await createDynamicInvoiceQr(prisma, {
        partnerId: partner.id,
        amount: '1234.5678',
      });

      const result = await qr.redeem({ token: code.token, idempotencyKey: 'round-1' }, user.id);

      // 1234.5678 × 350 ÷ 10000 = 43.209873 → 43.2098.
      expect(result.bonusEarned).toBe('43.2098');
      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(after.pendingBonus.plus(after.availableBonus).toString()).toBe('43.2098');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('accrues on the paid portion when points cover part of the bill', async () => {
      const { user, wallet } = await createCustomer(prisma);
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 350 });
      await engine.accrue({
        walletId: wallet.id,
        type: BonusEntryType.ACCRUAL_PURCHASE,
        amount: '1000',
        pendingHours: 0,
      });
      const code = await createDynamicInvoiceQr(prisma, {
        partnerId: partner.id,
        amount: '1234.5678',
      });

      const result = await qr.redeem(
        { token: code.token, bonusAmountToApply: '234.5678', idempotencyKey: 'round-2' },
        user.id,
      );

      // Points never earn points: only the 1000 actually paid does.
      // 1000 × 350 ÷ 10000 = 35.
      expect(result.bonusEarned).toBe('35');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('rounds an accrual too small to store down to nothing, without failing the payment', async () => {
      // 0.0001 × 50 bps (the grid's floor) ÷ 10⁴ is 5×10⁻⁷ — real, and
      // smaller than the platform can record. The payment must still go
      // through; the customer simply earns nothing on a fraction of a luma.
      const { user, wallet } = await createCustomer(prisma);
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 50 });
      const code = await createDynamicInvoiceQr(prisma, {
        partnerId: partner.id,
        amount: '0.0001',
      });

      const result = await qr.redeem({ token: code.token, idempotencyKey: 'round-3' }, user.id);

      expect(result.bonusEarned).toBe('0');
      const charge = await prisma.transaction.findFirstOrThrow({ where: { userId: user.id } });
      expect(charge.status).toBe(TransactionStatus.COMPLETED);
      await assertWalletIntegrity(prisma, wallet.id);
    });
  });

  describe('PurchaseIntent settlement across the commission-rate grid', () => {
    const staffMember = async (partnerId: string) => {
      const { user } = await createCustomer(prisma);
      const role = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.PARTNER_OWNER } });
      await prisma.userRole.create({ data: { userId: user.id, roleId: role.id, partnerId } });
      return user;
    };

    const GRID = Array.from(
      { length: (COMMISSION_RATE_MAX_BPS - COMMISSION_RATE_MIN_BPS) / COMMISSION_RATE_STEP_BPS + 1 },
      (_, i) => COMMISSION_RATE_MIN_BPS + i * COMMISSION_RATE_STEP_BPS,
    );

    /**
     * Before `pool` was rounded up front (see `settlePurchase`), it was
     * computed unrounded and only each of the four split legs was truncated
     * independently — the legs then summed to slightly less than the
     * (unrounded) debit for any gross/rate combination whose product didn't
     * happen to divide evenly across all three truncations, and
     * `LedgerService.post` correctly rejected the resulting unbalanced
     * transaction, permanently stranding the purchase. Every other test in
     * this codebase uses a rate and gross that divides evenly — 5000 × 500 ÷
     * 10000 = 250, no remainder anywhere — which is why this was never
     * caught. This sweeps every rate the commission grid now allows against
     * one deliberately awkward amount.
     */
    it.each(GRID)('settles a %p bps purchase of an awkward gross amount', async (bps) => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma, { bonusAccrualRateBps: bps });
      const staff = await staffMember(partner.id);

      const intent = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '1234.57' },
        user.id,
      );

      const confirmed = await purchaseIntents.confirm(intent.id, staff.id);
      expect(confirmed.status).toBe(PurchaseIntentStatus.CONFIRMED);

      // The debit and the credits are one balanced transaction — if they
      // didn't sum to zero, `confirm` above would already have thrown and
      // rolled back. Checked again here explicitly rather than only
      // inferred from "it didn't throw".
      const postings = await prisma.ledgerPosting.findMany({
        where: { transaction: { sourceType: 'PurchaseIntent', sourceId: intent.id } },
      });
      const sumBy = (direction: PostingDirection) =>
        postings
          .filter((p) => p.direction === direction)
          .reduce((sum, p) => sum.plus(p.amount), new Decimal(0));
      expect(sumBy(PostingDirection.DEBIT).toString()).toBe(sumBy(PostingDirection.CREDIT).toString());
    });

    it.each([
      [COMMISSION_RATE_MIN_BPS, '999.99'],
      [COMMISSION_RATE_MAX_BPS, '1'],
      [1050, '54321.13'],
    ])('settles %p bps against gross %p — grid boundaries × more awkward amounts', async (bps, gross) => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma, { bonusAccrualRateBps: bps as number });
      const staff = await staffMember(partner.id);

      const intent = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: gross as string },
        user.id,
      );
      const confirmed = await purchaseIntents.confirm(intent.id, staff.id);
      expect(confirmed.status).toBe(PurchaseIntentStatus.CONFIRMED);
    });
  });
});
