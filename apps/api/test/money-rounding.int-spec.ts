import { BonusEntryType, PrismaClient, TransactionStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { EvSessionsService } from '../src/modules/ev-charging/ev-sessions.service';
import { QrPaymentsService } from '../src/modules/qr-payments/qr-payments.service';
import { BonusEngineService } from '../src/modules/wallet/bonus-engine.service';
import { MONEY_SCALE } from '../src/common/utils/money';
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

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    sessions = harness.app.get(EvSessionsService);
    qr = harness.app.get(QrPaymentsService);
    engine = harness.app.get(BonusEngineService);
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

  /** Every stored money value must fit the column that holds it. */
  const assertStorable = (value: Decimal, what: string) => {
    expect({ what, dp: value.decimalPlaces() }).toEqual({ what, dp: expect.any(Number) });
    expect(value.decimalPlaces()).toBeLessThanOrEqual(MONEY_SCALE);
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
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 333 });
      const connector = await createEvConnector(prisma, {
        partnerId: partner.id,
        pricePerKwh: '100.25',
      });

      const session = await sessions.start({ connectorId: connector.id }, user.id);
      await backdate(session.id);
      await sessions.reportMeterValue(session.id, '25.123', user.id);
      const result = await sessions.stop(session.id, user.id, {});

      // 2518.5808 × 333 ÷ 10000 = 83.86874064 — eight decimals before rounding.
      const earned = new Decimal(result.bonusEarned);
      assertStorable(earned, 'bonus earned');
      expect(earned.toString()).toBe('83.8687');

      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(after.pendingBonus.plus(after.availableBonus).toString()).toBe('83.8687');
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
      expect(result.bonusEarned).toBe('125');
    });
  });

  describe('QR payments', () => {
    it('accrues on an amount whose commission does not divide evenly', async () => {
      const { user, wallet } = await createCustomer(prisma);
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 333 });
      const code = await createDynamicInvoiceQr(prisma, {
        partnerId: partner.id,
        amount: '1234.5678',
      });

      const result = await qr.redeem({ token: code.token, idempotencyKey: 'round-1' }, user.id);

      // 1234.5678 × 333 ÷ 10000 = 41.11110774 → 41.1111.
      expect(result.bonusEarned).toBe('41.1111');
      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(after.pendingBonus.plus(after.availableBonus).toString()).toBe('41.1111');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('accrues on the paid portion when points cover part of the bill', async () => {
      const { user, wallet } = await createCustomer(prisma);
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 333 });
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
      // 1000 × 333 ÷ 10000 = 33.3.
      expect(result.bonusEarned).toBe('33.3');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('rounds an accrual too small to store down to nothing, without failing the payment', async () => {
      // 0.0001 × 1 bps ÷ 10⁴ is 10⁻⁸ — real, and smaller than the platform
      // can record. The payment must still go through; the customer simply
      // earns nothing on a hundredth of a luma.
      const { user, wallet } = await createCustomer(prisma);
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 1 });
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
});
