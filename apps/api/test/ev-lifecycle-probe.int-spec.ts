import {
  EvConnectorStatus,
  EvReservationStatus,
  EvSessionStatus,
  PrismaClient,
  TransactionStatus,
} from '@prisma/client';
import { EvSessionsService } from '../src/modules/ev-charging/ev-sessions.service';
import { EvReservationsService } from '../src/modules/ev-charging/ev-reservations.service';
import { createCustomer, createEvConnector, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * The charging lifecycle when events do not arrive in the order the happy
 * path assumes.
 *
 * A charger is a physical device on a flaky network reporting to a mobile
 * client on a worse one. Readings arrive late, twice, or after the session
 * they belong to has closed; a session is abandoned rather than stopped; a
 * bay is left occupied by a process that died. What each of those does to the
 * bill is the question here.
 *
 * **Scope, stated honestly.** TuTak bills from its own meter readings. The
 * OCPI adapter is outbound only — start and stop commands to a roaming CPO —
 * and `fetchCdr` is declared on the interface but called from nowhere, so
 * there is no inbound CDR to arrive late, twice or out of order. The CDR row
 * this suite exercises is the one the platform writes for itself at stop.
 * Reconciling against a CPO's settled CDR is unbuilt, and is recorded as a
 * blocker in docs/AUDIT_FINANCIAL_2026-08.md rather than tested here.
 */
describe('EV lifecycle probe (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let sessions: EvSessionsService;
  let reservations: EvReservationsService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    sessions = harness.app.get(EvSessionsService);
    reservations = harness.app.get(EvReservationsService);
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

  const scenario = async () => {
    const { user, wallet } = await createCustomer(prisma);
    const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
    const connector = await createEvConnector(prisma, {
      partnerId: partner.id,
      pricePerKwh: '100.00',
    });
    return { user, wallet, partner, connector };
  };

  describe('readings that arrive out of order', () => {
    it('refuses a reading that arrives after the session is billed', async () => {
      const { user, connector } = await scenario();
      const session = await sessions.start({ connectorId: connector.id }, user.id);
      await backdate(session.id);
      await sessions.reportMeterValue(session.id, '10', user.id);
      const billed = await sessions.stop(session.id, user.id, {});
      expect(billed.cost).toBe('1000');

      // A late reading must not reopen a settled bill. The customer has been
      // charged 1000 and the partner will be paid on it.
      await expect(sessions.reportMeterValue(session.id, '40', user.id)).rejects.toThrow(
        /not currently charging/,
      );

      const after = await prisma.evSession.findUniqueOrThrow({ where: { id: session.id } });
      expect(after.energyKwh!.toString()).toBe('10');
      expect(after.cost!.toString()).toBe('1000');
    });

    it('refuses a reading lower than one already recorded', async () => {
      const { user, connector } = await scenario();
      const session = await sessions.start({ connectorId: connector.id }, user.id);
      await backdate(session.id);
      await sessions.reportMeterValue(session.id, '20', user.id);

      // A meter is monotonic. A lower reading is either a duplicate of an
      // earlier one arriving late, or an attempt to reduce the bill.
      await expect(sessions.reportMeterValue(session.id, '5', user.id)).rejects.toThrow(
        /cannot decrease/,
      );
    });

    it('treats a repeated identical reading as a no-op, not an error', async () => {
      // A retry of a reading that already landed is the most common duplicate
      // there is, and it must not fail the charger's reporting loop.
      const { user, connector } = await scenario();
      const session = await sessions.start({ connectorId: connector.id }, user.id);
      await backdate(session.id);
      await sessions.reportMeterValue(session.id, '15', user.id);
      await sessions.reportMeterValue(session.id, '15', user.id);

      const after = await prisma.evSession.findUniqueOrThrow({ where: { id: session.id } });
      expect(after.energyKwh!.toString()).toBe('15');
    });
  });

  describe('a session that is never stopped', () => {
    it('bills nothing and frees the bay when the sweep closes it', async () => {
      const { user, connector } = await scenario();
      const session = await sessions.start({ connectorId: connector.id }, user.id);
      // Backdated first: a reading is bounded by what the connector could
      // have delivered in the elapsed time, so a session that just started
      // cannot legitimately report 5 kWh.
      await backdate(session.id, 2);
      await sessions.reportMeterValue(session.id, '5', user.id);
      // Now age it past the 24-hour abandonment window.
      await backdate(session.id, 30);

      const closed = await sessions.expireStaleSessions();

      expect(closed).toBe(1);
      const after = await prisma.evSession.findUniqueOrThrow({ where: { id: session.id } });
      expect(after.status).toBe(EvSessionStatus.INVALID);
      // An abandoned session is not a bill. Nobody watched the meter and
      // nobody can say what was delivered, so charging for it would be
      // guesswork against a customer who is not there to dispute it.
      expect(await prisma.transaction.count({ where: { userId: user.id } })).toBe(0);
      const bay = await prisma.evConnector.findUniqueOrThrow({ where: { id: connector.id } });
      expect(bay.status).toBe(EvConnectorStatus.AVAILABLE);
    });

    it('lets the next customer use a bay the sweep reclaimed', async () => {
      const { user, connector } = await scenario();
      const first = await sessions.start({ connectorId: connector.id }, user.id);
      await backdate(first.id, 30);
      await sessions.expireStaleSessions();

      const next = await createCustomer(prisma, { phone: '+37477820001' });
      const second = await sessions.start({ connectorId: connector.id }, next.user.id);

      expect(second.status).toBe(EvSessionStatus.CHARGING);
    });

    it('cannot be stopped once the sweep has closed it', async () => {
      const { user, connector } = await scenario();
      const session = await sessions.start({ connectorId: connector.id }, user.id);
      await backdate(session.id, 2);
      await sessions.reportMeterValue(session.id, '5', user.id);
      await backdate(session.id, 30);
      await sessions.expireStaleSessions();

      // The bay may already belong to somebody else by now, so a late stop
      // must not bill and must not touch it.
      await expect(sessions.stop(session.id, user.id, {})).rejects.toThrow(/cannot be stopped/);
      expect(await prisma.transaction.count({ where: { userId: user.id } })).toBe(0);
    });
  });

  describe('the charge detail record', () => {
    it('writes exactly one CDR per session', async () => {
      const { user, connector } = await scenario();
      const session = await sessions.start({ connectorId: connector.id }, user.id);
      await backdate(session.id);
      await sessions.reportMeterValue(session.id, '12', user.id);
      await sessions.stop(session.id, user.id, {});

      const cdrs = await prisma.evCdr.findMany({ where: { sessionId: session.id } });
      expect(cdrs).toHaveLength(1);
      expect(cdrs[0]!.totalEnergy.toString()).toBe('12');
      expect(cdrs[0]!.totalCost.toString()).toBe('1200');
    });

    it('agrees with the transaction it billed', async () => {
      // The CDR is what a partner is shown and what a dispute is settled
      // against. It disagreeing with the charge is a dispute nobody can win.
      const { user, connector } = await scenario();
      const session = await sessions.start({ connectorId: connector.id }, user.id);
      await backdate(session.id);
      await sessions.reportMeterValue(session.id, '18.5', user.id);
      const result = await sessions.stop(session.id, user.id, {});

      const cdr = await prisma.evCdr.findUniqueOrThrow({ where: { sessionId: session.id } });
      const charge = await prisma.transaction.findFirstOrThrow({
        where: { userId: user.id, type: 'EV_CHARGING' },
      });
      expect(cdr.totalCost.toString()).toBe(result.cost);
      expect(charge.amount.toString()).toBe(result.cost);
      expect(charge.status).toBe(TransactionStatus.COMPLETED);
    });

    it('bills zero rather than failing when no reading ever arrived', async () => {
      // A charger that reported nothing is not a licence to guess. The
      // session closes at zero, the customer pays nothing, the bay is freed.
      const { user, connector } = await scenario();
      const session = await sessions.start({ connectorId: connector.id }, user.id);
      await backdate(session.id);

      const result = await sessions.stop(session.id, user.id, {});

      expect(result.cost).toBe('0');
      expect(result.bonusEarned).toBe('0');
      const bay = await prisma.evConnector.findUniqueOrThrow({ where: { id: connector.id } });
      expect(bay.status).toBe(EvConnectorStatus.AVAILABLE);
    });
  });

  describe('reservations', () => {
    it('lets the holder start on a bay reserved for them', async () => {
      const { user, connector } = await scenario();
      const reservation = await reservations.create(
        { connectorId: connector.id, startAt: new Date().toISOString(), holdMinutes: 15 },
        user.id,
      );

      const session = await sessions.start(
        { connectorId: connector.id, reservationId: reservation.id },
        user.id,
      );

      expect(session.status).toBe(EvSessionStatus.CHARGING);
      const after = await prisma.evReservation.findUniqueOrThrow({ where: { id: reservation.id } });
      expect(after.status).toBe(EvReservationStatus.FULFILLED);
    });

    it('does not let somebody else take a reserved bay', async () => {
      const { user, connector } = await scenario();
      await reservations.create(
        { connectorId: connector.id, startAt: new Date().toISOString(), holdMinutes: 15 },
        user.id,
      );
      const stranger = await createCustomer(prisma, { phone: '+37477820002' });

      // The reservation is the product. A bay anyone can take out from under
      // the holder is not reserved.
      await expect(
        sessions.start({ connectorId: connector.id }, stranger.user.id),
      ).rejects.toThrow(/not available/);
    });

    it('consumes a reservation once, so it cannot start two sessions', async () => {
      const { user, connector } = await scenario();
      const reservation = await reservations.create(
        { connectorId: connector.id, startAt: new Date().toISOString(), holdMinutes: 15 },
        user.id,
      );
      const first = await sessions.start(
        { connectorId: connector.id, reservationId: reservation.id },
        user.id,
      );
      await backdate(first.id);
      await sessions.stop(first.id, user.id, {});

      await expect(
        sessions.start({ connectorId: connector.id, reservationId: reservation.id }, user.id),
      ).rejects.toThrow(/not confirmed/);
    });
  });
});
