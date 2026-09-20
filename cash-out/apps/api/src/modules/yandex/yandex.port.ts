import { Money } from '@cashout/money';

/**
 * What Cash Out needs from the Yandex Fleet API, expressed as a port.
 *
 * Two things about this interface are load-bearing:
 *
 * 1. **Every mutating call returns a many-valued outcome, never a boolean.**
 *    `APPLIED`, `PENDING`, `REJECTED` and `UNKNOWN`. A timeout is not a
 *    failure — the debit may well have landed — and any code that treats it as
 *    one will eventually debit a driver twice. `UNKNOWN` forces the caller into
 *    a state whose only exit is a probe. `PENDING` is the v3 API's own
 *    `in_progress`: the transaction exists and has an id, but its outcome does
 *    not yet.
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

  /**
   * A page of the park's contractor profiles, for roster synchronisation
   * (`POST /v1/parks/driver-profiles/list` with no filter). Classified
   * LIVE-UNVERIFIED in docs/YANDEX_INTEGRATION.md.
   */
  abstract listProfiles(
    parkId: string,
    page: { limit: number; offset: number },
  ): Promise<YandexProfilePage>;

  /** The driver's current park balance, as Yandex reports it right now. */
  abstract getBalance(parkId: string, contractorProfileId: string): Promise<YandexBalance>;

  /**
   * Posts the debit that funds a payout (Fleet API v3
   * `POST /v3/parks/driver-profiles/transactions`).
   *
   * `idempotencyToken` is sent as `X-Idempotency-Token` (16–64 printable ASCII
   * characters; see `assertIdempotencyToken`). `balanceMin`, when given, is
   * sent as `condition.balance_min`, so that Yandex itself refuses the debit
   * atomically when the balance is below it — our own re-read of the balance
   * before confirming stays as the second line of defence, not the only one.
   */
  abstract createDebit(input: YandexTransactionInput): Promise<YandexTransactionOutcome>;

  /** The compensating positive transaction, posted when a payout fails. */
  abstract createCredit(input: YandexTransactionInput): Promise<YandexTransactionOutcome>;

  /**
   * The final outcome of a transaction we hold an id for
   * (`GET /v3/parks/driver-profiles/transactions/status`).
   */
  abstract getTransactionStatus(
    parkId: string,
    transactionId: string,
  ): Promise<YandexTransactionStatusOutcome>;

  /**
   * Evidence-gathering only: looks for a transaction by the reference embedded
   * in its description, for the case where a POST died before we received an
   * id. A hit is proof that the debit exists; a miss is *not* proof that it
   * does not, and no caller may treat it as one.
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

export interface YandexProfilePage {
  readonly items: readonly YandexContractorProfile[];
  /** Total in the park when the API reports it; null when it does not. */
  readonly total: number | null;
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
  /** `data.kind` — "payout" for the debit that funds a payout. */
  readonly kind: string;
  readonly description: string;
  readonly idempotencyToken: string;
  /**
   * `condition.balance_min`: Yandex applies the transaction only if the
   * contractor's balance is at least this. For a debit of `amount` this is
   * `amount` itself — the atomic guarantee that the balance never goes below
   * zero because of us.
   */
  readonly balanceMin?: Money;
}

export interface YandexTransaction {
  readonly id: string;
  readonly amount: Money;
  readonly description: string;
  readonly eventAt: Date;
}

export type YandexTransactionOutcome =
  /** Final and applied. */
  | {
      readonly status: 'APPLIED';
      readonly transaction: YandexTransaction;
      readonly balanceAfter: Money | null;
    }
  /** Accepted with an id, outcome not final (`in_progress`). */
  | { readonly status: 'PENDING'; readonly transactionId: string }
  /**
   * Definitively not applied. `code` is `condition_failed` when Yandex refused
   * because of `condition.balance_min`, `insufficient_funds` when it refused
   * because the balance is too low, otherwise the API's own code.
   */
  | { readonly status: 'REJECTED'; readonly code: string; readonly message: string }
  /** No definite answer: timeout, 429, 5xx, transport failure, unparseable 2xx. */
  | { readonly status: 'UNKNOWN'; readonly reason: string; readonly httpStatus?: number };

export type YandexTransactionStatusOutcome =
  | { readonly status: 'IN_PROGRESS' }
  | { readonly status: 'SUCCESS' }
  | { readonly status: 'FAIL'; readonly code: string | null; readonly message: string | null }
  | { readonly status: 'NOT_FOUND' }
  | { readonly status: 'UNKNOWN'; readonly reason: string; readonly httpStatus?: number };

export class YandexUnavailableError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'YandexUnavailableError';
  }
}

/** The Fleet API's constraint on `X-Idempotency-Token`: 16–64 printable ASCII. */
export const IDEMPOTENCY_TOKEN_PATTERN = /^[\x20-\x7E]{16,64}$/;

export class InvalidIdempotencyTokenError extends Error {
  constructor(token: string) {
    super(
      `Idempotency token must be 16–64 printable ASCII characters (got ${token.length} characters)`,
    );
    this.name = 'InvalidIdempotencyTokenError';
  }
}

/**
 * Refuses a token the API would refuse, *before* the request is made. A
 * request rejected for a malformed token is a request whose token can never
 * be replayed, which turns every later retry into a fresh transaction.
 */
export function assertIdempotencyToken(token: string): void {
  if (!IDEMPOTENCY_TOKEN_PATTERN.test(token)) {
    throw new InvalidIdempotencyTokenError(token);
  }
}
