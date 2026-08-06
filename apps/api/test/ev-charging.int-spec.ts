import { BadRequestException } from '@nestjs/common';
import {
  BonusEntryType,
  EvConnectorStatus,
  EvSessionStatus,
  PrismaClient,
  TransactionStatus,
} from '@prisma/client';
import { EvSessionsService } from '../src/modules/ev-charging/ev-sessions.service';
import { BonusEngineService } from '../src/modules/wallet/bonus-engine.service';
import { createCustomer, createEvConnector, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';
import { assertWalletIntegrity } from './setup/invariants';

/**
 * The EV charging saga: start, meter, stop, bill, accrue — and the failure
 * paths, where a charging session that goes wrong must not leave the
 * connector unusable or the customer's points spent.
 */
describe('EV charging (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let sessions: EvSessionsService;
  let engine: BonusEngineService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    sessions = harness.app.get(EvSessionsService);
    engine = harness.app.get(BonusEngineService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  /** A customer, a 100 AMD/kWh connector, and an optional starting balance. */
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

  // ── Happy path ──────────────────────────────────────────────────────────

  it('bills energy at the connector price and accrues on it', async () => {
    const { user, wallet, connector } = await scenario({ rateBps: 500 });

    const session = await sessions.start({ connectorId: connector.id }, user.id);
    await sessions.reportMeterValue(session.id, '25');
    const result = await sessions.stop(session.id, user.id, {});

    // 25 kWh × 100 AMD = 2500; 5% of 2500 = 125.
    expect(result.cost).toBe('2500');
    expect(result.bonusEarned).toBe('125');

    const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(after.pendingBonus.toFixed(4)).toBe('125.0000');
    await assertWalletIntegrity(prisma, wallet.id);
  });

  it('frees the connector and writes a CDR when the session completes', async () => {
    const { user, connector } = await scenario();

    const session = await sessions.start({ connectorId: connector.id }, user.id);
    expect(
      (await prisma.evConnector.findUniqueOrThrow({ where: { id: connector.id } })).status,
    ).toBe(EvConnectorStatus.CHARGING);

    await sessions.reportMeterValue(session.id, '10');
    await sessions.stop(session.id, user.id, {});

    const finished = await prisma.evSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(finished.status).toBe(EvSessionStatus.COMPLETED);
    expect(
      (await prisma.evConnector.findUniqueOrThrow({ where: { id: connector.id } })).status,
    ).toBe(EvConnectorStatus.AVAILABLE);

    const cdr = await prisma.evCdr.findUniqueOrThrow({ where: { sessionId: session.id } });
    expect(cdr.totalEnergy.toFixed(4)).toBe('10.0000');
    expect(cdr.totalCost.toFixed(4)).toBe('1000.0000');
  });

  it('applies bonus points and accrues only on the cash portion', async () => {
    const { user, wallet, connector } = await scenario({
      availableBonus: '1000',
      rateBps: 1000,
    });

    const session = await sessions.start({ connectorId: connector.id }, user.id);
    await sessions.reportMeterValue(session.id, '25');
    const result = await sessions.stop(session.id, user.id, { bonusAmountToApply: '1000' });

    // 2500 cost − 1000 in points = 1500 cash → 10% = 150.
    expect(result.bonusApplied).toBe('1000');
    expect(result.bonusEarned).toBe('150');

    const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(after.availableBonus.toFixed(4)).toBe('0.0000');
    expect(after.lifetimeSpent.toFixed(4)).toBe('1000.0000');

    const redemptions = await prisma.bonusLedgerEntry.findMany({
      where: { walletId: wallet.id, type: BonusEntryType.REDEMPTION_EV_CHARGING },
    });
    // Attributed to charging, not lumped in with QR payments.
    expect(redemptions).toHaveLength(1);
    await assertWalletIntegrity(prisma, wallet.id);
  });

  // ── Metering ────────────────────────────────────────────────────────────

  describe('meter values', () => {
    it('refuses a reading lower than the last one', async () => {
      const { user, connector } = await scenario();
      const session = await sessions.start({ connectorId: connector.id }, user.id);
      await sessions.reportMeterValue(session.id, '50');

      // A meter only counts up. Accepting a lower value would let a caller
      // rewrite the bill downwards after the energy was delivered.
      await expect(sessions.reportMeterValue(session.id, '10')).rejects.toThrow(
        /cannot decrease/,
      );

      expect(
        (await prisma.evSession.findUniqueOrThrow({ where: { id: session.id } })).energyKwh?.toFixed(
          4,
        ),
      ).toBe('50.0000');
    });

    it.each(['-10', 'NaN', 'Infinity'])('refuses the malformed reading %p', async (value) => {
      const { user, connector } = await scenario();
      const session = await sessions.start({ connectorId: connector.id }, user.id);

      await expect(sessions.reportMeterValue(session.id, value)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuses a reading for a session that is not charging', async () => {
      const { user, connector } = await scenario();
      const session = await sessions.start({ connectorId: connector.id }, user.id);
      await sessions.reportMeterValue(session.id, '5');
      await sessions.stop(session.id, user.id, {});

      await expect(sessions.reportMeterValue(session.id, '9999')).rejects.toThrow(
        /not currently charging/,
      );
    });
  });

  // ── Refusals ────────────────────────────────────────────────────────────

  describe('refusals', () => {
    it('refuses to start on a connector that is already charging', async () => {
      const { user, connector } = await scenario();
      await sessions.start({ connectorId: connector.id }, user.id);

      const { user: other } = await createCustomer(prisma);
      await expect(sessions.start({ connectorId: connector.id }, other.id)).rejects.toThrow(
        /not available/,
      );
    });

    it('refuses to stop someone else’s session', async () => {
      const { user, connector } = await scenario();
      const session = await sessions.start({ connectorId: connector.id }, user.id);
      const { user: attacker } = await createCustomer(prisma);

      // Direct object reference: the session id alone must not be authority.
      await expect(sessions.stop(session.id, attacker.id, {})).rejects.toThrow(/not found/);
      expect(
        (await prisma.evSession.findUniqueOrThrow({ where: { id: session.id } })).status,
      ).toBe(EvSessionStatus.CHARGING);
    });

    it('refuses to stop the same session twice', async () => {
      const { user, connector } = await scenario();
      const session = await sessions.start({ connectorId: connector.id }, user.id);
      await sessions.reportMeterValue(session.id, '5');
      await sessions.stop(session.id, user.id, {});

      await expect(sessions.stop(session.id, user.id, {})).rejects.toThrow(/cannot be stopped/);
      expect(await prisma.evCdr.count({ where: { sessionId: session.id } })).toBe(1);
    });

    it('rejects a negative bonus rather than inflating the accrual base', async () => {
      const { user, wallet, connector } = await scenario({ rateBps: 1000 });
      const session = await sessions.start({ connectorId: connector.id }, user.id);
      await sessions.reportMeterValue(session.id, '25');

      await expect(
        sessions.stop(session.id, user.id, { bonusAmountToApply: '-1000000' }),
      ).rejects.toThrow(BadRequestException);

      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(after.pendingBonus.toFixed(4)).toBe('0.0000');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('rejects a bonus larger than the session cost', async () => {
      const { user, wallet, connector } = await scenario({ availableBonus: '100000' });
      const session = await sessions.start({ connectorId: connector.id }, user.id);
      await sessions.reportMeterValue(session.id, '1'); // 100 AMD

      await expect(
        sessions.stop(session.id, user.id, { bonusAmountToApply: '5000' }),
      ).rejects.toThrow(/cannot exceed the session cost/);
      await assertWalletIntegrity(prisma, wallet.id);
    });
  });

  // ── Rollback ────────────────────────────────────────────────────────────

  describe('rollback', () => {
    it('frees the connector and refunds the points when stopping fails', async () => {
      const { user, wallet, connector } = await scenario({ availableBonus: '1000' });
      const session = await sessions.start({ connectorId: connector.id }, user.id);
      await sessions.reportMeterValue(session.id, '25');

      // Fail while writing the completion/CDR — after the points were settled.
      const spy = jest
        .spyOn(prisma, '$transaction')
        .mockImplementationOnce((() =>
          Promise.reject(new Error('cdr write failed'))) as never);

      await expect(
        sessions.stop(session.id, user.id, { bonusAmountToApply: '1000' }),
      ).rejects.toThrow('cdr write failed');
      spy.mockRestore();

      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      // The customer must not pay for a charge that was never recorded.
      expect(after.availableBonus.toFixed(4)).toBe('1000.0000');
      expect(after.lifetimeSpent.toFixed(4)).toBe('0.0000');

      // The connector used to stay CHARGING forever, making the bay
      // permanently unusable and silently costing the partner revenue.
      expect(
        (await prisma.evConnector.findUniqueOrThrow({ where: { id: connector.id } })).status,
      ).toBe(EvConnectorStatus.AVAILABLE);
      expect(
        (await prisma.evSession.findUniqueOrThrow({ where: { id: session.id } })).status,
      ).toBe(EvSessionStatus.INVALID);

      const transaction = await prisma.transaction.findFirstOrThrow({
        where: { userId: user.id, type: 'EV_CHARGING' },
      });
      expect(transaction.status).toBe(TransactionStatus.FAILED);
      await assertWalletIntegrity(prisma, wallet.id);
    });
  });
});
