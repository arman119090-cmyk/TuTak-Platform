import { Money } from '@cashout/money';

/**
 * What Cash Out needs from the Yandex Fleet API, expressed as a port.
 *
 * Two things about this interface are load-bearing:
 *
 * 1. **Every mutating call returns a three-valued outcome.** `APPLIED`,
 *    `REJECTED` and `UNKNOWN`. A timeout is not a failure — the debit may well
 *    have landed — and any code that treats it as one will eventually debit a
 *    driver twice. `UNKNOWN` forces the caller into a state whose only exit is
 *    a probe.
 *
 * 2. **There is no "payout" method.** The Fleet API moves a number inside the
 *    park's own accounting; it does not send money to a driver's bank. That is
 *    a separate system behind `PaymentProviderPort`. Conflating the two is the
 *    single most expensive mistake available in this product.
 */
export abstract class YandexFleetPort {
  /** Candidate contractor profiles matching a phone number inside one park. */
  abstract findProfilesByPhone(parkId: string, phone: string): Promise<YandexContractorProfile[]>;

  abstract getProfile(
    parkId: string,
    contractorProfileId: string,
  ): Promise<YandexContractorProfile | null>;

  /** The driver's current park balance, as Yandex reports it right now. */
  abstract getBalance(parkId: string, contractorProfileId: string): Promise<YandexBalance>;

  /**
   * Posts a negative transaction against the driver's park account: the debit
   * that funds a payout.
   *
   * `idempotencyToken` is sent as `X-Idempotency-Token`. Calling twice with the
   * same token must not produce two transactions.
   */
  abstract createDebit(input: YandexTransactionInput): Promise<YandexTransactionOutcome>;

  /** The compensating positive transaction, posted when a payout fails. */
  abstract createCredit(input: YandexTransactionInput): Promise<YandexTransactionOutcome>;

  /**
   * Looks for a transaction we may or may not have created, so that an
   * `UNKNOWN` outcome can be resolved without guessing.
   */
  abstract findTransaction(
    parkId: string,
    contractorProfileId: string,
    reference: string,
    since: Date,
  ): Promise<YandexTransaction | null>;

  /** Cheap call used by the health check and the admin integration tile. */
  abstract ping(parkId: string): Promise<boolean>;
}

export interface YandexContractorProfile {
  readonly id: string;
  readonly parkId: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly phones: readonly string[];
  readonly licenceNumber: string | null;
  readonly workRuleId: string | null;
  readonly balance: YandexBalance | null;
  readonly blocked: boolean;
}

export interface YandexBalance {
  readonly amount: Money;
  readonly accountId: string | null;
  readonly fetchedAt: Date;
}

export interface YandexTransactionInput {
  readonly parkId: string;
  readonly contractorProfileId: string;
  /** Always a magnitude; `createDebit` applies the sign. */
  readonly amount: Money;
  readonly categoryId: string;
  readonly description: string;
  readonly idempotencyToken: string;
}

export interface YandexTransaction {
  readonly id: string;
  readonly amount: Money;
  readonly description: string;
  readonly eventAt: Date;
  readonly categoryId: string | null;
}

export type YandexTransactionOutcome =
  | {
      readonly status: 'APPLIED';
      readonly transaction: YandexTransaction;
      readonly balanceAfter: Money | null;
    }
  | { readonly status: 'REJECTED'; readonly code: string; readonly message: string }
  | { readonly status: 'UNKNOWN'; readonly reason: string };

export class YandexUnavailableError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'YandexUnavailableError';
  }
}
