import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { EvSessionStatus, PrismaClient } from '@prisma/client';
import { EvReservationsService } from '../src/modules/ev-charging/ev-reservations.service';
import { EvSessionsService } from '../src/modules/ev-charging/ev-sessions.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { TransactionsService } from '../src/modules/transactions/transactions.service';
import { createCustomer, createEvConnector, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Reaching another person's things by knowing their id.
 *
 * Partner-to-partner isolation and the financial endpoints each have a suite
 * already. What those do not cover is the plainest version of the same
 * question, customer to customer: given a uuid belonging to somebody else,
 * does the endpoint check *whose* it is, or only that the caller is signed
 * in? Every route on the platform that takes an id was enumerated, and the
 * ones not already covered elsewhere are attacked here.
 *
 * Read-only routes are as important as mutating ones. A customer who can
 * fetch a stranger's payment learns what they bought, where, and for how
 * much — which is worse for that stranger than most things they could
 * change.
 */
describe('IDOR sweep (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let sessions: EvSessionsService;
  let reservations: EvReservationsService;
  let notifications: NotificationsService;
  let transactions: TransactionsService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    sessions = harness.app.get(EvSessionsService);
    reservations = harness.app.get(EvReservationsService);
    notifications = harness.app.get(NotificationsService);
    transactions = harness.app.get(TransactionsService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  /** A victim and an attacker, both ordinary signed-in customers. */
  const twoCustomers = async () => {
    const victim = await createCustomer(prisma, { phone: '+37477900001' });
    const attacker = await createCustomer(prisma, { phone: '+37477900002' });
    return { victim, attacker };
  };

  describe('notifications', () => {
    it("does not let one customer mark another's notification read", async () => {
      const { victim, attacker } = await twoCustomers();
      const notice = await prisma.notification.create({
        data: { userId: victim.user.id, channel: 'PUSH', titleKey: 't', bodyKey: 'b' },
      });

      await notifications.markRead(notice.id, attacker.user.id);

      // Marking it read hides it from the person it was for — a small thing
      // to lose, and a trivially guessable id to lose it to.
      const after = await prisma.notification.findUniqueOrThrow({ where: { id: notice.id } });
      expect(after.isRead).toBe(false);
    });

    it("does not list another customer's notifications", async () => {
      const { victim, attacker } = await twoCustomers();
      await prisma.notification.create({
        data: { userId: victim.user.id, channel: 'PUSH', titleKey: 'private', bodyKey: 'b' },
      });

      const mine = await notifications.listMine(attacker.user.id, { limit: 20 });

      expect(mine.items).toHaveLength(0);
    });
  });

  describe('charging sessions', () => {
    const chargingSession = async (userId: string) => {
      const partner = await createPartner(prisma);
      const connector = await createEvConnector(prisma, { partnerId: partner.id });
      const session = await sessions.start({ connectorId: connector.id }, userId);
      await prisma.evSession.update({
        where: { id: session.id },
        data: { startedAt: new Date(Date.now() - 2 * 3_600_000) },
      });
      return { session, connector, partner };
    };

    it("does not let one customer report a meter value on another's session", async () => {
      const { victim, attacker } = await twoCustomers();
      const { session } = await chargingSession(victim.user.id);

      // The reading becomes the bill. Writing to a stranger's session is
      // writing their invoice.
      await expect(
        sessions.reportMeterValue(session.id, '40', attacker.user.id),
      ).rejects.toThrow(NotFoundException);

      const after = await prisma.evSession.findUniqueOrThrow({ where: { id: session.id } });
      expect(after.energyKwh!.toString()).toBe('0');
    });

    it("does not let one customer stop another's session", async () => {
      const { victim, attacker } = await twoCustomers();
      const { session } = await chargingSession(victim.user.id);

      await expect(sessions.stop(session.id, attacker.user.id, {})).rejects.toThrow(
        NotFoundException,
      );

      const after = await prisma.evSession.findUniqueOrThrow({ where: { id: session.id } });
      expect(after.status).toBe(EvSessionStatus.CHARGING);
      expect(await prisma.transaction.count()).toBe(0);
    });

    it("does not show one customer another's charging history", async () => {
      const { victim, attacker } = await twoCustomers();
      await chargingSession(victim.user.id);

      const mine = await sessions.historyForUser(attacker.user.id);

      expect(mine).toHaveLength(0);
    });

    it("refuses a charge-point operator writing to another partner's session", async () => {
      const { victim } = await twoCustomers();
      const { session } = await chargingSession(victim.user.id);
      const other = await createPartner(prisma, { displayName: 'Rival' });

      // An operator may report readings for their own network — that is what
      // a charge point does — but the station has to be theirs. The reading
      // is the bill, so this is a write to a rival's revenue.
      await expect(
        sessions.reportMeterValue(session.id, '40', null, { partnerId: other.id }),
      ).rejects.toThrow(ForbiddenException);

      const after = await prisma.evSession.findUniqueOrThrow({ where: { id: session.id } });
      expect(after.energyKwh!.toString()).toBe('0');
    });
  });

  describe('reservations', () => {
    it("does not let one customer cancel another's reservation", async () => {
      const { victim, attacker } = await twoCustomers();
      const partner = await createPartner(prisma);
      const connector = await createEvConnector(prisma, { partnerId: partner.id });
      const reservation = await reservations.create(
        { connectorId: connector.id, startAt: new Date().toISOString(), holdMinutes: 15 },
        victim.user.id,
      );

      // Cancelling a stranger's hold releases the bay they are driving to.
      await expect(reservations.cancel(reservation.id, attacker.user.id)).rejects.toThrow(
        NotFoundException,
      );

      const after = await prisma.evReservation.findUniqueOrThrow({ where: { id: reservation.id } });
      expect(after.status).toBe('CONFIRMED');
    });

    it("does not list another customer's reservations", async () => {
      const { victim, attacker } = await twoCustomers();
      const partner = await createPartner(prisma);
      const connector = await createEvConnector(prisma, { partnerId: partner.id });
      await reservations.create(
        { connectorId: connector.id, startAt: new Date().toISOString(), holdMinutes: 15 },
        victim.user.id,
      );

      expect(await reservations.listMine(attacker.user.id)).toHaveLength(0);
    });
  });

  describe('transaction history', () => {
    it("does not show one customer another's transactions", async () => {
      const { victim, attacker } = await twoCustomers();
      const partner = await createPartner(prisma);
      await transactions.create({
        userId: victim.user.id,
        partnerId: partner.id,
        type: 'QR_PAYMENT',
        amount: '9999',
      });

      // The controller passes the authenticated user's id, never one from
      // the query — so the scoping this asserts is the scoping that runs.
      const mine = await transactions.history({ userId: attacker.user.id, limit: 20 });

      expect(mine.items).toHaveLength(0);
    });
  });
});
