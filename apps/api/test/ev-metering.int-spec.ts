import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { EvSessionsService } from '../src/modules/ev-charging/ev-sessions.service';
import { createCustomer, createEvConnector, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';
import { assertWalletIntegrity } from './setup/invariants';

/**
 * Regression suite for docs/AUDIT_2026-08-B.md §C1.
 *
 * The billed quantity in an EV session is the energy delivered, and before
 * this suite existed the client supplied it: `POST /ev/sessions/:id/meter-value`
 * had no ownership check and no plausibility check. Three ordinary API calls
 * minted roughly fifty million bonus points, repeatably.
 *
 * These tests perform the original attack and assert it now fails.
 */
describe('EV metering authorization (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let sessions: EvSessionsService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    sessions = harness.app.get(EvSessionsService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  /** A 50 kW connector at 100 AMD/kWh, partner accruing 5%. */
  const scenario = async () => {
    const { user, wallet } = await createCustomer(prisma);
    const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
    const connector = await createEvConnector(prisma, {
      partnerId: partner.id,
      pricePerKwh: '100.00',
    });
    return { user, wallet, connector };
  };

  /** Backdates the session so a given number of hours appears to have elapsed. */
  const backdate = (sessionId: string, hours: number) =>
    prisma.evSession.update({
      where: { id: sessionId },
      data: { startedAt: new Date(Date.now() - hours * 3_600_000) },
    });

  describe('the §C1 exploit', () => {
    it('refuses a meter reading no connector could physically have delivered', async () => {
      const { user, wallet, connector } = await scenario();
      const session = await sessions.start({ connectorId: connector.id }, user.id);

      // The original attack, verbatim: declare 9,999,999 kWh and collect 5% of
      // 999,999,900 AMD. A 50 kW connector needs 200,000 hours to deliver that.
      await expect(
        sessions.reportMeterValue(session.id, '9999999', user.id),
      ).rejects.toThrow(/exceeds what the connector could have delivered/);

      await expect(sessions.stop(session.id, user.id, {})).resolves.toMatchObject({
        energyKwh: '0',
      });

      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(after.pendingBonus.toFixed(4)).toBe('0.0000');
      expect(after.availableBonus.toFixed(4)).toBe('0.0000');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('caps the bonus a session can mint at the connector rating', async () => {
      const { user, wallet, connector } = await scenario();
      const session = await sessions.start({ connectorId: connector.id }, user.id);
      await backdate(session.id, 1); // one hour on a 50 kW connector

      await expect(sessions.reportMeterValue(session.id, '10000', user.id)).rejects.toThrow(
        BadRequestException,
      );

      // 50 kW for 1h, plus the tolerance the guard allows, is the ceiling.
      const accepted = await sessions.reportMeterValue(session.id, '52', user.id);
      expect(accepted.energyKwh?.toFixed(3)).toBe('52.000');

      const result = await sessions.stop(session.id, user.id, {});
      // 52 kWh x 100 AMD = 5200; 5% = 260 pool. Bounded, not fifty
      // million. A roaming-CPO session settles like every other purchase (2026-08-22
      // 3-level referral rework): the customer's immediate green share is
      // 20% of the whole pool, directly — 260 * 0.2 = 52.
      expect(result.bonusEarned).toBe('52');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('rejects a reading from a session the caller does not own', async () => {
      const { user, connector } = await scenario();
      const session = await sessions.start({ connectorId: connector.id }, user.id);
      const { user: attacker } = await createCustomer(prisma);

      // Without an ownership check any customer could inflate any other
      // customer's bill to the ceiling.
      await expect(
        sessions.reportMeterValue(session.id, '40', attacker.id),
      ).rejects.toThrow(NotFoundException);

      const untouched = await prisma.evSession.findUniqueOrThrow({ where: { id: session.id } });
      expect(untouched.energyKwh?.toFixed(3)).toBe('0.000');
    });
  });

  describe('the bound is enforced again at settlement', () => {
    it('refuses to bill energy that was written around the metering guard', async () => {
      const { user, wallet, connector } = await scenario();
      const session = await sessions.start({ connectorId: connector.id }, user.id);
      await backdate(session.id, 1);

      // Simulates any path that reaches the row without going through
      // reportMeterValue — a future adapter, an operator script, a bug.
      await prisma.evSession.update({
        where: { id: session.id },
        data: { energyKwh: '9999999' },
      });

      await expect(sessions.stop(session.id, user.id, {})).rejects.toThrow(
        /exceeds what the connector could have delivered/,
      );

      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(after.pendingBonus.toFixed(4)).toBe('0.0000');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('frees the connector when settlement rejects the reading', async () => {
      const { user, connector } = await scenario();
      const session = await sessions.start({ connectorId: connector.id }, user.id);
      await backdate(session.id, 1);
      await prisma.evSession.update({
        where: { id: session.id },
        data: { energyKwh: '9999999' },
      });

      await expect(sessions.stop(session.id, user.id, {})).rejects.toThrow(BadRequestException);

      // A rejected settlement must not strand the bay.
      const after = await prisma.evConnector.findUniqueOrThrow({ where: { id: connector.id } });
      expect(after.status).toBe('AVAILABLE');
    });
  });

  describe('legitimate metering still works', () => {
    it('accepts a plausible increasing sequence', async () => {
      const { user, wallet, connector } = await scenario();
      const session = await sessions.start({ connectorId: connector.id }, user.id);
      await backdate(session.id, 1);

      for (const reading of ['5', '12.5', '30.125']) {
        await sessions.reportMeterValue(session.id, reading, user.id);
      }

      const result = await sessions.stop(session.id, user.id, {});
      expect(result.energyKwh).toBe('30.125');
      expect(new Decimal(result.cost!).toFixed(4)).toBe('3012.5000');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('still refuses a decreasing reading', async () => {
      const { user, connector } = await scenario();
      const session = await sessions.start({ connectorId: connector.id }, user.id);
      await backdate(session.id, 1);
      await sessions.reportMeterValue(session.id, '20', user.id);

      await expect(sessions.reportMeterValue(session.id, '10', user.id)).rejects.toThrow(
        /cannot decrease/,
      );
    });

    it('refuses more precision than the meter column stores', async () => {
      const { user, connector } = await scenario();
      const session = await sessions.start({ connectorId: connector.id }, user.id);
      await backdate(session.id, 1);

      // energyKwh is Decimal(10,3); a 4th decimal would be silently rounded.
      await expect(sessions.reportMeterValue(session.id, '1.0001', user.id)).rejects.toThrow(
        /at most 3 decimal places/,
      );
    });
  });

  describe('operators may still report on behalf of a charge point', () => {
    it('accepts a reading from a caller holding EV_STATION_MANAGE for the station owner', async () => {
      const { user, connector } = await scenario();
      const session = await sessions.start({ connectorId: connector.id }, user.id);
      await backdate(session.id, 1);

      const station = await prisma.evStation.findFirstOrThrow();
      const updated = await sessions.reportMeterValue(session.id, '25', null, {
        partnerId: station.partnerId,
      });
      expect(updated.energyKwh?.toFixed(3)).toBe('25.000');
    });

    it('rejects an operator scoped to a different partner', async () => {
      const { user, connector } = await scenario();
      const session = await sessions.start({ connectorId: connector.id }, user.id);
      const other = await createPartner(prisma);

      await expect(
        sessions.reportMeterValue(session.id, '25', null, { partnerId: other.id }),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
