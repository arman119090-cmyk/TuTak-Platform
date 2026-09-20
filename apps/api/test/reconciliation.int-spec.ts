import {
  FraudSignalType,
  LedgerAccountType,
  PrismaClient,
  ReconciliationStatus,
  RoleName,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PaymentEngineService } from '../src/modules/payments/payment-engine.service';
import { PayoutEngineService } from '../src/modules/payouts/payout-engine.service';
import { PurchaseIntentsService } from '../src/modules/purchase-intents/purchase-intents.service';
import { PurchaseIntentRefundService } from '../src/modules/purchase-intents/purchase-intent-refund.service';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../src/infrastructure/redis/redis.module';
import { ReconciliationService } from '../src/modules/reconciliation/reconciliation.service';
import { createCustomer, createPartner, createStaffUser, fundPrepaidBalance } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Reconciliation.
 *
 * The behaviour under test is mostly a refusal: drift is recorded and
 * escalated, never corrected. An engine that silently adjusts a balance to
 * match a statement destroys the evidence of the bug it exists to find, and
 * converts a detectable one-off into a permanent invisible loss. So these
 * tests check that after drift is found, the numbers are still exactly as
 * wrong as they were — and that the money has stopped moving.
 */
describe('ReconciliationService (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let payments: PaymentEngineService;
  let payouts: PayoutEngineService;
  let reconciliation: ReconciliationService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    payments = harness.app.get(PaymentEngineService);
    payouts = harness.app.get(PayoutEngineService);
    reconciliation = harness.app.get(ReconciliationService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  const yesterday = () => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  };

  const earn = async (partnerId: string, amount: string, key: string) => {
    const { user } = await createCustomer(prisma);
    return payments.capture({
      userId: user.id,
      partnerId,
      amount,
      sourceToken: 'tok_visa_test',
      idempotencyKey: key,
    });
  };

  // ── Clean runs ────────────────────────────────────────────────────────

  it('reports clean when the ledger agrees with itself and with the statement', async () => {
    const partner = await createPartner(prisma);
    await earn(partner.id, '10000', 'recon-clean-1');

    const result = await reconciliation.reconcile({
      periodStart: yesterday(),
      pspReceivable: '10000',
      partnerPayables: [{ partnerId: partner.id, amount: '9750' }],
    });

    expect(result.status).toBe(ReconciliationStatus.CLEAN);
    expect(result.findings).toHaveLength(0);
    expect(result.partnersBlocked).toHaveLength(0);
  });

  it('reports clean on internal consistency alone when no statement is supplied', async () => {
    // What it can do with no acquirer or bank feed — which is the situation
    // today — is still worth running: it catches the ledger disagreeing with
    // itself, which is a bug here rather than a dispute with a third party.
    const partner = await createPartner(prisma);
    await earn(partner.id, '5000', 'recon-internal-1');

    const result = await reconciliation.reconcile({ periodStart: yesterday() });

    expect(result.status).toBe(ReconciliationStatus.CLEAN);
    const run = await prisma.reconciliationRun.findUniqueOrThrow({
      where: { periodStart: yesterday() },
    });
    expect(run.status).toBe(ReconciliationStatus.CLEAN);
  });

  // ── Drift ─────────────────────────────────────────────────────────────

  it('detects a materialized balance that disagrees with its own postings', async () => {
    const partner = await createPartner(prisma);
    await earn(partner.id, '10000', 'recon-internal-drift');

    // Corrupt the balance directly, the way a bug in a future write path
    // would: postings say one thing, the cached balance says another.
    const account = await prisma.ledgerAccount.findFirstOrThrow({
      where: { type: LedgerAccountType.PSP_RECEIVABLE },
    });
    await prisma.ledgerAccount.update({
      where: { id: account.id },
      data: { balance: new Decimal('9000') },
    });

    const result = await reconciliation.reconcile({ periodStart: yesterday() });

    expect(result.status).toBe(ReconciliationStatus.DRIFT_DETECTED);
    const finding = result.findings.find((f) => f.account.includes('materialized-vs-postings'));
    expect(finding).toBeDefined();
    expect(finding!.expected).toBe('10000.0000');
    expect(finding!.reported).toBe('9000.0000');
    expect(finding!.drift).toBe('-1000.0000');
  });

  it('detects the acquirer reporting less than the ledger claims', async () => {
    const partner = await createPartner(prisma);
    await earn(partner.id, '10000', 'recon-psp-drift');

    const result = await reconciliation.reconcile({
      periodStart: yesterday(),
      pspReceivable: '9500',
    });

    expect(result.status).toBe(ReconciliationStatus.DRIFT_DETECTED);
    const finding = result.findings.find((f) => f.account === 'PSP_RECEIVABLE');
    expect(finding).toBeDefined();
    expect(finding!.drift).toBe('500.0000');
  });

  it('records a fraud signal when drift is found', async () => {
    const partner = await createPartner(prisma);
    await earn(partner.id, '10000', 'recon-signal-1');

    await reconciliation.reconcile({
      periodStart: yesterday(),
      partnerPayables: [{ partnerId: partner.id, amount: '9000' }],
    });

    const signals = await prisma.fraudSignal.findMany({
      where: { type: FraudSignalType.SETTLEMENT_DRIFT },
    });
    expect(signals).toHaveLength(1);
    expect(signals[0]!.severity).toBe('HIGH');
  });

  it('never corrects the drift it finds', async () => {
    const partner = await createPartner(prisma);
    await earn(partner.id, '10000', 'recon-nocorrect-1');
    const before = await payouts.availableBalance(partner.id);

    await reconciliation.reconcile({
      periodStart: yesterday(),
      partnerPayables: [{ partnerId: partner.id, amount: '5000' }],
    });

    // The bank says 5,000, the ledger says 9,750, and after reconciliation
    // the ledger still says 9,750. Adjusting it to match would destroy the
    // only evidence that something is wrong.
    const after = await payouts.availableBalance(partner.id);
    expect(after.toFixed(4)).toBe(before.toFixed(4));
    expect(after.toFixed(4)).toBe('9750.0000');
  });

  // ── Drift stops the money ─────────────────────────────────────────────

  it('blocks the affected partner and refuses their payouts afterwards', async () => {
    const partner = await createPartner(prisma);
    await earn(partner.id, '10000', 'recon-block-1');

    // A payout works before reconciliation runs.
    await payouts.requestPayout({
      partnerId: partner.id,
      amount: '1000',
      actorId: 'admin-1',
      idempotencyKey: 'payout-prior-1',
    });

    const result = await reconciliation.reconcile({
      periodStart: yesterday(),
      partnerPayables: [{ partnerId: partner.id, amount: '5000' }],
    });

    expect(result.partnersBlocked).toEqual([partner.id]);
    const blocked = await prisma.partner.findUniqueOrThrow({ where: { id: partner.id } });
    expect(blocked.payoutsBlockedAt).not.toBeNull();

    // And now the money has stopped, even though the balance is nominally
    // sufficient — refusing to pay against a balance known to be wrong is
    // the correct failure.
    await expect(
      payouts.requestPayout({
        partnerId: partner.id,
        amount: '1000',
        actorId: 'admin-1',
        idempotencyKey: 'payout-after-block',
      }),
    ).rejects.toThrow(/Payouts are blocked/);
  });

  it('leaves unaffected partners able to be paid', async () => {
    const affected = await createPartner(prisma, { displayName: 'Affected' });
    const healthy = await createPartner(prisma, { displayName: 'Healthy' });
    await earn(affected.id, '10000', 'recon-scope-a');
    await earn(healthy.id, '10000', 'recon-scope-b');

    await reconciliation.reconcile({
      periodStart: yesterday(),
      partnerPayables: [
        { partnerId: affected.id, amount: '5000' },
        { partnerId: healthy.id, amount: '9750' },
      ],
    });

    const stillFine = await prisma.partner.findUniqueOrThrow({ where: { id: healthy.id } });
    expect(stillFine.payoutsBlockedAt).toBeNull();

    const paid = await payouts.requestPayout({
      partnerId: healthy.id,
      amount: '1000',
      actorId: 'admin-1',
      idempotencyKey: 'payout-healthy-1',
    });
    expect(paid.payoutId).toBeDefined();
  });

  it('blocks nothing platform-wide when the drift is on a platform account', async () => {
    // There is no single party to hold a PSP discrepancy against, and
    // halting every payout on the platform is a bigger outage than the
    // discrepancy. The signal is raised; the money keeps moving.
    const partner = await createPartner(prisma);
    await earn(partner.id, '10000', 'recon-platform-1');

    const result = await reconciliation.reconcile({
      periodStart: yesterday(),
      pspReceivable: '9000',
    });

    expect(result.status).toBe(ReconciliationStatus.DRIFT_DETECTED);
    expect(result.partnersBlocked).toHaveLength(0);
    const stillFine = await prisma.partner.findUniqueOrThrow({ where: { id: partner.id } });
    expect(stillFine.payoutsBlockedAt).toBeNull();
  });

  it('lets a human clear the block once resolved', async () => {
    const partner = await createPartner(prisma);
    await earn(partner.id, '10000', 'recon-clear-1');
    await reconciliation.reconcile({
      periodStart: yesterday(),
      partnerPayables: [{ partnerId: partner.id, amount: '5000' }],
    });

    await reconciliation.clearPayoutBlock(partner.id, 'admin-1');

    const cleared = await prisma.partner.findUniqueOrThrow({ where: { id: partner.id } });
    expect(cleared.payoutsBlockedAt).toBeNull();
    expect(cleared.payoutsBlockedReason).toBeNull();

    const paid = await payouts.requestPayout({
      partnerId: partner.id,
      amount: '1000',
      actorId: 'admin-1',
      idempotencyKey: 'payout-cleared-1',
    });
    expect(paid.payoutId).toBeDefined();
  });

  // ── Re-running ────────────────────────────────────────────────────────

  it('overwrites the previous run for the same day rather than duplicating it', async () => {
    const partner = await createPartner(prisma);
    await earn(partner.id, '10000', 'recon-rerun-1');
    const day = yesterday();

    await reconciliation.reconcile({ periodStart: day, pspReceivable: '9000' });
    const drifted = await prisma.reconciliationRun.findUniqueOrThrow({
      where: { periodStart: day },
    });
    expect(drifted.status).toBe(ReconciliationStatus.DRIFT_DETECTED);

    // The acquirer sends a corrected statement.
    await reconciliation.reconcile({ periodStart: day, pspReceivable: '10000' });

    expect(await prisma.reconciliationRun.count()).toBe(1);
    const rerun = await prisma.reconciliationRun.findUniqueOrThrow({
      where: { periodStart: day },
    });
    expect(rerun.status).toBe(ReconciliationStatus.CLEAN);
  });

  it('tolerates sub-unit rounding without calling it drift', async () => {
    const partner = await createPartner(prisma);
    await earn(partner.id, '10000', 'recon-tolerance-1');

    const result = await reconciliation.reconcile({
      periodStart: yesterday(),
      pspReceivable: '10000.00005',
    });

    expect(result.status).toBe(ReconciliationStatus.CLEAN);
  });

  it('keeps a blocked partner blocked when a later run is clean', async () => {
    // Reconciliation raises blocks; only a human clears them. An engine that
    // both raises and clears its own blocks can talk itself out of a real
    // problem — a single clean night is not evidence the money was found.
    const partner = await createPartner(prisma);
    await earn(partner.id, '10000', 'recon-sticky-1');

    await reconciliation.reconcile({
      periodStart: yesterday(),
      partnerPayables: [{ partnerId: partner.id, amount: '5000' }],
    });

    const today = new Date();
    await reconciliation.reconcile({
      periodStart: new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
      ),
      partnerPayables: [{ partnerId: partner.id, amount: '9750' }],
    });

    const stillBlocked = await prisma.partner.findUniqueOrThrow({ where: { id: partner.id } });
    expect(stillBlocked.payoutsBlockedAt).not.toBeNull();

    await expect(
      payouts.requestPayout({
        partnerId: partner.id,
        amount: '100',
        actorId: 'admin-1',
        idempotencyKey: 'payout-sticky-1',
      }),
    ).rejects.toThrow(/Payouts are blocked/);
  });

  /**
   * The hybrid-funding invariants (brief §32 A–E, 20.09.2026). Each test
   * breaks one record by hand — the way a bug would, never through the
   * services — and expects the nightly run to name it rather than
   * reconcile it away.
   */
  describe('hybrid funding invariants', () => {
    const hybridPurchase = async (confirm = true) => {
      const purchaseIntents = harness.app.get(PurchaseIntentsService);
      const ledger = harness.app.get(LedgerService);
      const { user } = await createCustomer(prisma);
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
      const role = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.PARTNER_OWNER } });
      const staff = await createStaffUser(prisma);
      await prisma.userRole.create({ data: { userId: staff.id, roleId: role.id, partnerId: partner.id } });
      await fundPrepaidBalance(ledger, user.id, '50000');
      const intent = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '50000', prepaidAmountApplied: '45000' },
        user.id,
      );
      if (confirm) await purchaseIntents.confirm(intent.id, staff.id);
      return { user, partner, intent, staff };
    };

    it('is clean after a prepaid-funded purchase, before and after confirmation', async () => {
      await hybridPurchase(false);
      expect((await reconciliation.reconcile({ periodStart: yesterday() })).status).toBe(ReconciliationStatus.CLEAN);
      await hybridPurchase(true);
      expect((await reconciliation.reconcile({ periodStart: yesterday() })).findings).toEqual([]);
    });

    it('C: names a hold the reserved account does not carry, and the customer it belongs to', async () => {
      const { user, intent } = await hybridPurchase(false);
      // The bug: the purchase still claims 45 000 held, but the reserved
      // account was drained by something that bypassed the engine.
      const reserved = await prisma.ledgerAccount.findFirstOrThrow({
        where: { type: 'CUSTOMER_PREPAID_RESERVED', userId: user.id },
      });
      await prisma.$executeRawUnsafe(
        `UPDATE "ledger_accounts" SET "balance" = 0 WHERE "id" = $1`,
        reserved.id,
      );
      const result = await reconciliation.reconcile({ periodStart: yesterday() });
      expect(result.status).toBe(ReconciliationStatus.DRIFT_DETECTED);
      expect(result.findings.map((f) => f.account)).toEqual(
        expect.arrayContaining([
          'CUSTOMER_PREPAID_RESERVED:materialized-vs-postings',
          `CUSTOMER_PREPAID_RESERVED:${user.id}:open-holds-vs-reserved`,
        ]),
      );
      const c = result.findings.find((f) => f.account.endsWith('open-holds-vs-reserved'))!;
      expect(c.expected).toBe('45000.0000');
      expect(c.reported).toBe('0.0000');
      expect(intent.prepaidAmountApplied.toFixed(4)).toBe('45000.0000');
    });

    it('D: names a partner credited twice for what its confirmed purchases say TuTak funded once', async () => {
      const { partner, user, intent } = await hybridPurchase(true);
      // The bug: a second funding posting for the same purchase — the
      // double partner payable §31 forbids. Postings are append-only (the
      // database refuses a delete), so the discrepancy is planted the only
      // way it could really arise: one posting too many.
      const ledger = harness.app.get(LedgerService);
      await ledger.post({
        kind: 'partner.prepaid_funding',
        sourceType: 'PurchaseIntent',
        sourceId: intent.id,
        postings: [
          {
            accountId: (await ledger.accountFor({ type: 'CUSTOMER_PREPAID_RESERVED', userId: user.id })).id,
            direction: 'DEBIT',
            amount: new Decimal('45000'),
          },
          {
            accountId: (await ledger.accountFor({ type: 'PARTNER_PAYABLE', partnerId: partner.id })).id,
            direction: 'CREDIT',
            amount: new Decimal('45000'),
          },
        ],
      });

      const result = await reconciliation.reconcile({ periodStart: yesterday() });
      const d = result.findings.find((f) => f.account === 'PARTNER_PAYABLE:prepaid-funding-vs-purchases');
      expect(d).toMatchObject({ partnerId: partner.id, expected: '45000.0000', reported: '90000.0000' });
      expect(result.partnersBlocked).toContain(partner.id);
    });

    it('E: names a partner whose ledger balance the settlement view cannot account for', async () => {
      const { partner } = await hybridPurchase(true);
      const account = await prisma.ledgerAccount.findFirstOrThrow({
        where: { type: 'PARTNER_PAYABLE', partnerId: partner.id },
      });
      await prisma.$executeRawUnsafe(
        `UPDATE "ledger_accounts" SET "balance" = "balance" - 1000 WHERE "id" = $1`,
        account.id,
      );
      const result = await reconciliation.reconcile({ periodStart: yesterday() });
      expect(result.findings.map((f) => f.account)).toEqual(
        expect.arrayContaining(['PARTNER_PAYABLE:ledger-vs-settlement-view']),
      );
      expect(result.partnersBlocked).toContain(partner.id);
    });

    it('A: names completed top-ups the balance credits do not add up to', async () => {
      const { user } = await createCustomer(prisma);
      // A COMPLETED row with no ledger transaction behind it — the state a
      // crash between the claim and the posting would leave if the two were
      // not one transaction.
      await prisma.balanceTopUp.create({
        data: { userId: user.id, amount: new Decimal('7000'), status: 'COMPLETED', providerReference: 'ghost-1' },
      });
      const result = await reconciliation.reconcile({ periodStart: yesterday() });
      expect(result.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ account: 'TOPUPS:completed-vs-balance-credits', expected: '7000.0000', reported: '0.0000' }),
        ]),
      );
    });

    it('warns about refunds whose cash slice the business has not confirmed for a week', async () => {
      const refunds = harness.app.get(PurchaseIntentRefundService);
      const { intent, staff } = await hybridPurchase(true);
      const refund = await refunds.refund({
        purchaseIntentId: intent.id,
        amount: '10000',
        reason: 'returned',
        actorId: staff.id,
        idempotencyKey: 'stale-1',
      });
      expect(refund.externalRefundStatus).toBe('PENDING_PARTNER');
      await prisma.purchaseIntentRefund.update({
        where: { id: refund.refundId },
        data: { createdAt: new Date(Date.now() - 8 * 24 * 60 * 60_000) },
      });
      harness.alerts.clear();
      // The alert key is per day and suppressed in Redis for a while; a
      // previous run in the same day must not swallow this one.
      const redis = harness.app.get<Redis>(REDIS_CLIENT);
      const keys = await redis.keys('alert:sent:refund.external-pending:*');
      if (keys.length) await redis.del(...keys);
      const result = await reconciliation.reconcile({ periodStart: yesterday() });
      expect(result.status).toBe(ReconciliationStatus.CLEAN);
      const warning = harness.alerts.sent.find((a) => a.key.startsWith('refund.external-pending:'));
      expect(warning?.severity).toBe('warning');
      expect(warning?.body).toContain('1000.0000');
    });
  });
});
