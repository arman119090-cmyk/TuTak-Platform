import { randomUUID } from 'node:crypto';
import { EvCdrReconciliation, PrismaClient } from '@prisma/client';
import { EvCdrReconciliationService } from '../src/modules/ev-charging/ev-cdr-reconciliation.service';
import { EvSessionsService } from '../src/modules/ev-charging/ev-sessions.service';
import { OCPI_ADAPTER, OcpiAdapter } from '../src/modules/ev-charging/ocpi/ocpi-adapter.interface';
import { BonusEngineService } from '../src/modules/wallet/bonus-engine.service';
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
  let engine: BonusEngineService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    sessions = harness.app.get(EvSessionsService);
    reconciler = harness.app.get(EvCdrReconciliationService);
    adapter = harness.app.get<OcpiAdapter>(OCPI_ADAPTER);
    engine = harness.app.get(BonusEngineService);
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
      // 5% of 2000 = 100 pool. A roaming-CPO session settles like every other purchase
      // (2026-08-22 3-level referral rework): the whole pool splits
      // directly by the six-leg rule, no upfront TuTak cut — the
      // customer's immediate green share, the only leg that reaches the
      // wallet, is 20% of 100 = 20.
      expect(before.pendingBonus.plus(before.availableBonus).toString()).toBe('20');

      cpoReports(15, 1500);
      await reconciler.reconcilePending();

      // 5% of 1500 = 75 pool → 15 green, the same fraction (75%) of the
      // original green the correction reduced the bill by.
      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(after.pendingBonus.plus(after.availableBonus).toString()).toBe('15');
      await assertWalletIntegrity(prisma, wallet.id);
      expect((await cdrFor(session.id)).reconciliation).toBe(EvCdrReconciliation.CORRECTED);
    });

    it('claws back the double-entry ledger too — partner payable, bonus liability, and platform revenue, not just the wallet', async () => {
      // GitHub issue #28 (final financial blocker, 2026-08-18): correcting
      // the Transaction row and the customer's wallet was never enough —
      // the original `ev.charging.contribution` posting (partner debited
      // the full pool, bonus liability/revenue credited their shares) was
      // computed against the original, now-superseded cost. Left alone,
      // the partner would still owe the inflated pool and platform revenue
      // would stay overstated by exactly the clawed-back amount — the
      // ledger would stop reconstructing partner balances from immutable
      // postings.
      const { partner } = await roamingSession('20');

      const partnerAccount = await prisma.ledgerAccount.findFirstOrThrow({
        where: { type: 'PARTNER_PAYABLE', partnerId: partner.id },
      });
      const liabilityAccount = await prisma.ledgerAccount.findFirstOrThrow({
        where: { type: 'BONUS_LIABILITY' },
      });
      const revenueAccount = await prisma.ledgerAccount.findFirstOrThrow({
        where: { type: 'PLATFORM_REVENUE' },
      });
      // Pool 100 (5% of 2000) → green 20, deferred 30 (liability 50), no
      // referrer at any level so L1/L2/L3 are all 0 and TuTak's residual is
      // 100 − 20 − 30 = 50. Partner DEBIT 100, liability CREDIT 50, revenue
      // CREDIT 50.
      const partnerBefore = await prisma.ledgerAccount.findUniqueOrThrow({ where: { id: partnerAccount.id } });
      expect(partnerBefore.balance.toFixed(4)).toBe('100.0000');

      cpoReports(15, 1500);
      await reconciler.reconcilePending();

      // Corrected to 75% of the bill: every leg the pool split granted is
      // clawed back by that same fraction — green 20→15 (clawback 5),
      // deferred 30→22.5 (clawback 7.5), on top of TuTak's own residual
      // 50→37.5 (clawback 12.5). Total clawback: 5+7.5+12.5 = 25, which is
      // exactly 25% of the original pool of 100 — the same fraction the
      // transaction amount itself was corrected by.
      const correction = await prisma.ledgerTransaction.findFirstOrThrow({
        where: { kind: 'ev.charging.contribution.correction', sourceType: 'Transaction' },
        include: { postings: true },
      });
      expect(correction.postings).toHaveLength(3);
      const partnerLeg = correction.postings.find((p) => p.accountId === partnerAccount.id);
      const liabilityLeg = correction.postings.find((p) => p.accountId === liabilityAccount.id);
      const revenueLeg = correction.postings.find((p) => p.accountId === revenueAccount.id);
      // Reverses the original signs: the partner is credited back (owes
      // less), liability and revenue are debited down (both shrink).
      expect(partnerLeg?.direction).toBe('CREDIT');
      expect(partnerLeg?.amount.toFixed(4)).toBe('25.0000');
      expect(liabilityLeg?.direction).toBe('DEBIT');
      expect(liabilityLeg?.amount.toFixed(4)).toBe('12.5000');
      expect(revenueLeg?.direction).toBe('DEBIT');
      expect(revenueLeg?.amount.toFixed(4)).toBe('12.5000');

      const partnerAfter = await prisma.ledgerAccount.findUniqueOrThrow({ where: { id: partnerAccount.id } });
      expect(partnerAfter.balance.toFixed(4)).toBe('75.0000');
    });

    it('claws back the deferred and referrer legs proportionally too, not just green', async () => {
      const { user: referrer, wallet: referrerWallet } = await createCustomer(prisma);
      await prisma.referralCode.create({ data: { userId: referrer.id, code: 'TT-CDRREFER' } });
      const { user: referee, wallet } = await createCustomer(prisma);
      await prisma.referralInvite.create({
        data: { referrerType: 'USER', referrerUserId: referrer.id, refereeUserId: referee.id },
      });
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
      const connector = await createEvConnector(prisma, { partnerId: partner.id, pricePerKwh: '100.00' });
      await prisma.evConnector.update({
        where: { id: connector.id },
        data: { ocpiEvseUid: `EVSE-REMOTE-${randomUUID()}` },
      });

      const session = await sessions.start({ connectorId: connector.id }, referee.id);
      await prisma.evSession.update({
        where: { id: session.id },
        data: { startedAt: new Date(Date.now() - 3 * 3_600_000) },
      });
      await sessions.reportMeterValue(session.id, '20', referee.id);
      const result = await sessions.stop(session.id, referee.id, {});

      // Pool 100 → deferred 30 (20% green/30% deferred, unchanged), L1
      // (this referrer, the direct referrer) 10% of 100 = 10.
      const lotBefore = await prisma.deferredBonusLot.findFirstOrThrow({
        where: { sourceTransactionId: result.transactionId },
      });
      expect(lotBefore.amount.toFixed(4)).toBe('30.0000');
      const referrerBefore = await prisma.wallet.findUniqueOrThrow({ where: { id: referrerWallet.id } });
      expect(referrerBefore.availableBonus.toFixed(4)).toBe('10.0000');

      cpoReports(15, 1500);
      await reconciler.reconcilePending();

      // Corrected to 75% of the original bill — every leg the pool split
      // granted is clawed back by that same fraction, not just green:
      // deferred 30→22.5 (clawback 7.5), L1 10→7.5 (clawback 2.5).
      const lotAfter = await prisma.deferredBonusLot.findUniqueOrThrow({ where: { id: lotBefore.id } });
      expect(lotAfter.refundedAmount.toFixed(4)).toBe('7.5000');
      const referrerAfter = await prisma.wallet.findUniqueOrThrow({ where: { id: referrerWallet.id } });
      expect(referrerAfter.availableBonus.toFixed(4)).toBe('7.5000');

      await assertWalletIntegrity(prisma, wallet.id);
      await assertWalletIntegrity(prisma, referrerWallet.id);
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

      // Same idempotency for the ledger side: exactly one correction
      // posting, never a second one clawing the same amount back again.
      expect(
        await prisma.ledgerTransaction.count({
          where: { kind: 'ev.charging.contribution.correction', sourceType: 'Transaction' },
        }),
      ).toBe(1);
    });

    it('does not double-credit an overcharge refund when two sweeps race on the same still-PENDING CDR', async () => {
      // Independent audit, GitHub issue #28: the sweep's advisory Redis lock
      // is not authoritative — a run stalled past its TTL by a
      // slow/unreachable CPO can overlap with the next scheduled run, and
      // `correctOvercharge`'s "excess points returned" step
      // (`ACCRUAL_MANUAL_ADJUSTMENT`) has no dedupe against
      // `sourceTransactionId` of its own. Two overlapping runs reconciling
      // the same still-PENDING CDR must never both pay that refund out.
      const { wallet, session } = await roamingSession('20', { bonus: '500' });
      // Held 500 points against a 2000 bill; the operator says the real cost
      // was only 100 — the whole 500 hold now exceeds it, so 400 is owed
      // back to the wallet, exactly once.
      cpoReports(1, 100);

      const before = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });

      // Two concurrent sweeps, racing on the exact same CDR row.
      await Promise.all([reconciler.reconcilePending(), reconciler.reconcilePending()]);

      const cdr = await cdrFor(session.id);
      expect(cdr.reconciliation).toBe(EvCdrReconciliation.CORRECTED);

      const transaction = await prisma.transaction.findFirstOrThrow({ where: { type: 'EV_CHARGING' } });
      const overchargeRefunds = await prisma.bonusLot.findMany({
        where: { type: 'ACCRUAL_MANUAL_ADJUSTMENT', sourceTransactionId: transaction.id },
      });
      expect(overchargeRefunds).toHaveLength(1);
      expect(overchargeRefunds[0]!.originalAmount.toString()).toBe('400');

      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      // 500 held minus the 100 actually owed, credited back exactly once.
      // (Not checked against `assertWalletIntegrity` here: this test's
      // `roamingSession(..., { bonus })` fixture seeds the held balance by
      // writing the wallet/lot directly rather than through the ledger, so
      // ledger reconstruction does not apply to it — orthogonal to the race
      // this test exists to catch.)
      expect(after.availableBonus.minus(before.availableBonus).toString()).toBe('400');
    });

    it('rolls back the whole correction atomically when a wallet step fails, leaving the CDR safely retryable rather than half-applied or permanently skipped', async () => {
      // Independent audit, GitHub issue #28 — a second-pass finding against
      // this file's own `reconcilingAt` fix: `correctOvercharge` used to be
      // four separate commits (claw back over-accrued points, return
      // over-applied points, correct the transaction, mark the CDR
      // CORRECTED), with the two wallet-moving steps caught-and-logged
      // instead of thrown. A crash or a genuine failure between a wallet
      // mutation and the final `settle()` either left a correction half
      // applied (and a later stale-claim reclaim could apply it *again*), or
      // — worse — got swallowed while the CDR was still marked CORRECTED
      // right after, permanently skipping a correction that never happened.
      // Now the whole thing is one transaction: a failure must roll back
      // everything, including the CDR's own status, and a retry must be
      // able to apply the correction cleanly exactly once.
      const { wallet, session } = await roamingSession('20', { bonus: '500' });
      cpoReports(1, 100); // 500 held vs 100 owed: 400 excess to return
      const before = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      const transactionBefore = await prisma.transaction.findFirstOrThrow({
        where: { type: 'EV_CHARGING' },
      });

      jest
        .spyOn(engine, 'accrue')
        .mockImplementationOnce(() => Promise.reject(new Error('simulated failure mid-correction')));

      // The failing pass: reconcilePending's own try/catch logs the error
      // and moves on, matching how it already treats any other reconcileOne
      // failure — nothing here should have left a trace.
      expect(await reconciler.reconcilePending()).toBe(0);

      const afterFailure = await cdrFor(session.id);
      expect(afterFailure.reconciliation).toBe(EvCdrReconciliation.PENDING);
      const transactionAfterFailure = await prisma.transaction.findUniqueOrThrow({
        where: { id: transactionBefore.id },
      });
      // Not corrected: the whole transaction rolled back, including this
      // write, not just the wallet steps.
      expect(transactionAfterFailure.amount.toString()).toBe(transactionBefore.amount.toString());
      const walletAfterFailure = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(walletAfterFailure.availableBonus.toString()).toBe(before.availableBonus.toString());
      const refundsAfterFailure = await prisma.bonusLot.findMany({
        where: { type: 'ACCRUAL_MANUAL_ADJUSTMENT', sourceTransactionId: transactionBefore.id },
      });
      expect(refundsAfterFailure).toHaveLength(0);

      // The failed attempt's claim is left in place (same as a genuine
      // crash would leave it) — reclaimable once stale. Force that here
      // instead of waiting 5 real minutes.
      await prisma.evCdr.update({
        where: { sessionId: session.id },
        data: { reconcilingAt: new Date(Date.now() - 6 * 60_000) },
      });

      // The retry: `accrue` behaves normally this time (no more mocked
      // rejection), so the correction should apply cleanly, exactly once.
      expect(await reconciler.reconcilePending()).toBe(1);

      const afterRetry = await cdrFor(session.id);
      expect(afterRetry.reconciliation).toBe(EvCdrReconciliation.CORRECTED);
      const transactionAfterRetry = await prisma.transaction.findUniqueOrThrow({
        where: { id: transactionBefore.id },
      });
      expect(transactionAfterRetry.amount.toString()).toBe('100');
      const refundsAfterRetry = await prisma.bonusLot.findMany({
        where: { type: 'ACCRUAL_MANUAL_ADJUSTMENT', sourceTransactionId: transactionBefore.id },
      });
      expect(refundsAfterRetry).toHaveLength(1);
      expect(refundsAfterRetry[0]!.originalAmount.toString()).toBe('400');
      const walletAfterRetry = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(walletAfterRetry.availableBonus.minus(before.availableBonus).toString()).toBe('400');
    });
  });
});
