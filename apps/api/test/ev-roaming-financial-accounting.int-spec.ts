import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { EvCdrReconciliationService } from '../src/modules/ev-charging/ev-cdr-reconciliation.service';
import { EvSessionsService } from '../src/modules/ev-charging/ev-sessions.service';
import { OCPI_ADAPTER, OcpiAdapter } from '../src/modules/ev-charging/ocpi/ocpi-adapter.interface';
import { createCustomer, createPartner, createRoamingCpoStation } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';
import { assertWalletIntegrity } from './setup/invariants';

/**
 * docs/ROAMING_CPO_FINANCIAL_ACCOUNTING_2026-08-29.md — the piece the
 * 2026-08-27 security pass deliberately left unbuilt: an app-initiated
 * `ROAMING_CPO` session used to fail closed forever at `stop()`, because
 * nothing froze the dual rate at `start()` or billed from the CPO's own CDR
 * once it finally arrived. These tests exercise that whole path end to end —
 * `EvSessionsService.start()`/`stop()` and
 * `EvCdrReconciliationService.completeAppInitiatedSession()` together —
 * rather than any one of them in isolation, because the guarantee that
 * matters ("the rate a customer is billed at can never move after the plug
 * goes in") only shows up across the seam between the two.
 */
describe('Roaming-CPO frozen-rate financial accounting (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let sessions: EvSessionsService;
  let reconciler: EvCdrReconciliationService;
  let adapter: OcpiAdapter;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    sessions = harness.app.get(EvSessionsService);
    reconciler = harness.app.get(EvCdrReconciliationService);
    adapter = harness.app.get<OcpiAdapter>(OCPI_ADAPTER);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    await harness.resetAlerts();
    jest.restoreAllMocks();
    jest
      .spyOn(adapter, 'startRemoteSession')
      .mockImplementation(() =>
        Promise.resolve({ accepted: true, ocpiSessionId: `CPO-SESSION-${randomUUID()}` }),
      );
    jest.spyOn(adapter, 'stopRemoteSession').mockResolvedValue({ accepted: true });
  });

  /** What the operator will eventually say, once its CDR is ready. */
  const cpoReports = (energyKwh: number) =>
    jest.spyOn(adapter, 'fetchCdr').mockResolvedValue({
      ocpiCdrId: `CPO-CDR-${randomUUID()}`,
      totalEnergyKwh: energyKwh,
      // Never read for the app-initiated path — it bills from its own frozen
      // rate against the CPO's energy figure, not the CPO's own cost figure
      // (that field only matters to `reconcileOne`, the walk-in correction
      // path, which never touches an `AWAITING_SETTLEMENT` session).
      totalCost: 0,
      totalTimeSec: 3600,
      raw: { energyKwh },
    });

  /** Flips the flags `start()` requires before it will admit a ROAMING_CPO connector. */
  const enableAppCharging = async (stationId: string, connectorId: string) => {
    await prisma.evStation.update({
      where: { id: stationId },
      data: { customerChargingEnabled: true, remoteStartSupported: true, remoteStopSupported: true },
    });
    await prisma.evConnector.update({
      where: { id: connectorId },
      data: { ocpiEvseUid: `evse-${connectorId}` },
    });
  };

  const startAndStop = async (userId: string, connectorId: string) => {
    const started = await sessions.start({ connectorId }, userId);
    const stopped = await sessions.stop(started.id, userId, {});
    return { started, stopped };
  };

  describe('start() — freezing the dual rate', () => {
    it('freezes the station retail rate, partner wholesale rate and margin cap onto the session, immune to a later change to any of them', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma, {
        evWholesaleRatePerKwh: '75',
        evMarginReferralCapPerKwh: '20',
      });
      const { station, connector } = await createRoamingCpoStation(prisma, {
        partnerId: partner.id,
        standardRetailRatePerKwh: '115',
      });
      await enableAppCharging(station.id, connector.id);

      const started = await sessions.start({ connectorId: connector.id }, user.id);
      expect(started.stationRetailRatePerKwh?.toString()).toBe('115');
      expect(started.wholesaleRatePerKwh?.toString()).toBe('75');
      expect(started.marginReferralCapPerKwh?.toString()).toBe('20');

      // A later change to either the station's tariff or the partner's
      // contract must never reach back into a session already in flight.
      await prisma.evStation.update({ where: { id: station.id }, data: { standardRetailRatePerKwh: '999' } });
      await prisma.partner.update({
        where: { id: partner.id },
        data: { evWholesaleRatePerKwh: '1', evMarginReferralCapPerKwh: '1' },
      });

      const reloaded = await prisma.evSession.findUniqueOrThrow({ where: { id: started.id } });
      expect(reloaded.stationRetailRatePerKwh?.toString()).toBe('115');
      expect(reloaded.wholesaleRatePerKwh?.toString()).toBe('75');
      expect(reloaded.marginReferralCapPerKwh?.toString()).toBe('20');
    });

    it('refuses to start when the station has no retail rate configured yet, rather than freezing a null it could never bill with', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma);
      const { station, connector } = await createRoamingCpoStation(prisma, { partnerId: partner.id });
      await enableAppCharging(station.id, connector.id);
      await prisma.evStation.update({ where: { id: station.id }, data: { standardRetailRatePerKwh: null } });

      await expect(sessions.start({ connectorId: connector.id }, user.id)).rejects.toThrow(
        /no retail rate configured yet/,
      );
      expect(await prisma.evSession.count()).toBe(0);
      const untouched = await prisma.evConnector.findUniqueOrThrow({ where: { id: connector.id } });
      expect(untouched.status).toBe('AVAILABLE');
    });
  });

  describe('completeAppInitiatedSession() — billing from the CPO’s own trusted CDR', () => {
    it('bills the frozen rate against the CPO-reported energy, splits the margin, and posts a balanced double-entry ledger', async () => {
      const { user, wallet } = await createCustomer(prisma);
      const partner = await createPartner(prisma, {
        evWholesaleRatePerKwh: '60',
        evMarginReferralCapPerKwh: '15',
      });
      const { station, connector } = await createRoamingCpoStation(prisma, {
        partnerId: partner.id,
        standardRetailRatePerKwh: '100',
      });
      await enableAppCharging(station.id, connector.id);
      const { started } = await startAndStop(user.id, connector.id);

      cpoReports(10);
      expect(await reconciler.reconcilePending()).toBe(1);

      // cost = 100 * 10 = 1000; wholesale = 60 * 10 = 600; margin = 40,
      // capped at 15 → pool = 150, uncapped = 25 * 10 = 250.
      const session = await prisma.evSession.findUniqueOrThrow({ where: { id: started.id } });
      expect(session.status).toBe('COMPLETED');
      expect(session.energyKwh?.toString()).toBe('10');
      expect(session.cost?.toFixed(4)).toBe('1000.0000');
      expect(session.transactionId).not.toBeNull();

      const cdr = await prisma.evCdr.findUniqueOrThrow({ where: { sessionId: started.id } });
      expect(cdr.reconciliation).toBe('NOT_APPLICABLE');
      expect(cdr.totalEnergy.toString()).toBe('10');
      expect(cdr.totalCost.toFixed(4)).toBe('1000.0000');

      const transaction = await prisma.transaction.findUniqueOrThrow({ where: { id: session.transactionId! } });
      expect(transaction.status).toBe('COMPLETED');
      expect(transaction.amount.toFixed(4)).toBe('1000.0000');

      // pool 150 → green 20% = 30, deferred 30% = 45, no referral chain so
      // TuTak's residual absorbs the rest.
      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(after.pendingBonus.plus(after.availableBonus).toFixed(4)).toBe('30.0000');
      await assertWalletIntegrity(prisma, wallet.id);

      // Double-entry ledger: TuTak now owes the partner the wholesale
      // amount (CREDIT, reversed from the walk-in/commission model, because
      // here TuTak is the one buying wholesale and reselling at retail) and
      // is itself owed the full retail cost by the customer (DEBIT into the
      // dedicated receivable account, which nothing yet collects — see that
      // account type's own docblock).
      const partnerAccount = await prisma.ledgerAccount.findFirstOrThrow({
        where: { type: 'PARTNER_PAYABLE', partnerId: partner.id },
      });
      const liabilityAccount = await prisma.ledgerAccount.findFirstOrThrow({ where: { type: 'BONUS_LIABILITY' } });
      const revenueAccount = await prisma.ledgerAccount.findFirstOrThrow({ where: { type: 'PLATFORM_REVENUE' } });
      const receivableAccount = await prisma.ledgerAccount.findFirstOrThrow({
        where: { type: 'EV_ROAMING_RECEIVABLE' },
      });

      const posting = await prisma.ledgerTransaction.findFirstOrThrow({
        where: { kind: 'ev.roaming.app_settlement', sourceType: 'Transaction', sourceId: session.transactionId! },
        include: { postings: true },
      });
      const partnerLeg = posting.postings.find((p) => p.accountId === partnerAccount.id);
      const liabilityLeg = posting.postings.find((p) => p.accountId === liabilityAccount.id);
      const revenueLeg = posting.postings.find((p) => p.accountId === revenueAccount.id);
      const receivableLeg = posting.postings.find((p) => p.accountId === receivableAccount.id);

      expect(partnerLeg?.direction).toBe('CREDIT');
      expect(partnerLeg?.amount.toFixed(4)).toBe('600.0000');
      expect(liabilityLeg?.direction).toBe('CREDIT');
      expect(liabilityLeg?.amount.toFixed(4)).toBe('75.0000'); // green 30 + deferred 45
      expect(revenueLeg?.direction).toBe('CREDIT');
      expect(revenueLeg?.amount.toFixed(4)).toBe('325.0000'); // tutak residual 75 + uncapped 250
      expect(receivableLeg?.direction).toBe('DEBIT');
      // Debit is the sum of every credit by construction, and that sum
      // happens to equal the retail cost exactly: wholesale + capped margin
      // + uncapped margin === wholesale + (retail - wholesale) === retail.
      expect(receivableLeg?.amount.toFixed(4)).toBe('1000.0000');

      // Balance moves by +amount on a DEBIT and -amount on a CREDIT
      // (`LedgerService`'s own convention, shared by every account type) —
      // so a partner CREDITED for wholesale owed goes negative, the mirror
      // image of the commission model's positive "partner owes TuTak" balance.
      const partnerBalance = await prisma.ledgerAccount.findUniqueOrThrow({ where: { id: partnerAccount.id } });
      expect(partnerBalance.balance.toFixed(4)).toBe('-600.0000');
    });

    it('suppresses the customer-facing bonus split for an affiliated (self-dealing) customer, but still pays the partner wholesale and books full TuTak margin as revenue', async () => {
      const { user, wallet } = await createCustomer(prisma);
      const partner = await createPartner(prisma, {
        evWholesaleRatePerKwh: '60',
        evMarginReferralCapPerKwh: '15',
      });
      await prisma.partnerMembership.create({ data: { partnerId: partner.id, userId: user.id } });
      const { station, connector } = await createRoamingCpoStation(prisma, {
        partnerId: partner.id,
        standardRetailRatePerKwh: '100',
      });
      await enableAppCharging(station.id, connector.id);
      const { started } = await startAndStop(user.id, connector.id);

      cpoReports(10);
      expect(await reconciler.reconcilePending()).toBe(1);

      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(after.lifetimeEarned.toFixed(4)).toBe('0.0000');
      await assertWalletIntegrity(prisma, wallet.id);

      const partnerAccount = await prisma.ledgerAccount.findFirstOrThrow({
        where: { type: 'PARTNER_PAYABLE', partnerId: partner.id },
      });
      const revenueAccount = await prisma.ledgerAccount.findFirstOrThrow({ where: { type: 'PLATFORM_REVENUE' } });
      const liabilityBefore = await prisma.ledgerAccount.findFirst({ where: { type: 'BONUS_LIABILITY' } });

      const session = await prisma.evSession.findUniqueOrThrow({ where: { id: started.id } });
      const posting = await prisma.ledgerTransaction.findFirstOrThrow({
        where: { kind: 'ev.roaming.app_settlement', sourceType: 'Transaction', sourceId: session.transactionId! },
        include: { postings: true },
      });
      const partnerLeg = posting.postings.find((p) => p.accountId === partnerAccount.id);
      const revenueLeg = posting.postings.find((p) => p.accountId === revenueAccount.id);
      const liabilityLeg = liabilityBefore
        ? posting.postings.find((p) => p.accountId === liabilityBefore.id)
        : undefined;

      // Same wholesale obligation and same total margin either way — only
      // the customer-facing split is suppressed, mirroring the walk-in
      // roaming settlement's own `eligible` fallback rather than the
      // internal EV path's stricter "skip the whole pool" behaviour.
      expect(partnerLeg?.amount.toFixed(4)).toBe('600.0000');
      expect(liabilityLeg).toBeUndefined();
      expect(revenueLeg?.amount.toFixed(4)).toBe('400.0000'); // whole pool 150 + uncapped 250
    });
  });

  describe('when the operator never settles', () => {
    it('keeps the session AWAITING_SETTLEMENT while the CDR is merely late', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma);
      const { station, connector } = await createRoamingCpoStation(prisma, { partnerId: partner.id });
      await enableAppCharging(station.id, connector.id);
      const { started } = await startAndStop(user.id, connector.id);
      jest.spyOn(adapter, 'fetchCdr').mockResolvedValue(null);

      expect(await reconciler.reconcilePending()).toBe(0);

      const session = await prisma.evSession.findUniqueOrThrow({ where: { id: started.id } });
      expect(session.status).toBe('AWAITING_SETTLEMENT');
      expect(session.settlementAttempts).toBe(1);
      expect(session.settlementGivenUpAt).toBeNull();
    });

    it('gives up after enough tries, alerts a human, and never bills a figure nothing corroborates', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma);
      const { station, connector } = await createRoamingCpoStation(prisma, { partnerId: partner.id });
      await enableAppCharging(station.id, connector.id);
      const { started } = await startAndStop(user.id, connector.id);
      jest.spyOn(adapter, 'fetchCdr').mockResolvedValue(null);

      // Twelve passes — the same ceiling `reconcileOne` uses for a PENDING CDR.
      for (let i = 0; i < 12; i += 1) await reconciler.reconcilePending();

      const session = await prisma.evSession.findUniqueOrThrow({ where: { id: started.id } });
      expect(session.status).toBe('AWAITING_SETTLEMENT');
      expect(session.settlementGivenUpAt).not.toBeNull();
      expect(session.transactionId).toBeNull();
      expect(await prisma.evCdr.count({ where: { sessionId: started.id } })).toBe(0);

      const fired = harness.alerts.matching('ev.roaming.settlement_unavailable');
      expect(fired).toHaveLength(1);
      expect(fired[0]!.severity).toBe('critical');

      // A given-up session is not retried again — the sweep's own query
      // excludes anything with `settlementGivenUpAt` set.
      const fetchMock = adapter.fetchCdr as unknown as jest.Mock;
      const fetchCalls = fetchMock.mock.calls.length;
      expect(await reconciler.reconcilePending()).toBe(0);
      expect(fetchMock.mock.calls.length).toBe(fetchCalls);
    });
  });

  describe('running it twice', () => {
    it('never bills the same AWAITING_SETTLEMENT session twice when two sweeps race on it', async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma);
      const { station, connector } = await createRoamingCpoStation(prisma, { partnerId: partner.id });
      await enableAppCharging(station.id, connector.id);
      const { started } = await startAndStop(user.id, connector.id);
      cpoReports(10);

      await Promise.all([reconciler.reconcilePending(), reconciler.reconcilePending()]);

      const session = await prisma.evSession.findUniqueOrThrow({ where: { id: started.id } });
      expect(session.status).toBe('COMPLETED');
      expect(await prisma.transaction.count({ where: { userId: user.id, type: 'EV_CHARGING' } })).toBe(1);
      expect(await prisma.evCdr.count({ where: { sessionId: started.id } })).toBe(1);
      expect(
        await prisma.ledgerTransaction.count({
          where: { kind: 'ev.roaming.app_settlement', sourceType: 'Transaction', sourceId: session.transactionId! },
        }),
      ).toBe(1);
    });
  });
});
