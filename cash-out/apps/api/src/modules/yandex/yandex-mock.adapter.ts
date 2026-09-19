import { Injectable } from '@nestjs/common';
import { Money } from '@cashout/money';
import type { CurrencyCode } from '@cashout/money';
import { Clock } from '../../common/clock';
import {
  assertIdempotencyToken,
  YandexBalance,
  YandexContractorProfile,
  YandexFleetPort,
  YandexTransaction,
  YandexTransactionInput,
  YandexTransactionOutcome,
  YandexTransactionStatusOutcome,
} from './yandex.port';

export interface MockDriverSeed {
  readonly parkId: string;
  readonly contractorProfileId: string;
  readonly phone: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly licenceNumber: string;
  readonly balance: Money;
  readonly blocked?: boolean;
}

export interface MockBehaviour {
  mode:
    | 'normal'
    /** POST is rejected outright. */
    | 'reject'
    /** POST returns no answer and nothing was applied. */
    | 'timeout'
    /** POST returns no answer but the transaction *was* created and applied. */
    | 'applied_but_timeout'
    /** POST returns no answer; the transaction was created as in_progress. */
    | 'pending_but_timeout'
    /** POST returns in_progress; the status endpoint reports in_progress until settled. */
    | 'in_progress'
    /** POST returns in_progress; the status endpoint reports `fail` once asked. */
    | 'in_progress_then_fail'
    /** Every call fails at the transport level. */
    | 'unavailable'
    /** POSTs work; the status endpoint alone is down. */
    | 'status_unavailable';
  /** For `in_progress`: how many status polls before the transaction settles. */
  settleAfterPolls?: number;
}

interface MockTransactionRecord {
  transaction: YandexTransaction;
  parkId: string;
  contractorProfileId: string;
  signed: Money;
  state: 'in_progress' | 'success' | 'fail';
  polls: number;
  token: string;
}

/**
 * An in-memory Yandex Fleet API v3.
 *
 * This is a **fake, not an integration**. It does not talk to Yandex, it does
 * not move a real balance, and nothing it returns is evidence that the live
 * adapter works. It exists so the failure modes that matter can be produced on
 * demand: a debit that lands after we gave up waiting, one that stays
 * `in_progress`, one that the status endpoint later reports as `fail`, a
 * `condition.balance_min` that no longer holds, and a status endpoint that is
 * itself down.
 *
 * Two behaviours are modelled the way the v3 contract describes them and are
 * the reason the orchestrator can be tested at all:
 *
 *  - **`X-Idempotency-Token` deduplicates.** A second POST with a token that
 *    was already used returns the original transaction, whatever its state,
 *    and does not re-evaluate the condition.
 *  - **`condition.balance_min` is atomic.** The debit is applied only if the
 *    balance at the moment of the POST is at least `balance_min`; otherwise it
 *    is rejected with `condition_failed` and nothing changes.
 *
 * `YANDEX_MODE=mock` is rejected by the config validator in production.
 */
@Injectable()
export class YandexMockAdapter extends YandexFleetPort {
  private readonly drivers = new Map<string, MutableDriver>();
  private readonly byId = new Map<string, MockTransactionRecord>();
  private readonly byToken = new Map<string, MockTransactionRecord>();
  private sequence = 0;

  behaviour: MockBehaviour = { mode: 'normal' };
  callLog: Array<{ method: string; token?: string; id?: string }> = [];

  constructor(private readonly clock: Clock) {
    super();
  }

  // ------------------------------------------------------------ test hooks

  seed(driver: MockDriverSeed): void {
    this.drivers.set(key(driver.parkId, driver.contractorProfileId), {
      ...driver,
      blocked: driver.blocked ?? false,
      balance: driver.balance,
    });
  }

  reset(): void {
    this.drivers.clear();
    this.byId.clear();
    this.byToken.clear();
    this.sequence = 0;
    this.behaviour = { mode: 'normal' };
    this.callLog = [];
  }

  balanceOf(parkId: string, contractorProfileId: string): Money | null {
    return this.drivers.get(key(parkId, contractorProfileId))?.balance ?? null;
  }

  /** Changes a driver's balance out from under us, as a park would. */
  setBalance(parkId: string, contractorProfileId: string, balance: Money): void {
    const driver = this.drivers.get(key(parkId, contractorProfileId));
    if (driver) driver.balance = balance;
  }

  /** Applied transactions only — what a park's own history would show. */
  transactionCount(parkId: string, contractorProfileId: string): number {
    return [...this.byId.values()].filter(
      (record) =>
        record.parkId === parkId &&
        record.contractorProfileId === contractorProfileId &&
        record.state === 'success',
    ).length;
  }

  /** Every POST that created a transaction record, whatever its state. */
  createdCount(): number {
    return this.byId.size;
  }

  /** Test hook: settle an in_progress transaction. */
  settle(transactionId: string, outcome: 'success' | 'fail' = 'success'): void {
    const record = this.byId.get(transactionId);
    if (!record || record.state !== 'in_progress') return;
    record.state = outcome;
    if (outcome === 'success') this.apply(record);
  }

  transactionIdForToken(token: string): string | undefined {
    return this.byToken.get(token)?.transaction.id;
  }

  // -------------------------------------------------------------- profiles

  async findProfilesByPhone(parkId: string, phone: string): Promise<YandexContractorProfile[]> {
    this.callLog.push({ method: 'findProfilesByPhone' });
    this.assertUp();
    return [...this.drivers.values()]
      .filter((driver) => driver.parkId === parkId && driver.phone === phone)
      .map((driver) => this.toProfile(driver));
  }

  async getProfile(
    parkId: string,
    contractorProfileId: string,
  ): Promise<YandexContractorProfile | null> {
    this.callLog.push({ method: 'getProfile' });
    this.assertUp();
    const driver = this.drivers.get(key(parkId, contractorProfileId));
    return driver ? this.toProfile(driver) : null;
  }

  async getBalance(parkId: string, contractorProfileId: string): Promise<YandexBalance> {
    this.callLog.push({ method: 'getBalance' });
    this.assertUp();
    const driver = this.drivers.get(key(parkId, contractorProfileId));
    if (!driver) {
      throw new Error(`mock Yandex has no driver ${contractorProfileId} in park ${parkId}`);
    }
    return { amount: driver.balance, accountId: 'acc-mock', fetchedAt: this.clock.now() };
  }

  // ---------------------------------------------------------- transactions

  async createDebit(input: YandexTransactionInput): Promise<YandexTransactionOutcome> {
    return this.post(input, input.amount.abs().negated());
  }

  async createCredit(input: YandexTransactionInput): Promise<YandexTransactionOutcome> {
    return this.post(input, input.amount.abs());
  }

  private async post(
    input: YandexTransactionInput,
    signed: Money,
  ): Promise<YandexTransactionOutcome> {
    this.callLog.push({
      method: signed.isNegative ? 'debit' : 'credit',
      token: input.idempotencyToken,
    });
    assertIdempotencyToken(input.idempotencyToken);

    if (this.behaviour.mode === 'unavailable') {
      return { status: 'UNKNOWN', reason: 'mock_unavailable' };
    }

    // Idempotency first, and before any condition: a replayed token returns
    // the original transaction as it stands, exactly as the contract says.
    const existing = this.byToken.get(input.idempotencyToken);
    if (existing) return this.outcomeFor(existing);

    switch (this.behaviour.mode) {
      case 'reject':
        return { status: 'REJECTED', code: 'mock_rejected', message: 'mock rejection' };
      case 'timeout':
        return { status: 'UNKNOWN', reason: 'mock_timeout' };
      default:
        break;
    }

    const driver = this.drivers.get(key(input.parkId, input.contractorProfileId));
    if (!driver) {
      return { status: 'REJECTED', code: 'contractor_not_found', message: 'no such contractor' };
    }
    if (driver.blocked) {
      return { status: 'REJECTED', code: 'contractor_blocked', message: 'contractor is blocked' };
    }
    if (input.balanceMin && driver.balance.lessThan(input.balanceMin)) {
      return {
        status: 'REJECTED',
        code: 'condition_failed',
        message: `balance ${driver.balance.toDecimalString()} is below balance_min ${input.balanceMin.toDecimalString()}`,
      };
    }
    if (signed.isNegative && driver.balance.lessThan(signed.abs())) {
      return { status: 'REJECTED', code: 'insufficient_funds', message: 'balance too low' };
    }

    const record = this.record(input, signed);

    switch (this.behaviour.mode) {
      case 'applied_but_timeout':
        record.state = 'success';
        this.apply(record);
        return { status: 'UNKNOWN', reason: 'mock_applied_but_timeout' };
      case 'pending_but_timeout':
        return { status: 'UNKNOWN', reason: 'mock_pending_but_timeout' };
      case 'in_progress':
      case 'in_progress_then_fail':
        return { status: 'PENDING', transactionId: record.transaction.id };
      case 'status_unavailable':
      case 'normal':
      default:
        record.state = 'success';
        this.apply(record);
        return this.outcomeFor(record);
    }
  }

  async getTransactionStatus(
    parkId: string,
    transactionId: string,
  ): Promise<YandexTransactionStatusOutcome> {
    this.callLog.push({ method: 'status', id: transactionId });
    if (this.behaviour.mode === 'unavailable' || this.behaviour.mode === 'status_unavailable') {
      return { status: 'UNKNOWN', reason: 'mock_status_unavailable' };
    }
    const record = this.byId.get(transactionId);
    if (!record || record.parkId !== parkId) return { status: 'NOT_FOUND' };

    if (record.state === 'in_progress') {
      record.polls += 1;
      if (this.behaviour.mode === 'in_progress_then_fail') {
        record.state = 'fail';
      } else if (record.polls >= (this.behaviour.settleAfterPolls ?? Number.POSITIVE_INFINITY)) {
        record.state = 'success';
        this.apply(record);
      }
    }

    switch (record.state) {
      case 'success':
        return { status: 'SUCCESS' };
      case 'fail':
        return { status: 'FAIL', code: 'mock_failed', message: 'mock transaction failed' };
      default:
        return { status: 'IN_PROGRESS' };
    }
  }

  async findTransaction(
    parkId: string,
    contractorProfileId: string,
    reference: string,
  ): Promise<YandexTransaction | null> {
    this.callLog.push({ method: 'findTransaction' });
    this.assertUp();
    const hit = [...this.byId.values()].find(
      (record) =>
        record.parkId === parkId &&
        record.contractorProfileId === contractorProfileId &&
        record.state === 'success' &&
        record.transaction.description.includes(reference),
    );
    return hit?.transaction ?? null;
  }

  async ping(): Promise<boolean> {
    return this.behaviour.mode !== 'unavailable';
  }

  // ------------------------------------------------------------- internals

  private record(input: YandexTransactionInput, signed: Money): MockTransactionRecord {
    this.sequence += 1;
    const record: MockTransactionRecord = {
      transaction: {
        id: `mock-tx-${this.sequence}`,
        amount: signed,
        description: input.description,
        eventAt: this.clock.now(),
      },
      parkId: input.parkId,
      contractorProfileId: input.contractorProfileId,
      signed,
      state: 'in_progress',
      polls: 0,
      token: input.idempotencyToken,
    };
    this.byId.set(record.transaction.id, record);
    this.byToken.set(input.idempotencyToken, record);
    return record;
  }

  private apply(record: MockTransactionRecord): void {
    const driver = this.drivers.get(key(record.parkId, record.contractorProfileId));
    if (driver) driver.balance = driver.balance.add(record.signed);
  }

  private outcomeFor(record: MockTransactionRecord): YandexTransactionOutcome {
    switch (record.state) {
      case 'success': {
        const driver = this.drivers.get(key(record.parkId, record.contractorProfileId));
        return {
          status: 'APPLIED',
          transaction: record.transaction,
          balanceAfter: driver?.balance ?? null,
        };
      }
      case 'fail':
        return { status: 'REJECTED', code: 'mock_failed', message: 'mock transaction failed' };
      default:
        return { status: 'PENDING', transactionId: record.transaction.id };
    }
  }

  private assertUp(): void {
    if (this.behaviour.mode === 'unavailable') throw new Error('mock Yandex is unavailable');
  }

  private toProfile(driver: MutableDriver): YandexContractorProfile {
    return {
      id: driver.contractorProfileId,
      parkId: driver.parkId,
      firstName: driver.firstName,
      lastName: driver.lastName,
      phones: [driver.phone],
      licenceNumber: driver.licenceNumber,
      workRuleId: 'mock-work-rule',
      balance: { amount: driver.balance, accountId: 'acc-mock', fetchedAt: this.clock.now() },
      blocked: driver.blocked,
    };
  }
}

interface MutableDriver extends Omit<MockDriverSeed, 'balance' | 'blocked'> {
  balance: Money;
  blocked: boolean;
}

function key(parkId: string, contractorProfileId: string): string {
  return `${parkId}:${contractorProfileId}`;
}

export function mockMoney(minor: bigint, currency: CurrencyCode = 'AMD'): Money {
  return Money.fromMinor(minor, currency);
}
