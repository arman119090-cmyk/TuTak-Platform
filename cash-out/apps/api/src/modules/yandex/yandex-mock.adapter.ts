import { Injectable } from '@nestjs/common';
import { Money } from '@cashout/money';
import type { CurrencyCode } from '@cashout/money';
import { Clock } from '../../common/clock';
import {
  YandexBalance,
  YandexContractorProfile,
  YandexFleetPort,
  YandexTransaction,
  YandexTransactionInput,
  YandexTransactionOutcome,
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

/**
 * An in-memory Yandex.
 *
 * This is a **fake, not an integration**. It does not talk to Yandex, it does
 * not move a real balance, and nothing it returns is evidence that the live
 * adapter works. It exists so the rest of the product can be built and — more
 * importantly — so the failure modes that matter can be tested on demand:
 * timeouts, duplicate submissions, a debit that "succeeds" after we gave up
 * waiting for it.
 *
 * `YANDEX_MODE=mock` is rejected by the config validator when `NODE_ENV=production`.
 */
@Injectable()
export class YandexMockAdapter extends YandexFleetPort {
  private readonly drivers = new Map<string, MutableDriver>();
  private readonly transactions = new Map<string, YandexTransaction[]>();
  /** idempotency token -> the transaction it produced. */
  private readonly byToken = new Map<string, YandexTransaction>();

  /** Test hooks. Production code never sets these; only specs and the seeder do. */
  behaviour: MockBehaviour = { mode: 'normal' };
  callLog: Array<{ method: string; token?: string }> = [];

  constructor(private readonly clock: Clock) {
    super();
  }

  seed(driver: MockDriverSeed): void {
    this.drivers.set(key(driver.parkId, driver.contractorProfileId), {
      ...driver,
      blocked: driver.blocked ?? false,
      balance: driver.balance,
    });
  }

  reset(): void {
    this.drivers.clear();
    this.transactions.clear();
    this.byToken.clear();
    this.behaviour = { mode: 'normal' };
    this.callLog = [];
  }

  balanceOf(parkId: string, contractorProfileId: string): Money | null {
    return this.drivers.get(key(parkId, contractorProfileId))?.balance ?? null;
  }

  transactionCount(parkId: string, contractorProfileId: string): number {
    return (this.transactions.get(key(parkId, contractorProfileId)) ?? []).length;
  }

  async findProfilesByPhone(parkId: string, phone: string): Promise<YandexContractorProfile[]> {
    this.callLog.push({ method: 'findProfilesByPhone' });
    return [...this.drivers.values()]
      .filter((driver) => driver.parkId === parkId && driver.phone === phone)
      .map((driver) => this.toProfile(driver));
  }

  async getProfile(
    parkId: string,
    contractorProfileId: string,
  ): Promise<YandexContractorProfile | null> {
    this.callLog.push({ method: 'getProfile' });
    const driver = this.drivers.get(key(parkId, contractorProfileId));
    return driver ? this.toProfile(driver) : null;
  }

  async getBalance(parkId: string, contractorProfileId: string): Promise<YandexBalance> {
    this.callLog.push({ method: 'getBalance' });
    if (this.behaviour.mode === 'unavailable') {
      throw new Error('mock Yandex is unavailable');
    }
    const driver = this.drivers.get(key(parkId, contractorProfileId));
    if (!driver) {
      throw new Error(`mock Yandex has no driver ${contractorProfileId} in park ${parkId}`);
    }
    return { amount: driver.balance, accountId: 'acc-mock', fetchedAt: this.clock.now() };
  }

  async createDebit(input: YandexTransactionInput): Promise<YandexTransactionOutcome> {
    return this.apply(input, 'debit');
  }

  async createCredit(input: YandexTransactionInput): Promise<YandexTransactionOutcome> {
    return this.apply(input, 'credit');
  }

  private async apply(
    input: YandexTransactionInput,
    kind: 'debit' | 'credit',
  ): Promise<YandexTransactionOutcome> {
    this.callLog.push({ method: kind, token: input.idempotencyToken });

    // Idempotency first: a retried token returns the original transaction,
    // exactly as the real API is documented to.
    const existing = this.byToken.get(input.idempotencyToken);
    if (existing) {
      const driver = this.drivers.get(key(input.parkId, input.contractorProfileId));
      return { status: 'APPLIED', transaction: existing, balanceAfter: driver?.balance ?? null };
    }

    switch (this.behaviour.mode) {
      case 'reject':
        return { status: 'REJECTED', code: 'mock_rejected', message: 'mock rejection' };
      case 'timeout':
        return { status: 'UNKNOWN', reason: 'mock_timeout' };
      case 'applied_but_timeout': {
        // The nastiest real-world case: it worked, we never found out.
        this.commit(input, kind);
        return { status: 'UNKNOWN', reason: 'mock_applied_but_timeout' };
      }
      case 'unavailable':
        return { status: 'UNKNOWN', reason: 'mock_unavailable' };
      case 'normal':
      default:
        break;
    }

    const driver = this.drivers.get(key(input.parkId, input.contractorProfileId));
    if (!driver) {
      return { status: 'REJECTED', code: 'driver_not_found', message: 'no such contractor' };
    }
    if (driver.blocked) {
      return { status: 'REJECTED', code: 'driver_blocked', message: 'contractor is blocked' };
    }
    if (kind === 'debit' && driver.balance.lessThan(input.amount)) {
      return { status: 'REJECTED', code: 'insufficient_funds', message: 'balance too low' };
    }

    const transaction = this.commit(input, kind);
    return { status: 'APPLIED', transaction, balanceAfter: driver.balance };
  }

  private commit(input: YandexTransactionInput, kind: 'debit' | 'credit'): YandexTransaction {
    const driver = this.drivers.get(key(input.parkId, input.contractorProfileId));
    const signed = kind === 'debit' ? input.amount.negated() : input.amount.abs();
    if (driver) {
      driver.balance = driver.balance.add(signed);
    }
    const transaction: YandexTransaction = {
      id: `mock-tx-${this.byToken.size + 1}`,
      amount: signed,
      description: input.description,
      eventAt: this.clock.now(),
      categoryId: input.categoryId,
    };
    const bucket = this.transactions.get(key(input.parkId, input.contractorProfileId)) ?? [];
    bucket.push(transaction);
    this.transactions.set(key(input.parkId, input.contractorProfileId), bucket);
    this.byToken.set(input.idempotencyToken, transaction);
    return transaction;
  }

  async findTransaction(
    parkId: string,
    contractorProfileId: string,
    reference: string,
  ): Promise<YandexTransaction | null> {
    this.callLog.push({ method: 'findTransaction' });
    if (this.behaviour.mode === 'unavailable') {
      throw new Error('mock Yandex is unavailable');
    }
    const bucket = this.transactions.get(key(parkId, contractorProfileId)) ?? [];
    return bucket.find((item) => item.description.includes(reference)) ?? null;
  }

  async ping(): Promise<boolean> {
    return this.behaviour.mode !== 'unavailable';
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

export interface MockBehaviour {
  mode: 'normal' | 'reject' | 'timeout' | 'applied_but_timeout' | 'unavailable';
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
