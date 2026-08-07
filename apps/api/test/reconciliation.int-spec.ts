import {
  FraudSignalType,
  LedgerAccountType,
  PrismaClient,
  ReconciliationStatus,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PaymentEngineService } from '../src/modules/payments/payment-engine.service';
import { PayoutEngineService } from '../src/modules/payouts/payout-engine.service';
import { ReconciliationService } from '../src/modules/reconciliation/reconciliation.service';
import { createCustomer, createPartner } from './setup/fixtures';
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
});
