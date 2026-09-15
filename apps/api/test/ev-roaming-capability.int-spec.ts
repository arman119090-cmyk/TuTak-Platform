import { BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { EvSessionsService } from '../src/modules/ev-charging/ev-sessions.service';
import { RoamingCpoCustomersService } from '../src/modules/roaming-cpo/roaming-cpo-customers.service';
import { RoamingCpoSettlementService } from '../src/modules/roaming-cpo/roaming-cpo-settlement.service';
import { createCustomer, createPartner, createRoamingCpoStation, linkRoamingCpoCustomer } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Problems 2 & 3, docs/ROAMING_CPO_INTEGRATION_2026-08-27-SECURITY.md.
 *
 * A `ROAMING_CPO` station used to be startable through the exact same local
 * claim path as TuTak's own hardware the moment a partner synced it — no
 * remote command was ever sent, so a "charging session" on one was pure
 * fiction. These tests exercise the fix directly at the service layer
 * (`EvSessionsService`), bypassing HTTP so the capability gate itself is
 * what's under test, not the controller wiring around it.
 */
describe('Roaming-CPO capability gating (integration)', () => {
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

  describe('start() — fake-session prevention', () => {
    it('refuses to start a session on a ROAMING_CPO connector with no capability flags set (the default)', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma);
      const { connector } = await createRoamingCpoStation(prisma, { partnerId: partner.id });

      await expect(sessions.start({ connectorId: connector.id }, user.id)).rejects.toThrow(
        /not available for in-app charging/,
      );

      expect(await prisma.evSession.count()).toBe(0);
      const untouched = await prisma.evConnector.findUniqueOrThrow({ where: { id: connector.id } });
      expect(untouched.status).toBe('AVAILABLE');
    });

    it('still refuses even when customerChargingEnabled is set without a wired ocpiEvseUid', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma);
      const { station, connector } = await createRoamingCpoStation(prisma, { partnerId: partner.id });
      await prisma.evStation.update({
        where: { id: station.id },
        data: { customerChargingEnabled: true, remoteStartSupported: true, remoteStopSupported: true },
      });

      // No `ocpiEvseUid` on the connector — nothing to actually command.
      await expect(sessions.start({ connectorId: connector.id }, user.id)).rejects.toThrow(
        /not configured for remote charging/,
      );
      expect(await prisma.evSession.count()).toBe(0);
    });

    it('fails closed on the No-op adapter even with every capability flag set and ocpiEvseUid wired', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma);
      const { station, connector } = await createRoamingCpoStation(prisma, { partnerId: partner.id });
      await prisma.evStation.update({
        where: { id: station.id },
        data: { customerChargingEnabled: true, remoteStartSupported: true, remoteStopSupported: true },
      });
      await prisma.evConnector.update({
        where: { id: connector.id },
        data: { ocpiEvseUid: `evse-${connector.id}` },
      });

      // The test harness wires the No-op OCPI adapter (no OCPI_* env vars
      // configured) — it always answers `{ accepted: false }`. This is the
      // task's explicit invariant: "missing/No-op adapter must reject, never
      // simulate success," verified end to end rather than just inspecting
      // the adapter class in isolation.
      await expect(sessions.start({ connectorId: connector.id }, user.id)).rejects.toThrow(
        /rejected the remote start/i,
      );

      // No half-claimed bay and no phantom session left behind by the
      // rejected attempt.
      const untouched = await prisma.evConnector.findUniqueOrThrow({ where: { id: connector.id } });
      expect(untouched.status).toBe('AVAILABLE');
      expect(await prisma.evSession.count()).toBe(0);
    });
  });

  describe('reportMeterValue() — never bills a CPO session from a customer-reported reading', () => {
    it('refuses a customer-reported meter value for a roaming-CPO session', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma);
      const { connector } = await createRoamingCpoStation(prisma, { partnerId: partner.id });
      const session = await prisma.evSession.create({
        data: { connectorId: connector.id, userId: user.id, status: 'CHARGING', startedAt: new Date() },
      });

      await expect(sessions.reportMeterValue(session.id, '5', user.id)).rejects.toThrow(BadRequestException);

      const untouched = await prisma.evSession.findUniqueOrThrow({ where: { id: session.id } });
      expect(untouched.energyKwh?.toString() ?? null).toBeNull();
    });

    it('refuses an operator-reported meter value for a roaming-CPO session too', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma);
      const { connector } = await createRoamingCpoStation(prisma, { partnerId: partner.id });
      const session = await prisma.evSession.create({
        data: { connectorId: connector.id, userId: user.id, status: 'CHARGING', startedAt: new Date() },
      });

      await expect(
        sessions.reportMeterValue(session.id, '5', null, { partnerId: partner.id }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('stop() — parks a roaming-CPO session pending trusted-CDR settlement, never bills it directly', () => {
    it('stops a roaming-CPO session into AWAITING_SETTLEMENT rather than billing it from local state', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma);
      const { connector } = await createRoamingCpoStation(prisma, { partnerId: partner.id });
      const session = await prisma.evSession.create({
        data: { connectorId: connector.id, userId: user.id, status: 'CHARGING', startedAt: new Date() },
      });

      const result = await sessions.stop(session.id, user.id, {});
      expect(result.status).toBe('AWAITING_SETTLEMENT');
      expect(result.cost).toBeNull();
      expect(result.transactionId).toBeNull();

      const updated = await prisma.evSession.findUniqueOrThrow({ where: { id: session.id } });
      expect(updated.status).toBe('AWAITING_SETTLEMENT');
      expect(updated.stoppedAt).not.toBeNull();
      expect(updated.transactionId).toBeNull();
      const freedConnector = await prisma.evConnector.findUniqueOrThrow({ where: { id: connector.id } });
      expect(freedConnector.status).toBe('AVAILABLE');
    });

    it('refuses to apply bonus points at stop — the final cost is not knowable yet', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma);
      const { connector } = await createRoamingCpoStation(prisma, { partnerId: partner.id });
      const session = await prisma.evSession.create({
        data: { connectorId: connector.id, userId: user.id, status: 'CHARGING', startedAt: new Date() },
      });

      await expect(sessions.stop(session.id, user.id, { bonusAmountToApply: '5' })).rejects.toThrow(
        BadRequestException,
      );

      const untouched = await prisma.evSession.findUniqueOrThrow({ where: { id: session.id } });
      expect(untouched.status).toBe('CHARGING');
      expect(untouched.stoppedAt).toBeNull();
    });

    it('refuses a second concurrent stop once the first has claimed it', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma);
      const { connector } = await createRoamingCpoStation(prisma, { partnerId: partner.id });
      const session = await prisma.evSession.create({
        data: { connectorId: connector.id, userId: user.id, status: 'CHARGING', startedAt: new Date() },
      });

      await sessions.stop(session.id, user.id, {});
      await expect(sessions.stop(session.id, user.id, {})).rejects.toThrow(BadRequestException);
    });
  });
});

/**
 * Problem 3: the customer-facing arbitrary linking flow is gone, and every
 * link it left behind (or that predates this change) is quarantined until a
 * trusted server-to-server handshake verifies it.
 */
describe('Roaming-CPO customer link quarantine (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let settlement: RoamingCpoSettlementService;
  let customersService: RoamingCpoCustomersService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    settlement = harness.app.get(RoamingCpoSettlementService);
    customersService = harness.app.get(RoamingCpoCustomersService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  it('refuses to settle against an unverified (quarantined) link', async () => {
    const { user } = await createCustomer(prisma);
    const partner = await createPartner(prisma);
    const { station, connector } = await createRoamingCpoStation(prisma, { partnerId: partner.id });
    await linkRoamingCpoCustomer(prisma, {
      partnerId: partner.id,
      userId: user.id,
      externalCustomerId: 'roaming-cust-quarantined',
      verified: false,
    });

    await expect(
      settlement.settle(partner.id, {
        externalSessionId: 'sess-quarantined',
        externalCustomerId: 'roaming-cust-quarantined',
        externalStationId: station.externalStationId!,
        externalConnectorId: connector.externalConnectorId!,
        energyKwh: '1',
        appliedCustomerRatePerKwh: '80',
        finalAmount: '80',
      }),
    ).rejects.toThrow(/not yet verified/);

    expect(await prisma.evSession.count()).toBe(0);
  });

  it('settles normally against a link created (and thus verified) through the trusted service path', async () => {
    const { user } = await createCustomer(prisma);
    const partner = await createPartner(prisma);
    const { station, connector } = await createRoamingCpoStation(prisma, { partnerId: partner.id });

    // Stands in for a trusted server-to-server handshake — never an
    // HTTP route a customer can reach with a self-entered id.
    await customersService.link(user.id, partner.id, 'roaming-cust-verified');

    const result = await settlement.settle(partner.id, {
      externalSessionId: 'sess-verified',
      externalCustomerId: 'roaming-cust-verified',
      externalStationId: station.externalStationId!,
      externalConnectorId: connector.externalConnectorId!,
      energyKwh: '1',
      appliedCustomerRatePerKwh: '80',
      finalAmount: '80',
    });

    expect(result.sessionId).toBeTruthy();
  });
});
