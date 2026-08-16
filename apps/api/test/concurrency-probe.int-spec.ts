import {
  BonusEntryType,
  BonusReservationStatus,
  EvSessionStatus,
  PrismaClient,
  TransactionStatus,
} from '@prisma/client';
import { EvSessionsService } from '../src/modules/ev-charging/ev-sessions.service';
import { QrPaymentsService } from '../src/modules/qr-payments/qr-payments.service';
import { BonusEngineService } from '../src/modules/wallet/bonus-engine.service';
import { createCustomer, createDynamicInvoiceQr, createEvConnector, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';
import { assertWalletIntegrity } from './setup/invariants';

/**
 * Money paths under genuine parallelism.
 *
 * Every existing suite drives these operations one after another, and the
 * sequential form of each of these cases already passes — "refuses to stop
 * the same session twice" is a test that exists and is green. What is being
 * asked here is different and is the only version a real client produces: two
 * requests *in flight at the same time*, which is what a double tap on a
 * flaky connection, a client retry after a timeout, or a load balancer
 * replaying a request actually looks like.
 *
 * The pattern throughout is `Promise.allSettled` on operations started
 * without awaiting the first, then assertions against the **database** rather
 * than the responses. "Both calls returned 200" and "the customer was charged
 * twice" are different claims, and only the second one costs money.
 */
describe('Concurrency probe (integration)', () => {
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

  const backdate = (sessionId: string, hours = 2) =>
    prisma.evSession.update({
      where: { id: sessionId },
      data: { startedAt: new Date(Date.now() - hours * 3_600_000) },
    });

  const scenario = async (options: { availableBonus?: string; rateBps?: number } = {}) => {
    const { user, wallet } = await createCustomer(prisma);
    const partner = await createPartner(prisma, { bonusAccrualRateBps: options.rateBps ?? 500 });
    const connector = await createEvConnector(prisma, {
      partnerId: partner.id,
      pricePerKwh: '100.00',
    });
    if (options.availableBonus) {
      await engine.accrue({
        walletId: wallet.id,
        type: BonusEntryType.ACCRUAL_PURCHASE,
        amount: options.availableBonus,
        pendingHours: 0,
      });
    }
    return { user, wallet, partner, connector };
  };

  /** How many of a set of settled promises succeeded. */
  const fulfilled = (results: PromiseSettledResult<unknown>[]) =>
    results.filter((r) => r.status === 'fulfilled').length;

  describe('stopping a charging session', () => {
    it('bills exactly once when two stops race', async () => {
      const { user, connector } = await scenario();
      const session = await sessions.start({ connectorId: connector.id }, user.id);
      await backdate(session.id);
      await sessions.reportMeterValue(session.id, '25', user.id);

      // Neither is awaited before the other starts. This is the shape of a
      // double tap, and of a client retrying a request that timed out while
      // the server was still working on it.
      const results = await Promise.allSettled([
        sessions.stop(session.id, user.id, {}),
        sessions.stop(session.id, user.id, {}),
      ]);

      expect(fulfilled(results)).toBe(1);

      // The assertion that matters is the bill, not the response. A second
      // EV_CHARGING transaction here is the customer paying twice for one
      // charge.
      const charges = await prisma.transaction.findMany({
        where: { userId: user.id, type: 'EV_CHARGING' },
      });
      expect(charges).toHaveLength(1);
      expect(charges[0]!.status).toBe(TransactionStatus.COMPLETED);
    });

    it('accrues points exactly once when two stops race', async () => {
      const { user, wallet, connector } = await scenario({ rateBps: 500 });
      const session = await sessions.start({ connectorId: connector.id }, user.id);
      await backdate(session.id);
      await sessions.reportMeterValue(session.id, '25', user.id);

      await Promise.allSettled([
        sessions.stop(session.id, user.id, {}),
        sessions.stop(session.id, user.id, {}),
      ]);

      // 25 kWh × 100 AMD × 5% = 125 points, once.
      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(after.pendingBonus.plus(after.availableBonus).toString()).toBe('125');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('spends the customer bonus exactly once when two stops race', async () => {
      const { user, wallet, connector } = await scenario({ availableBonus: '1000' });
      const session = await sessions.start({ connectorId: connector.id }, user.id);
      await backdate(session.id);
      await sessions.reportMeterValue(session.id, '25', user.id);

      await Promise.allSettled([
        sessions.stop(session.id, user.id, { bonusAmountToApply: '500' }),
        sessions.stop(session.id, user.id, { bonusAmountToApply: '500' }),
      ]);

      // Two settled reservations against one session means the customer paid
      // 1000 points for a 2500 AMD charge they applied 500 to.
      const settled = await prisma.bonusReservation.count({
        where: { walletId: wallet.id, status: BonusReservationStatus.SETTLED },
      });
      expect(settled).toBe(1);
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('leaves the connector free and the session closed after a race', async () => {
      const { user, connector } = await scenario();
      const session = await sessions.start({ connectorId: connector.id }, user.id);
      await backdate(session.id);
      await sessions.reportMeterValue(session.id, '10', user.id);

      await Promise.allSettled([
        sessions.stop(session.id, user.id, {}),
        sessions.stop(session.id, user.id, {}),
      ]);

      const after = await prisma.evSession.findUniqueOrThrow({ where: { id: session.id } });
      expect(after.status).toBe(EvSessionStatus.COMPLETED);
      // A bay stuck CHARGING is revenue the partner cannot earn.
      const bay = await prisma.evConnector.findUniqueOrThrow({ where: { id: connector.id } });
      expect(bay.status).not.toBe('CHARGING');
    });
  });

  describe('starting a charging session', () => {
    it('gives a connector to exactly one of two racing customers', async () => {
      const a = await createCustomer(prisma, { phone: '+37477810001' });
      const b = await createCustomer(prisma, { phone: '+37477810002' });
      const partner = await createPartner(prisma);
      const connector = await createEvConnector(prisma, { partnerId: partner.id });

      const results = await Promise.allSettled([
        sessions.start({ connectorId: connector.id }, a.user.id),
        sessions.start({ connectorId: connector.id }, b.user.id),
      ]);

      expect(fulfilled(results)).toBe(1);
      // Two live sessions on one physical connector is two customers billed
      // for the same electricity.
      const live = await prisma.evSession.count({
        where: {
          connectorId: connector.id,
          status: { in: [EvSessionStatus.CHARGING, EvSessionStatus.AUTHORIZED] },
        },
      });
      expect(live).toBe(1);
    });
  });

  describe('redeeming a QR code', () => {
    it('redeems exactly once when two requests race', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma);
      const code = await createDynamicInvoiceQr(prisma, {
        partnerId: partner.id,
        amount: '5000',
      });

      const results = await Promise.allSettled([
        qr.redeem({ token: code.token, idempotencyKey: 'race-a' }, user.id),
        qr.redeem({ token: code.token, idempotencyKey: 'race-b' }, user.id),
      ]);

      expect(fulfilled(results)).toBe(1);
      const completed = await prisma.transaction.count({
        where: { userId: user.id, status: TransactionStatus.COMPLETED },
      });
      expect(completed).toBe(1);
    });

    it('returns the loser their points rather than keeping them spent', async () => {
      const { user, wallet } = await createCustomer(prisma);
      const partner = await createPartner(prisma);
      await engine.accrue({
        walletId: wallet.id,
        type: BonusEntryType.ACCRUAL_PURCHASE,
        amount: '2000',
        pendingHours: 0,
      });
      const code = await createDynamicInvoiceQr(prisma, {
        partnerId: partner.id,
        amount: '5000',
      });

      // Both reserve and settle before the code flip decides the winner, so
      // the loser has already spent points by the time it loses. The
      // compensating leg is what has to give them back.
      await Promise.allSettled([
        qr.redeem({ token: code.token, bonusAmountToApply: '500', idempotencyKey: 'lose-a' }, user.id),
        qr.redeem({ token: code.token, bonusAmountToApply: '500', idempotencyKey: 'lose-b' }, user.id),
      ]);

      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      // 2000 in, 500 spent on the one redemption that won.
      expect(after.availableBonus.toString()).toBe('1500');
      expect(after.reservedBonus.toString()).toBe('0');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('replays one idempotency key to one transaction, not two', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma);
      const code = await createDynamicInvoiceQr(prisma, {
        partnerId: partner.id,
        amount: '5000',
      });

      await Promise.allSettled([
        qr.redeem({ token: code.token, idempotencyKey: 'same-key' }, user.id),
        qr.redeem({ token: code.token, idempotencyKey: 'same-key' }, user.id),
      ]);

      const rows = await prisma.transaction.count({
        where: { userId: user.id, idempotencyKey: 'same-key' },
      });
      expect(rows).toBe(1);
    });
  });

  describe('the bonus reservation lifecycle', () => {
    it('settles a reservation exactly once when two settles race', async () => {
      const { wallet } = await createCustomer(prisma);
      await engine.accrue({
        walletId: wallet.id,
        type: BonusEntryType.ACCRUAL_PURCHASE,
        amount: '1000',
        pendingHours: 0,
      });
      const reservation = await engine.reserve(wallet.id, '400', 'tx-settle-race');

      const results = await Promise.allSettled([
        engine.settleReservation(reservation.reservationId),
        engine.settleReservation(reservation.reservationId),
      ]);

      expect(fulfilled(results)).toBe(1);
      // A second DEBIT here takes 400 more points the customer never spent,
      // and drives `reserved` negative.
      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(after.reservedBonus.toString()).toBe('0');
      expect(after.availableBonus.toString()).toBe('600');
      expect(after.lifetimeSpent.toString()).toBe('400');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('releases a reservation exactly once when two releases race', async () => {
      const { wallet } = await createCustomer(prisma);
      await engine.accrue({
        walletId: wallet.id,
        type: BonusEntryType.ACCRUAL_PURCHASE,
        amount: '1000',
        pendingHours: 0,
      });
      const reservation = await engine.reserve(wallet.id, '400', 'tx-release-race');

      const results = await Promise.allSettled([
        engine.releaseReservation(reservation.reservationId, 'a'),
        engine.releaseReservation(reservation.reservationId, 'b'),
      ]);

      expect(fulfilled(results)).toBe(1);
      // A double release credits 400 points out of nothing.
      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(after.availableBonus.toString()).toBe('1000');
      expect(after.reservedBonus.toString()).toBe('0');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('reverses a settlement exactly once when two reversals race', async () => {
      const { wallet } = await createCustomer(prisma);
      await engine.accrue({
        walletId: wallet.id,
        type: BonusEntryType.ACCRUAL_PURCHASE,
        amount: '1000',
        pendingHours: 0,
      });
      const reservation = await engine.reserve(wallet.id, '400', 'tx-reverse-race');
      await engine.settleReservation(reservation.reservationId);

      await Promise.allSettled([
        engine.reverseSettlement(reservation.reservationId, 'a'),
        engine.reverseSettlement(reservation.reservationId, 'b'),
      ]);

      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(after.availableBonus.toString()).toBe('1000');
      expect(after.lifetimeSpent.toString()).toBe('0');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    /**
     * GitHub issue #28 / launch-blocker closure (2026-08-16): every test
     * above races two calls to the *same* method — settle vs settle,
     * release vs release — and both were already caught, but only
     * incidentally, by the `wallets_balances_non_negative` /
     * `bonus_lots_amounts_sane` CHECK constraints: a single reservation's
     * `reservedBonus` decrement, applied twice, always goes negative and
     * Postgres refuses it regardless of whether the application code has
     * its own guard. `settleReservation` and `releaseReservation`
     * themselves used a plain, unconditional `bonusReservation.update`
     * with no status predicate — a genuine check-then-write race — and it
     * stayed invisible because nothing tested the *mixed* case with a
     * second reservation in the wallet to absorb the double-decrement
     * without tripping the CHECK constraint, which is exactly the
     * reachable production shape: `PurchaseIntentsService.confirm()` calls
     * `settleReservation` inside its own transaction while the
     * independent `bonus.release-expired-reservations` sweep can call
     * `releaseReservation` on the very same still-`ACTIVE` reservation if
     * its snapshot predates the confirm's commit (a reservation's
     * `expiresAt` is set before its owning intent's own, so it can become
     * sweep-eligible while the intent is still confirmable) — and a real
     * customer can easily hold two open reservations at once. This test
     * fails against the pre-fix code: both branches commit on top of each
     * other, and `r1` is left `RELEASED` even though its points were
     * already spent by the winning `settleReservation` call.
     */
    it('settles exactly once when a settle and a release race the same reservation, with a second reservation open', async () => {
      const { wallet } = await createCustomer(prisma);
      await engine.accrue({
        walletId: wallet.id,
        type: BonusEntryType.ACCRUAL_PURCHASE,
        amount: '1000',
        pendingHours: 0,
      });
      const r1 = await engine.reserve(wallet.id, '400', 'tx-mixed-race-1');
      // A second, untouched hold — its 400 is what would silently absorb
      // r1's double-decrement without the CHECK constraint ever firing.
      await engine.reserve(wallet.id, '400', 'tx-mixed-race-2');

      const results = await Promise.allSettled([
        engine.settleReservation(r1.reservationId),
        engine.releaseReservation(r1.reservationId, 'purchase_intent_expired'),
      ]);

      expect(fulfilled(results)).toBe(1);
      const r1Row = await prisma.bonusReservation.findUniqueOrThrow({ where: { id: r1.reservationId } });
      const settled = r1Row.status === BonusReservationStatus.SETTLED;
      expect(r1Row.status).toBe(
        settled ? BonusReservationStatus.SETTLED : BonusReservationStatus.RELEASED,
      );

      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      // r2's 400 is still held throughout, whichever branch of r1 won.
      expect(after.reservedBonus.toString()).toBe('400');
      // Pre-reservation balance was 1000; 800 was held across r1+r2. If r1
      // settled, its 400 was actually spent, leaving 200 available. If r1
      // was released instead, its 400 came back, leaving 600 available.
      expect(after.availableBonus.toString()).toBe(settled ? '200' : '600');
      expect(after.lifetimeSpent.toString()).toBe(settled ? '400' : '0');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('does not let two reservations claim the same points', async () => {
      const { wallet } = await createCustomer(prisma);
      await engine.accrue({
        walletId: wallet.id,
        type: BonusEntryType.ACCRUAL_PURCHASE,
        amount: '1000',
        pendingHours: 0,
      });

      // Each asks for 600 of a 1000 balance. Both succeeding means 1200
      // points reserved against 1000 held.
      const results = await Promise.allSettled([
        engine.reserve(wallet.id, '600', 'tx-overdraw-a'),
        engine.reserve(wallet.id, '600', 'tx-overdraw-b'),
      ]);

      expect(fulfilled(results)).toBe(1);
      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(after.availableBonus.greaterThanOrEqualTo(0)).toBe(true);
      expect(after.reservedBonus.toString()).toBe('600');
      await assertWalletIntegrity(prisma, wallet.id);
    });
  });

  describe('the maintenance sweeps', () => {
    it('promotes a pending lot exactly once when two sweeps race', async () => {
      const { wallet } = await createCustomer(prisma);
      await engine.accrue({
        walletId: wallet.id,
        type: BonusEntryType.ACCRUAL_PURCHASE,
        amount: '750',
        pendingHours: 1,
      });
      const later = new Date(Date.now() + 2 * 3_600_000);

      // The advisory lock normally keeps these apart, but a lock is a Redis
      // key with a TTL — a slow sweep outliving its lease produces exactly
      // this, and the ledger must survive it.
      await Promise.allSettled([
        engine.promotePendingLots(later),
        engine.promotePendingLots(later),
      ]);

      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(after.availableBonus.toString()).toBe('750');
      expect(after.pendingBonus.toString()).toBe('0');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('expires a lot exactly once when two sweeps race', async () => {
      const { wallet } = await createCustomer(prisma);
      await engine.accrue({
        walletId: wallet.id,
        type: BonusEntryType.ACCRUAL_PURCHASE,
        amount: '750',
        pendingHours: 0,
      });
      const later = new Date(Date.now() + 400 * 86_400_000);

      await Promise.allSettled([engine.expireLots(later), engine.expireLots(later)]);

      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(after.availableBonus.toString()).toBe('0');
      // Expiring twice would drive the balance to -750.
      expect(after.availableBonus.greaterThanOrEqualTo(0)).toBe(true);
      await assertWalletIntegrity(prisma, wallet.id);
    });
  });
});
