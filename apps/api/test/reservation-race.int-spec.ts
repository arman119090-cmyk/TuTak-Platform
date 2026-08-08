import { EvConnectorStatus, EvReservationStatus, EvSessionStatus, PrismaClient } from '@prisma/client';
import { EvReservationsService } from '../src/modules/ev-charging/ev-reservations.service';
import { EvSessionsService } from '../src/modules/ev-charging/ev-sessions.service';
import { createCustomer, createEvConnector, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * The reservation hold lapsing at the moment it is used.
 *
 * A customer with a fifteen-minute hold plugs in at minute fourteen — which
 * is precisely when they hurry, and precisely when the expiry sweep is about
 * to run. Both then act on the same connector: one is starting a session on
 * it, the other is reclaiming it for the next customer.
 *
 * This is the same shape as the connector race fixed in
 * `docs/AUDIT_FINANCIAL_2026-08.md` §F-1, in a path that fix did not touch:
 * the two cleanup routes freed the bay with an unconditional write, so they
 * could hand away a connector that had just started charging. The fix in both
 * places is the same — free only what you still hold.
 */
describe('Reservation and connector races (integration)', () => {
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

  const scenario = async () => {
    const { user } = await createCustomer(prisma);
    const partner = await createPartner(prisma);
    const connector = await createEvConnector(prisma, { partnerId: partner.id });
    const reservation = await reservations.create(
      { connectorId: connector.id, startAt: new Date().toISOString(), holdMinutes: 15 },
      user.id,
    );
    return { user, connector, reservation };
  };

  it('does not free a bay the expiry sweep raced a start for', async () => {
    const { user, connector, reservation } = await scenario();

    // Both act on the same connector at the same instant: the sweep believes
    // the hold has lapsed, the customer is plugging in.
    await Promise.allSettled([
      sessions.start({ connectorId: connector.id, reservationId: reservation.id }, user.id),
      reservations.expireStaleReservations(new Date(Date.now() + 20 * 60_000)),
    ]);

    const session = await prisma.evSession.findFirst({ where: { connectorId: connector.id } });
    const bay = await prisma.evConnector.findUniqueOrThrow({ where: { id: connector.id } });

    // Whichever won, the two must agree. A connector marked AVAILABLE while a
    // session charges on it is the next customer being sold a cable that is
    // already in use.
    if (session && session.status === EvSessionStatus.CHARGING) {
      expect(bay.status).toBe(EvConnectorStatus.CHARGING);
    } else {
      expect(bay.status).toBe(EvConnectorStatus.AVAILABLE);
    }
  });

  it('does not free a bay a cancellation raced a start for', async () => {
    const { user, connector, reservation } = await scenario();

    // The customer taps "cancel" as the session is starting — a double tap
    // across two screens, or a cancel that was queued while offline.
    await Promise.allSettled([
      sessions.start({ connectorId: connector.id, reservationId: reservation.id }, user.id),
      reservations.cancel(reservation.id, user.id),
    ]);

    const session = await prisma.evSession.findFirst({ where: { connectorId: connector.id } });
    const bay = await prisma.evConnector.findUniqueOrThrow({ where: { id: connector.id } });

    if (session && session.status === EvSessionStatus.CHARGING) {
      expect(bay.status).toBe(EvConnectorStatus.CHARGING);
    } else {
      expect(bay.status).toBe(EvConnectorStatus.AVAILABLE);
    }
  });

  it('still frees a bay whose hold simply lapsed', async () => {
    // The regression guard: making the release conditional must not stop it
    // releasing. A hold nobody used has to come back, or the bay is lost.
    const { connector } = await scenario();

    const expired = await reservations.expireStaleReservations(new Date(Date.now() + 20 * 60_000));

    expect(expired).toBe(1);
    const bay = await prisma.evConnector.findUniqueOrThrow({ where: { id: connector.id } });
    expect(bay.status).toBe(EvConnectorStatus.AVAILABLE);
  });

  it('still frees a bay the customer cancelled', async () => {
    const { user, connector, reservation } = await scenario();

    await reservations.cancel(reservation.id, user.id);

    const bay = await prisma.evConnector.findUniqueOrThrow({ where: { id: connector.id } });
    expect(bay.status).toBe(EvConnectorStatus.AVAILABLE);
    const after = await prisma.evReservation.findUniqueOrThrow({ where: { id: reservation.id } });
    expect(after.status).toBe(EvReservationStatus.CANCELLED);
  });

  it('does not free a charging bay when the sweep acts on a stale read', async () => {
    // The interleaving that matters, constructed rather than raced for.
    //
    // `expireStaleReservations` selects the lapsed holds *outside* its
    // transaction and then writes from that list. A session that starts
    // between the select and the write is invisible to it: it still believes
    // the connector is merely reserved, and frees it. Two `Promise.allSettled`
    // calls do not reliably produce that window, so the state it produces is
    // built directly here — same write path, same inputs, deterministic.
    const { user, connector, reservation } = await scenario();
    await sessions.start({ connectorId: connector.id, reservationId: reservation.id }, user.id);
    // Rewind the reservation to what the sweep's stale list would hold.
    await prisma.evReservation.update({
      where: { id: reservation.id },
      data: { status: EvReservationStatus.CONFIRMED, expiresAt: new Date(Date.now() - 60_000) },
    });

    await reservations.expireStaleReservations(new Date());

    const bay = await prisma.evConnector.findUniqueOrThrow({ where: { id: connector.id } });
    // Freeing this bay sells the next customer a cable that is already
    // delivering energy to somebody else's car.
    expect(bay.status).toBe(EvConnectorStatus.CHARGING);
  });

  it('does not free a charging bay when a cancellation acts on a stale read', async () => {
    const { user, connector, reservation } = await scenario();
    await sessions.start({ connectorId: connector.id, reservationId: reservation.id }, user.id);
    await prisma.evReservation.update({
      where: { id: reservation.id },
      data: { status: EvReservationStatus.CONFIRMED },
    });

    await reservations.cancel(reservation.id, user.id).catch(() => undefined);

    const bay = await prisma.evConnector.findUniqueOrThrow({ where: { id: connector.id } });
    expect(bay.status).toBe(EvConnectorStatus.CHARGING);
  });

  it('does not let the sweep expire a hold that was already fulfilled', async () => {
    const { user, connector, reservation } = await scenario();
    await sessions.start({ connectorId: connector.id, reservationId: reservation.id }, user.id);

    await reservations.expireStaleReservations(new Date(Date.now() + 20 * 60_000));

    // A fulfilled hold is spent, not lapsed. Marking it EXPIRED would make
    // the record say the customer never turned up for a session they are
    // charging on right now.
    const after = await prisma.evReservation.findUniqueOrThrow({ where: { id: reservation.id } });
    expect(after.status).toBe(EvReservationStatus.FULFILLED);
  });
});
