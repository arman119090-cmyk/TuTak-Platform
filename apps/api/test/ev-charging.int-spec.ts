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
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { OutboxService } from '../src/modules/ledger/outbox.service';
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
  let ledger: LedgerService;
  let outbox: OutboxService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    sessions = harness.app.get(EvSessionsService);
    engine = harness.app.get(BonusEngineService);
    ledger = harness.app.get(LedgerService);
    outbox = harness.app.get(OutboxService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  /** Backdates a session so the reported energy is physically deliverable. */
  const backdate = (sessionId: string, hours = 2) =>
    prisma.evSession.update({
      where: { id: sessionId },
      data: { startedAt: new Date(Date.now() - hours * 3_600_000) },
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
    await backdate(session.id);
    await sessions.reportMeterValue(session.id, '25', user.id);
    const result = await sessions.stop(session.id, user.id, {});

    // 25 kWh × 100 AMD = 2500; 5% of 2500 = 125.
    expect(result.cost).toBe('2500');
    expect(result.bonusEarned).toBe('125');

    const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(after.pendingBonus.toFixed(4)).toBe('125.0000');
    await assertWalletIntegrity(prisma, wallet.id);
  });

  it('posts the accrual to the double-entry ledger, not just the wallet subledger', async () => {
    // The wallet-side BonusLedgerEntry subledger (asserted above) is not the
    // accounting source of truth — LedgerTransaction/LedgerPosting is. A
    // bonus that reaches the wallet with no matching posting here is real,
    // spendable money with no accounting record of who funded it: the
    // partner's payable never grows to cover it, so reconciliation can never
    // catch the shortfall.
    const { user, wallet, partner, connector } = await scenario({ rateBps: 500 });

    const session = await sessions.start({ connectorId: connector.id }, user.id);
    await backdate(session.id);
    await sessions.reportMeterValue(session.id, '25', user.id);
    const result = await sessions.stop(session.id, user.id, {});
    expect(result.bonusEarned).toBe('125');

    const ledgerTx = await prisma.ledgerTransaction.findFirstOrThrow({
      where: { kind: 'ev.charging.accrual', sourceType: 'Transaction' },
      include: { postings: true },
    });
    const postings = ledgerTx.postings;
    expect(postings).toHaveLength(2);

    const partnerAccount = await prisma.ledgerAccount.findFirstOrThrow({
      where: { type: 'PARTNER_PAYABLE', partnerId: partner.id },
    });
    const liabilityAccount = await prisma.ledgerAccount.findFirstOrThrow({
      where: { type: 'BONUS_LIABILITY' },
    });

    const partnerLeg = postings.find((p) => p.accountId === partnerAccount.id);
    const liabilityLeg = postings.find((p) => p.accountId === liabilityAccount.id);
    expect(partnerLeg?.direction).toBe('DEBIT');
    expect(partnerLeg?.amount.toFixed(4)).toBe('125.0000');
    expect(liabilityLeg?.direction).toBe('CREDIT');
    expect(liabilityLeg?.amount.toFixed(4)).toBe('125.0000');

    // Same sign convention as PurchaseIntentsService.postContributionLedger's
    // own primary-partner leg (purchase-intents.int-spec.ts: "the contribution
    // reduces what is owed"): PARTNER_PAYABLE is credit-normal, so a DEBIT
    // funding a customer's bonus moves the raw (debit-positive) balance up
    // and the negated "owed to partner" reading down by the same amount.
    const partnerAfter = await prisma.ledgerAccount.findUniqueOrThrow({
      where: { id: partnerAccount.id },
    });
    expect(partnerAfter.balance.toFixed(4)).toBe('125.0000');

    await assertWalletIntegrity(prisma, wallet.id);
  });

  it('never permanently loses the ledger posting when the fast-path post fails, and the outbox recovers it', async () => {
    // GitHub issue #28 (HEAD 0a9c7d5): the wallet accrual and its ledger
    // posting used to be two independent best-effort steps. If the second
    // one failed, the customer kept a real, spendable bonus with nothing at
    // all recording who funded it — a wallet→ledger gap with no recovery
    // path. The fix commits the accrual and a durable outbox promise to post
    // it atomically, then attempts the post immediately as a non-fatal fast
    // path. This proves the fast path failing does not lose the posting: it
    // only delays it until the outbox's guaranteed retry (`drain`) runs.
    const { user, wallet, connector, partner } = await scenario({ rateBps: 500 });

    const session = await sessions.start({ connectorId: connector.id }, user.id);
    await backdate(session.id);
    await sessions.reportMeterValue(session.id, '25', user.id);

    const postSpy = jest
      .spyOn(ledger, 'post')
      .mockImplementationOnce(() => Promise.reject(new Error('ledger post transiently unavailable')));

    // The session must still complete and credit the wallet even though the
    // fast-path ledger post is about to fail — the accrual is real money the
    // customer already earned, not something a bookkeeping hiccup may undo.
    const result = await sessions.stop(session.id, user.id, {});
    expect(result.bonusEarned).toBe('125');
    postSpy.mockRestore();

    const afterFailure = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(afterFailure.pendingBonus.toFixed(4)).toBe('125.0000');

    // Nothing has posted yet: the fast path's one attempt failed and was not
    // retried inline.
    expect(
      await prisma.ledgerTransaction.count({
        where: { kind: 'ev.charging.accrual', sourceType: 'Transaction' },
      }),
    ).toBe(0);

    // The durable promise survived the failed attempt: a pending outbox
    // event is exactly what turns "logged and forgotten" into "guaranteed,
    // just not yet".
    const pending = await prisma.outboxEvent.findFirstOrThrow({
      where: { eventType: 'ev.accrual.ledger_post', processedAt: null },
    });
    expect(pending.attempts).toBe(0);

    // The guaranteed-retry backstop now runs, exactly as the sweep would.
    // (`stopOnce` also publishes an unrelated `transaction.completed` event
    // via TransactionsService, so more than one event may be drained here —
    // what matters is that *our* event was among them.)
    await outbox.drain();
    expect(
      (await prisma.outboxEvent.findUniqueOrThrow({ where: { id: pending.id } })).processedAt,
    ).not.toBeNull();

    const ledgerTx = await prisma.ledgerTransaction.findFirstOrThrow({
      where: { kind: 'ev.charging.accrual', sourceType: 'Transaction' },
      include: { postings: true },
    });
    const partnerAccount = await prisma.ledgerAccount.findFirstOrThrow({
      where: { type: 'PARTNER_PAYABLE', partnerId: partner.id },
    });
    const liabilityAccount = await prisma.ledgerAccount.findFirstOrThrow({
      where: { type: 'BONUS_LIABILITY' },
    });
    const partnerLeg = ledgerTx.postings.find((p) => p.accountId === partnerAccount.id);
    const liabilityLeg = ledgerTx.postings.find((p) => p.accountId === liabilityAccount.id);
    expect(partnerLeg?.direction).toBe('DEBIT');
    expect(partnerLeg?.amount.toFixed(4)).toBe('125.0000');
    expect(liabilityLeg?.direction).toBe('CREDIT');
    expect(liabilityLeg?.amount.toFixed(4)).toBe('125.0000');

    // Re-draining must not double-post: the event is now processed, and even
    // if it were reclaimed, postAccrualLedgerIdempotent's existing-row check
    // would refuse a second insert.
    expect(await outbox.drain()).toBe(0);
    expect(
      await prisma.ledgerTransaction.count({
        where: { kind: 'ev.charging.accrual', sourceType: 'Transaction' },
      }),
    ).toBe(1);

    await assertWalletIntegrity(prisma, wallet.id);
  });

  it('frees the connector and writes a CDR when the session completes', async () => {
    const { user, connector } = await scenario();

    const session = await sessions.start({ connectorId: connector.id }, user.id);
    await backdate(session.id);
    expect(
      (await prisma.evConnector.findUniqueOrThrow({ where: { id: connector.id } })).status,
    ).toBe(EvConnectorStatus.CHARGING);

    await sessions.reportMeterValue(session.id, '10', user.id);
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
    await backdate(session.id);
    await sessions.reportMeterValue(session.id, '25', user.id);
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
      await backdate(session.id);
      await sessions.reportMeterValue(session.id, '50', user.id);

      // A meter only counts up. Accepting a lower value would let a caller
      // rewrite the bill downwards after the energy was delivered.
      await expect(sessions.reportMeterValue(session.id, '10', user.id)).rejects.toThrow(
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
      await backdate(session.id);

      await expect(sessions.reportMeterValue(session.id, value, user.id)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuses a reading for a session that is not charging', async () => {
      const { user, connector } = await scenario();
      const session = await sessions.start({ connectorId: connector.id }, user.id);
      await backdate(session.id);
      await sessions.reportMeterValue(session.id, '5', user.id);
      await sessions.stop(session.id, user.id, {});

      await expect(sessions.reportMeterValue(session.id, '9999', user.id)).rejects.toThrow(
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
      await backdate(session.id);
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
      await backdate(session.id);
      await sessions.reportMeterValue(session.id, '5', user.id);
      await sessions.stop(session.id, user.id, {});

      await expect(sessions.stop(session.id, user.id, {})).rejects.toThrow(/cannot be stopped/);
      expect(await prisma.evCdr.count({ where: { sessionId: session.id } })).toBe(1);
    });

    it('rejects a negative bonus rather than inflating the accrual base', async () => {
      const { user, wallet, connector } = await scenario({ rateBps: 1000 });
      const session = await sessions.start({ connectorId: connector.id }, user.id);
      await backdate(session.id);
      await sessions.reportMeterValue(session.id, '25', user.id);

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
      await backdate(session.id);
      await sessions.reportMeterValue(session.id, '1', user.id); // 100 AMD

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
      await backdate(session.id);
      await sessions.reportMeterValue(session.id, '25', user.id);

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
