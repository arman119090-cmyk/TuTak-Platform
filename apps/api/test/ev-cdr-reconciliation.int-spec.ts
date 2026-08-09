import { randomUUID } from 'node:crypto';
import { EvCdrReconciliation, PrismaClient } from '@prisma/client';
import { EvCdrReconciliationService } from '../src/modules/ev-charging/ev-cdr-reconciliation.service';
import { EvSessionsService } from '../src/modules/ev-charging/ev-sessions.service';
import { OCPI_ADAPTER, OcpiAdapter } from '../src/modules/ev-charging/ocpi/ocpi-adapter.interface';
import { createCustomer, createEvConnector, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';
import { assertWalletIntegrity } from './setup/invariants';

/**
 * Settling a roaming session against the operator who delivered it.
 *
 * On TuTak's own stations there is one meter and it is ours. On a roaming
 * station there are two — ours, fed by whatever the client reports, and the
 * CPO's, attached to the cable — and theirs is authoritative, because they own
 * the hardware and they invoice the platform from it. `fetchCdr` had been
 * declared on the adapter and called from nowhere, so a roaming session was
 * billed on a number nothing external corroborated.
 *
 * The asymmetry these tests pin down is the whole design decision: an
 * overcharge is returned without asking, an undercharge is never silently
 * taken. Going back into a customer's wallet days later for a figure they
 * never saw and cannot check is a second charge, not a correction.
 */
describe('Roaming CDR reconciliation (integration)', () => {
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
    // The noop adapter refuses roaming outright, which is the right
    // production behaviour when no operator is configured — and means these
    // tests have to stand in for one that is.
    // A fresh id per call, because `EvSession.ocpiCdrId` is unique and a real
    // operator never hands the same session id to two cars. A constant here
    // made the second roaming session in a test collide, which the constraint
    // correctly refused.
    jest
      .spyOn(adapter, 'startRemoteSession')
      .mockImplementation(() =>
        Promise.resolve({ accepted: true, ocpiSessionId: `CPO-SESSION-${randomUUID()}` }),
      );
    jest.spyOn(adapter, 'stopRemoteSession').mockResolvedValue({ accepted: true });
  });

  /** What the operator will say when asked. */
  const cpoReports = (energyKwh: number, cost: number) =>
    jest.spyOn(adapter, 'fetchCdr').mockResolvedValue({
      ocpiCdrId: `CPO-CDR-${randomUUID()}`,
      totalEnergyKwh: energyKwh,
      totalCost: cost,
      totalTimeSec: 3600,
      raw: { reported: cost },
    });

  /** A session on a roaming connector, billed at our own reading. */
  const roamingSession = async (reportedKwh: string, options: { bonus?: string } = {}) => {
    const { user, wallet } = await createCustomer(prisma);
    const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
    const connector = await createEvConnector(prisma, {
      partnerId: partner.id,
      pricePerKwh: '100.00',
    });
    // What makes it roaming: the connector belongs to somebody else's network.
    await prisma.evConnector.update({
      where: { id: connector.id },
      // Unique per call: `ocpiEvseUid` is a unique column, and a test that
      // needs two roaming stations must not collide on it.
      data: { ocpiEvseUid: `EVSE-REMOTE-${randomUUID()}` },
    });
    if (options.bonus) {
      await prisma.wallet.update({
        where: { id: wallet.id },
        data: { availableBonus: options.bonus, lifetimeEarned: options.bonus },
      });
      await prisma.bonusLot.create({
        data: {
          walletId: wallet.id,
          type: 'ACCRUAL_MANUAL_ADJUSTMENT',
          status: 'AVAILABLE',
          originalAmount: options.bonus,
          remainingAmount: options.bonus,
          availableAt: new Date(),
          expiresAt: new Date(Date.now() + 365 * 86_400_000),
        },
      });
    }

    const session = await sessions.start({ connectorId: connector.id }, user.id);
    await prisma.evSession.update({
      where: { id: session.id },
      data: { startedAt: new Date(Date.now() - 3 * 3_600_000) },
    });
    await sessions.reportMeterValue(session.id, reportedKwh, user.id);
    const result = await sessions.stop(session.id, user.id, {
      ...(options.bonus ? { bonusAmountToApply: options.bonus } : {}),
    });
    return { user, wallet, partner, connector, session, result };
  };

  const cdrFor = (sessionId: string) =>
    prisma.evCdr.findUniqueOrThrow({ where: { sessionId } });

  describe('which sessions are reconciled at all', () => {
    it('marks a roaming session as awaiting its operator', async () => {
      const { session } = await roamingSession('20');

      const cdr = await cdrFor(session.id);
      expect(cdr.reconciliation).toBe(EvCdrReconciliation.PENDING);
    });

    it("leaves our own stations alone — there is only one meter and it is ours", async () => {
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma);
      const connector = await createEvConnector(prisma, {
        partnerId: partner.id,
        pricePerKwh: '100.00',
      });
      const session = await sessions.start({ connectorId: connector.id }, user.id);
      await prisma.evSession.update({
        where: { id: session.id },
        data: { startedAt: new Date(Date.now() - 3 * 3_600_000) },
      });
      await sessions.reportMeterValue(session.id, '20', user.id);
      await sessions.stop(session.id, user.id, {});

      const cdr = await cdrFor(session.id);
      expect(cdr.reconciliation).toBe(EvCdrReconciliation.NOT_APPLICABLE);
      // And the sweep never touches it.
      cpoReports(20, 2000);
      expect(await reconciler.reconcilePending()).toBe(0);
    });
  });

  describe('when the operator agrees', () => {
    it('records the match and changes no money', async () => {
      const { session } = await roamingSession('20');
      cpoReports(20, 2000);

      expect(await reconciler.reconcilePending()).toBe(1);

      const cdr = await cdrFor(session.id);
      expect(cdr.reconciliation).toBe(EvCdrReconciliation.MATCHED);
      expect(cdr.cpoCost!.toString()).toBe('2000');
      const charge = await prisma.transaction.findFirstOrThrow({
        where: { type: 'EV_CHARGING' },
      });
      expect(charge.amount.toString()).toBe('2000');
    });

    it('treats a rounding-sized difference as agreement, not drift', async () => {
      // Two meters and two rounding steps are never bit-identical. Calling
      // that a discrepancy would alert on every healthy session.
      const { session } = await roamingSession('20');
      cpoReports(20, 1999.5);

      await reconciler.reconcilePending();

      expect((await cdrFor(session.id)).reconciliation).toBe(EvCdrReconciliation.MATCHED);
      expect(harness.alerts.matching('ev.cdr')).toHaveLength(0);
    });
  });

  describe('when the operator delivered less than we billed', () => {
    it('corrects the charge down to what was actually delivered', async () => {
      const { session } = await roamingSession('20');
      // We billed 2000; the cable delivered 15 kWh, so 1500.
      cpoReports(15, 1500);

      await reconciler.reconcilePending();

      const charge = await prisma.transaction.findFirstOrThrow({
        where: { type: 'EV_CHARGING' },
      });
      expect(charge.amount.toString()).toBe('1500');
      const cdr = await cdrFor(session.id);
      expect(cdr.reconciliation).toBe(EvCdrReconciliation.CORRECTED);
      expect(cdr.totalCost.toString()).toBe('2000');
      // Both figures survive: the disagreement is the thing worth being able
      // to look at after a dispute.
      expect(cdr.cpoCost!.toString()).toBe('1500');
    });

    it('claws back the points earned on money that was never spent', async () => {
      const { wallet, session } = await roamingSession('20');
      const before = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      // 5% of 2000 = 100 points issued on the inflated bill.
      expect(before.pendingBonus.plus(before.availableBonus).toString()).toBe('100');

      cpoReports(15, 1500);
      await reconciler.reconcilePending();

      // 5% of 1500 = 75 is what was actually earned.
      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(after.pendingBonus.plus(after.availableBonus).toString()).toBe('75');
      await assertWalletIntegrity(prisma, wallet.id);
      expect((await cdrFor(session.id)).reconciliation).toBe(EvCdrReconciliation.CORRECTED);
    });

    it('tells a human, because a station that keeps disagreeing is a bad integration', async () => {
      await roamingSession('20');
      cpoReports(15, 1500);

      await reconciler.reconcilePending();

      const fired = harness.alerts.matching('ev.cdr.corrected');
      expect(fired).toHaveLength(1);
      expect(fired[0]!.context).toMatchObject({ operator: '1500', returned: '500' });
    });
  });

  describe('when the operator delivered more than we billed', () => {
    it('does not quietly take more from the customer', async () => {
      const { wallet } = await roamingSession('20');
      const before = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      cpoReports(25, 2500);

      await reconciler.reconcilePending();

      // The bill stands at what the customer was told. Reaching back into
      // their wallet days later for a number they never saw is a second
      // charge, not a correction.
      const charge = await prisma.transaction.findFirstOrThrow({
        where: { type: 'EV_CHARGING' },
      });
      expect(charge.amount.toString()).toBe('2000');
      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(after.availableBonus.toString()).toBe(before.availableBonus.toString());
      expect(after.pendingBonus.toString()).toBe(before.pendingBonus.toString());
    });

    it('records it and escalates it for a person to decide', async () => {
      const { session } = await roamingSession('20');
      cpoReports(25, 2500);

      await reconciler.reconcilePending();

      const cdr = await cdrFor(session.id);
      expect(cdr.reconciliation).toBe(EvCdrReconciliation.UNDERBILLED);
      expect(cdr.cpoCost!.toString()).toBe('2500');
      const fired = harness.alerts.matching('ev.cdr.underbilled');
      expect(fired).toHaveLength(1);
      expect(fired[0]!.context).toMatchObject({ billed: '2000', operator: '2500' });
    });
  });

  describe('when the operator never settles', () => {
    it('keeps the session pending while the CDR is merely late', async () => {
      const { session } = await roamingSession('20');
      jest.spyOn(adapter, 'fetchCdr').mockResolvedValue(null);

      expect(await reconciler.reconcilePending()).toBe(0);

      const cdr = await cdrFor(session.id);
      expect(cdr.reconciliation).toBe(EvCdrReconciliation.PENDING);
      expect(cdr.fetchAttempts).toBe(1);
    });

    it('gives up after enough tries and says so', async () => {
      const { session } = await roamingSession('20');
      jest.spyOn(adapter, 'fetchCdr').mockResolvedValue(null);

      // Twelve passes, which at five minutes apart is an hour of asking.
      for (let i = 0; i < 12; i += 1) await reconciler.reconcilePending();

      const cdr = await cdrFor(session.id);
      expect(cdr.reconciliation).toBe(EvCdrReconciliation.UNAVAILABLE);
      const fired = harness.alerts.matching('ev.cdr.unavailable');
      expect(fired).toHaveLength(1);
    });

    it('survives an operator whose API is down without losing the others', async () => {
      const a = await roamingSession('20');
      const b = await roamingSession('10');
      let call = 0;
      jest.spyOn(adapter, 'fetchCdr').mockImplementation(() => {
        call += 1;
        if (call === 1) return Promise.reject(new Error('CPO gateway timeout'));
        return Promise.resolve({
          ocpiCdrId: `CPO-CDR-${randomUUID()}`,
          totalEnergyKwh: 10,
          totalCost: 1000,
          totalTimeSec: 3600,
          raw: {},
        });
      });

      await reconciler.reconcilePending();

      // The one that threw stays pending for the next pass; the other settled.
      expect((await cdrFor(a.session.id)).reconciliation).toBe(EvCdrReconciliation.PENDING);
      expect((await cdrFor(b.session.id)).reconciliation).toBe(EvCdrReconciliation.MATCHED);
    });
  });

  describe('running it twice', () => {
    it('does not correct the same session twice', async () => {
      const { wallet, session } = await roamingSession('20');
      cpoReports(15, 1500);

      await reconciler.reconcilePending();
      const afterFirst = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      await reconciler.reconcilePending();

      // A settled CDR is no longer pending, so a second pass finds nothing —
      // which is what stops a repeated sweep clawing back the points again.
      const afterSecond = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(afterSecond.availableBonus.toString()).toBe(afterFirst.availableBonus.toString());
      expect((await cdrFor(session.id)).reconciliation).toBe(EvCdrReconciliation.CORRECTED);
      await assertWalletIntegrity(prisma, wallet.id);
    });
  });
});
