import { Money } from '@cashout/money';
import {
  createHarness,
  Harness,
  requestWithdrawal,
  resetDatabase,
  seedDriver,
  SeededDriver,
  seedPricing,
} from '../harness';

/**
 * The Fleet API v3 integration, exercised through the orchestrator against the
 * mock that models the v3 contract: idempotent tokens, an atomic
 * `condition.balance_min`, `in_progress` transactions and a status endpoint.
 *
 * None of this proves the live adapter works against a real park. It proves
 * that, given the contract as documented, the orchestrator never treats an
 * unknown outcome as a failure and never debits a driver twice.
 */
describe('Yandex Fleet API v3 integration', () => {
  let harness: Harness;
  let driver: SeededDriver;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase(harness.prisma);
    await harness.rateLimiter.resetAll();
    harness.yandex.reset();
    harness.provider.reset();
    await seedPricing(harness.prisma);
    driver = await seedDriver(harness, { balance: 5_000_000n });
  });

  /** Advances until the withdrawal stops moving, ignoring backoff timers. */
  async function drive(withdrawalId: string, rounds = 8): Promise<string> {
    for (let i = 0; i < rounds; i += 1) {
      await harness.prisma.withdrawal.updateMany({
        where: { id: withdrawalId },
        data: { nextAttemptAt: null },
      });
      await harness.orchestrator.advance(withdrawalId, 4);
    }
    return stateOf(withdrawalId);
  }

  async function stateOf(withdrawalId: string): Promise<string> {
    const row = await harness.prisma.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
    return row.state;
  }

  async function statesOf(withdrawalId: string): Promise<string[]> {
    const events = await harness.prisma.withdrawalEvent.findMany({
      where: { withdrawalId },
      orderBy: { at: 'asc' },
    });
    return events.map((event) => event.toState);
  }

  it('success: applies the debit with balance_min and completes', async () => {
    const created = await requestWithdrawal(harness, driver, 1_000_000n);
    expect(await drive(created.id)).toBe('COMPLETED');

    expect(harness.yandex.transactionCount(driver.yandexParkId, driver.contractorProfileId)).toBe(
      1,
    );
    expect(harness.yandex.balanceOf(driver.yandexParkId, driver.contractorProfileId)?.minor).toBe(
      4_000_000n,
    );
    const row = await harness.prisma.withdrawal.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.yandexTransactionId).toBe('mock-tx-1');
    expect(row.yandexBalanceAfterMinor).toBe(4_000_000n);
  });

  it('in_progress → success: waits on the status endpoint before paying out', async () => {
    harness.yandex.behaviour = { mode: 'in_progress', settleAfterPolls: 2 };
    const created = await requestWithdrawal(harness, driver, 1_000_000n);

    await harness.orchestrator.advance(created.id, 4);
    expect(await stateOf(created.id)).toBe('RESERVE_PENDING');
    // Nothing has been paid and nothing has been booked while it is pending.
    expect(harness.provider.payoutCount()).toBe(0);
    expect(await harness.prisma.journalEntry.count()).toBe(0);

    expect(await drive(created.id)).toBe('COMPLETED');
    expect(await statesOf(created.id)).toEqual([
      'CREATED',
      'RISK_CHECK',
      'RESERVING',
      'RESERVE_PENDING',
      'RESERVED',
      'PAYOUT_SUBMITTING',
      'PAYOUT_CONFIRMED',
      'COMPLETED',
    ]);
    expect(harness.yandex.createdCount()).toBe(1);
    expect(harness.provider.payoutCount()).toBe(1);
  });

  it('in_progress → fail: a final fail on a known id is a clean failure', async () => {
    harness.yandex.behaviour = { mode: 'in_progress_then_fail' };
    const created = await requestWithdrawal(harness, driver, 1_000_000n);

    expect(await drive(created.id)).toBe('FAILED');
    const row = await harness.prisma.withdrawal.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.failureCode).toBe('mock_failed');
    expect(harness.yandex.balanceOf(driver.yandexParkId, driver.contractorProfileId)?.minor).toBe(
      5_000_000n,
    );
    expect(await harness.prisma.journalEntry.count()).toBe(0);
    expect(harness.provider.payoutCount()).toBe(0);
  });

  it('timeout after POST (transaction pending): recovers the id by replaying the token', async () => {
    harness.yandex.behaviour = { mode: 'pending_but_timeout' };
    const created = await requestWithdrawal(harness, driver, 1_000_000n);

    await harness.orchestrator.advance(created.id, 3);
    expect(await stateOf(created.id)).toBe('RESERVE_UNCERTAIN');

    // The transaction now sits in_progress on Yandex's side; the replay of the
    // same token must return *it*, not create a second one.
    harness.yandex.behaviour = { mode: 'in_progress', settleAfterPolls: 1 };
    expect(await drive(created.id)).toBe('COMPLETED');

    expect(harness.yandex.createdCount()).toBe(1);
    expect(harness.yandex.transactionCount(driver.yandexParkId, driver.contractorProfileId)).toBe(
      1,
    );
    expect(harness.yandex.balanceOf(driver.yandexParkId, driver.contractorProfileId)?.minor).toBe(
      4_000_000n,
    );
    const states = await statesOf(created.id);
    expect(states).toContain('RESERVE_UNCERTAIN');
    expect(states).toContain('RESERVE_PENDING');
    expect(states.filter((state) => state === 'RESERVED')).toHaveLength(1);
  });

  it('timeout after POST (transaction applied): the replay returns the original', async () => {
    harness.yandex.behaviour = { mode: 'applied_but_timeout' };
    const created = await requestWithdrawal(harness, driver, 1_000_000n);

    await harness.orchestrator.advance(created.id, 3);
    expect(await stateOf(created.id)).toBe('RESERVE_UNCERTAIN');

    harness.yandex.behaviour = { mode: 'normal' };
    expect(await drive(created.id)).toBe('COMPLETED');
    expect(harness.yandex.createdCount()).toBe(1);
    expect(harness.yandex.balanceOf(driver.yandexParkId, driver.contractorProfileId)?.minor).toBe(
      4_000_000n,
    );
  });

  it('duplicate idempotency token: the adapter returns the same transaction and debits once', async () => {
    const input = {
      parkId: driver.yandexParkId,
      contractorProfileId: driver.contractorProfileId,
      amount: Money.fromMinor(1_000_000n, 'AMD'),
      kind: 'payout',
      description: 'Cash Out CO-TEST-TOKEN',
      idempotencyToken: 'duplicate-token-0123456789',
      balanceMin: Money.fromMinor(1_000_000n, 'AMD'),
    };
    const first = await harness.yandex.createDebit(input);
    const second = await harness.yandex.createDebit(input);

    expect(first.status).toBe('APPLIED');
    expect(second.status).toBe('APPLIED');
    if (first.status === 'APPLIED' && second.status === 'APPLIED') {
      expect(second.transaction.id).toBe(first.transaction.id);
    }
    expect(harness.yandex.createdCount()).toBe(1);
    expect(harness.yandex.balanceOf(driver.yandexParkId, driver.contractorProfileId)?.minor).toBe(
      4_000_000n,
    );
  });

  it('a replay does not re-evaluate the condition against the already-debited balance', async () => {
    const input = {
      parkId: driver.yandexParkId,
      contractorProfileId: driver.contractorProfileId,
      amount: Money.fromMinor(4_000_000n, 'AMD'),
      kind: 'payout',
      description: 'Cash Out CO-REPLAY',
      idempotencyToken: 'replay-condition-token-01',
      balanceMin: Money.fromMinor(4_000_000n, 'AMD'),
    };
    expect((await harness.yandex.createDebit(input)).status).toBe('APPLIED');
    // Balance is now 1 000 000, below balance_min — a fresh POST would be refused.
    expect((await harness.yandex.createDebit(input)).status).toBe('APPLIED');
    expect(harness.yandex.createdCount()).toBe(1);
  });

  it('condition failure: the balance dropped between confirmation and the debit', async () => {
    const created = await requestWithdrawal(harness, driver, 1_000_000n);
    // The park posts a debit of its own before we get to ours.
    harness.yandex.setBalance(
      driver.yandexParkId,
      driver.contractorProfileId,
      Money.fromMinor(500_000n, 'AMD'),
    );

    expect(await drive(created.id)).toBe('FAILED');
    const row = await harness.prisma.withdrawal.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.failureCode).toBe('condition_failed');
    expect(harness.yandex.createdCount()).toBe(0);
    expect(harness.yandex.balanceOf(driver.yandexParkId, driver.contractorProfileId)?.minor).toBe(
      500_000n,
    );
    expect(harness.provider.payoutCount()).toBe(0);
    expect(await harness.prisma.journalEntry.count()).toBe(0);
  });

  it('a rejection after an unanswered attempt goes to a person, not to FAILED', async () => {
    harness.yandex.behaviour = { mode: 'timeout' };
    const created = await requestWithdrawal(harness, driver, 1_000_000n);
    await harness.orchestrator.advance(created.id, 3);
    expect(await stateOf(created.id)).toBe('RESERVE_UNCERTAIN');

    harness.yandex.behaviour = { mode: 'reject' };
    expect(await drive(created.id, 3)).toBe('MANUAL_REVIEW');
    const row = await harness.prisma.withdrawal.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.manualReviewReason).toMatch(/does not prove/);
  });

  it('concurrent workers on one withdrawal produce exactly one Yandex transaction', async () => {
    const created = await requestWithdrawal(harness, driver, 1_000_000n);
    await Promise.all([
      harness.orchestrator.advance(created.id, 8),
      harness.orchestrator.advance(created.id, 8),
      harness.orchestrator.advance(created.id, 8),
    ]);
    expect(await drive(created.id)).toBe('COMPLETED');
    expect(harness.yandex.createdCount()).toBe(1);
    expect(harness.provider.payoutCount()).toBe(1);
  });

  it('status endpoint failure: waits, then escalates without paying out', async () => {
    harness.yandex.behaviour = { mode: 'in_progress' };
    const created = await requestWithdrawal(harness, driver, 1_000_000n);
    await harness.orchestrator.advance(created.id, 4);
    expect(await stateOf(created.id)).toBe('RESERVE_PENDING');

    harness.yandex.behaviour = { mode: 'status_unavailable' };
    expect(await drive(created.id, 10)).toBe('MANUAL_REVIEW');
    expect(harness.provider.payoutCount()).toBe(0);
    const row = await harness.prisma.withdrawal.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.manualReviewReason).toMatch(/status endpoint gave no answer/);
  });

  it('an in_progress debit that never settles escalates at the SLA', async () => {
    harness.yandex.behaviour = { mode: 'in_progress' };
    const created = await requestWithdrawal(harness, driver, 1_000_000n);
    await harness.orchestrator.advance(created.id, 4);
    expect(await stateOf(created.id)).toBe('RESERVE_PENDING');

    harness.clock.advanceSeconds(901);
    expect(await drive(created.id, 2)).toBe('MANUAL_REVIEW');
  });

  it('compensation after payout failure: the credit is its own v3 transaction', async () => {
    harness.provider.behaviour = { mode: 'reject', code: 'card_expired' };
    const created = await requestWithdrawal(harness, driver, 1_000_000n);

    expect(await drive(created.id)).toBe('REVERSED');
    const row = await harness.prisma.withdrawal.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.yandexTransactionId).toBe('mock-tx-1');
    expect(row.yandexReversalTransactionId).toBe('mock-tx-2');
    expect(harness.yandex.balanceOf(driver.yandexParkId, driver.contractorProfileId)?.minor).toBe(
      5_000_000n,
    );
    for (const balance of await harness.ledger.trialBalance()) {
      expect(balance.difference).toBe(0n);
    }
  });

  it('compensation that comes back in_progress is followed up by id, not re-posted', async () => {
    harness.provider.behaviour = { mode: 'reject', code: 'card_expired' };
    const created = await requestWithdrawal(harness, driver, 1_000_000n);
    // Six steps: risk check, reserve, submit, decline, begin compensation.
    await harness.orchestrator.advance(created.id, 6);
    expect(await stateOf(created.id)).toBe('COMPENSATING');

    harness.yandex.behaviour = { mode: 'in_progress', settleAfterPolls: 2 };
    expect(await drive(created.id, 6)).toBe('REVERSED');

    const row = await harness.prisma.withdrawal.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.yandexReversalTransactionId).toBe('mock-tx-2');
    expect(harness.yandex.createdCount()).toBe(2);
    expect(harness.yandex.balanceOf(driver.yandexParkId, driver.contractorProfileId)?.minor).toBe(
      5_000_000n,
    );
  });

  it('a compensating credit is never abandoned: repeated rejection escalates', async () => {
    harness.provider.behaviour = { mode: 'reject', code: 'card_expired' };
    const created = await requestWithdrawal(harness, driver, 1_000_000n);
    // Six steps: risk check, reserve, submit, decline, begin compensation.
    await harness.orchestrator.advance(created.id, 6);
    expect(await stateOf(created.id)).toBe('COMPENSATING');

    harness.yandex.behaviour = { mode: 'reject' };
    expect(await drive(created.id, 8)).toBe('MANUAL_REVIEW');
    // The driver's money is still held; nothing pretended it was returned.
    expect(harness.yandex.balanceOf(driver.yandexParkId, driver.contractorProfileId)?.minor).toBe(
      4_000_000n,
    );
  });

  it('every token this system generates satisfies the 16–64 printable-ASCII rule', async () => {
    const created = await requestWithdrawal(harness, driver, 1_000_000n);
    const row = await harness.prisma.withdrawal.findUniqueOrThrow({ where: { id: created.id } });
    const pattern = /^[\x20-\x7E]{16,64}$/;
    expect(row.yandexIdempotencyToken).toMatch(pattern);
    expect(`${row.yandexIdempotencyToken}-rev`).toMatch(pattern);
  });
});
