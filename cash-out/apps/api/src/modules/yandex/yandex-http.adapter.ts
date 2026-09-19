import { Inject, Injectable } from '@nestjs/common';
import { Money } from '@cashout/money';
import type { CurrencyCode } from '@cashout/money';
import { ENV, Env } from '../../config/env';
import { AppLogger } from '../../common/logging/logger.service';
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
  YandexUnavailableError,
} from './yandex.port';

/**
 * The live Fleet API adapter, against API v3.
 *
 * ## Provenance — read before trusting it
 *
 * The official reference could not be fetched from the environment this was
 * written in (`yandex.ru`, `yandex.com` and `fleet.taxi.yandex.ru` are all
 * blocked by its egress policy). The v3 contract encoded here — the two
 * endpoint paths, the request fields `park_id`, `contractor_profile_id`,
 * `amount`, `description`, `version`, `condition.balance_min`, `data.kind`,
 * the status values `in_progress` / `success` / `fail`, and the 16–64
 * printable-ASCII rule for `X-Idempotency-Token` — was relayed from the
 * official documentation by the owner's independent reviewer. It was not read
 * from the page by the author of this file.
 *
 * `docs/YANDEX_INTEGRATION.md` classifies every element as CONFIRMED,
 * LIVE-UNVERIFIED or UNKNOWN. The response field names below are UNKNOWN, so
 * every response is parsed defensively: a 2xx whose body does not carry a
 * transaction id is reported as `UNKNOWN`, never as success and never as
 * failure, and the orchestrator probes rather than guesses.
 *
 * This adapter must be replayed against a sandbox park before
 * `YANDEX_MODE=live` is allowed anywhere.
 */
@Injectable()
export class YandexHttpAdapter extends YandexFleetPort {
  private lastCallAt = new Map<string, number>();

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly logger: AppLogger,
    private readonly clock: Clock,
  ) {
    super();
  }

  // ------------------------------------------------------------- profiles

  async findProfilesByPhone(parkId: string, phone: string): Promise<YandexContractorProfile[]> {
    const response = await this.call<DriverProfilesListResponse>(
      parkId,
      'POST',
      '/v1/parks/driver-profiles/list',
      {
        limit: 50,
        offset: 0,
        query: { park: { id: parkId, driver_profile: { phone: [phone] } } },
        fields: {
          driver_profile: ['id', 'first_name', 'last_name', 'phones', 'license', 'work_rule_id'],
          account: ['id', 'balance', 'currency', 'balance_limit'],
        },
      },
    );
    return (response.body.driver_profiles ?? []).map((item) => this.toProfile(parkId, item));
  }

  async getProfile(
    parkId: string,
    contractorProfileId: string,
  ): Promise<YandexContractorProfile | null> {
    const response = await this.call<DriverProfilesListResponse>(
      parkId,
      'POST',
      '/v1/parks/driver-profiles/list',
      {
        limit: 1,
        offset: 0,
        query: { park: { id: parkId, driver_profile: { id: [contractorProfileId] } } },
        fields: {
          driver_profile: ['id', 'first_name', 'last_name', 'phones', 'license', 'work_rule_id'],
          account: ['id', 'balance', 'currency', 'balance_limit'],
        },
      },
    );
    const first = response.body.driver_profiles?.[0];
    return first ? this.toProfile(parkId, first) : null;
  }

  async getBalance(parkId: string, contractorProfileId: string): Promise<YandexBalance> {
    const profile = await this.getProfile(parkId, contractorProfileId);
    if (!profile?.balance) {
      throw new YandexUnavailableError(
        `Yandex returned no account balance for contractor ${contractorProfileId}`,
      );
    }
    return profile.balance;
  }

  // ---------------------------------------------------------- transactions

  async createDebit(input: YandexTransactionInput): Promise<YandexTransactionOutcome> {
    return this.createTransaction(input, input.amount.abs().negated());
  }

  async createCredit(input: YandexTransactionInput): Promise<YandexTransactionOutcome> {
    return this.createTransaction(input, input.amount.abs());
  }

  /**
   * `POST /v3/parks/driver-profiles/transactions`.
   *
   * The amount is signed (negative for a debit). Whether v3 expects the sign
   * on `amount` or derives direction from `data.kind` is one of the things the
   * sandbox run must settle; it is listed as LIVE-UNVERIFIED.
   */
  private async createTransaction(
    input: YandexTransactionInput,
    signedAmount: Money,
  ): Promise<YandexTransactionOutcome> {
    assertIdempotencyToken(input.idempotencyToken);

    const body: Record<string, unknown> = {
      park_id: input.parkId,
      contractor_profile_id: input.contractorProfileId,
      amount: signedAmount.toDecimalString(),
      description: input.description,
      version: this.env.YANDEX_TRANSACTION_VERSION,
      data: { kind: input.kind },
    };
    if (input.balanceMin) {
      body.condition = { balance_min: input.balanceMin.toDecimalString() };
    }

    let response: CallResult<CreateTransactionResponse>;
    try {
      response = await this.call<CreateTransactionResponse>(
        input.parkId,
        'POST',
        '/v3/parks/driver-profiles/transactions',
        body,
        input.idempotencyToken,
      );
    } catch (error) {
      return this.transactionFailure(error, input);
    }

    const id = extractTransactionId(response.body);
    if (!id) {
      // A 2xx we cannot read may well have created the transaction. Saying
      // "failed" here is how a driver gets debited twice.
      this.logger.warning('Yandex v3 returned a 2xx without a recognisable transaction id', {
        parkId: input.parkId,
        idempotencyToken: input.idempotencyToken,
        httpStatus: response.status,
      });
      return {
        status: 'UNKNOWN',
        reason: 'unparseable_success_response',
        httpStatus: response.status,
      };
    }

    const status = normaliseStatus(response.body.status);
    if (status === 'FAIL') {
      return {
        status: 'REJECTED',
        code: response.body.error_code ?? response.body.code ?? 'fail',
        message: response.body.message ?? 'Yandex reported the transaction as failed',
      };
    }
    if (status === 'IN_PROGRESS' || status === null) {
      // No final status in the response: let the status endpoint decide,
      // rather than assuming a 2xx means applied.
      return { status: 'PENDING', transactionId: id };
    }

    return {
      status: 'APPLIED',
      transaction: {
        id,
        amount: signedAmount,
        description: input.description,
        eventAt: parseDate(response.body.event_at ?? response.body.created_at) ?? this.clock.now(),
      },
      balanceAfter: parseAmount(response.body.balance_after, input.amount.currency),
    };
  }

  private transactionFailure(
    error: unknown,
    input: YandexTransactionInput,
  ): YandexTransactionOutcome {
    if (error instanceof YandexHttpError) {
      if (error.status === 429 || error.status === 408 || error.status >= 500) {
        return { status: 'UNKNOWN', reason: `http_${error.status}`, httpStatus: error.status };
      }
      if (error.status >= 400 && error.status < 500) {
        return {
          status: 'REJECTED',
          code: classifyRejection(error.code, error.message),
          message: error.message,
        };
      }
    }
    this.logger.fail('Yandex v3 transaction transport failure', error, {
      parkId: input.parkId,
      idempotencyToken: input.idempotencyToken,
    });
    return { status: 'UNKNOWN', reason: error instanceof Error ? error.name : 'transport_error' };
  }

  /** `GET /v3/parks/driver-profiles/transactions/status`. */
  async getTransactionStatus(
    parkId: string,
    transactionId: string,
  ): Promise<YandexTransactionStatusOutcome> {
    let response: CallResult<TransactionStatusResponse>;
    try {
      response = await this.call<TransactionStatusResponse>(
        parkId,
        'GET',
        `/v3/parks/driver-profiles/transactions/status?id=${encodeURIComponent(transactionId)}`,
      );
    } catch (error) {
      if (error instanceof YandexHttpError) {
        if (error.status === 404) return { status: 'NOT_FOUND' };
        return { status: 'UNKNOWN', reason: `http_${error.status}`, httpStatus: error.status };
      }
      return { status: 'UNKNOWN', reason: error instanceof Error ? error.name : 'transport_error' };
    }

    const status = normaliseStatus(response.body.status);
    switch (status) {
      case 'SUCCESS':
        return { status: 'SUCCESS' };
      case 'IN_PROGRESS':
        return { status: 'IN_PROGRESS' };
      case 'FAIL':
        return {
          status: 'FAIL',
          code: response.body.error_code ?? response.body.code ?? null,
          message: response.body.message ?? null,
        };
      default:
        return { status: 'UNKNOWN', reason: 'unrecognised_status_value' };
    }
  }

  async findTransaction(
    parkId: string,
    contractorProfileId: string,
    reference: string,
    since: Date,
  ): Promise<YandexTransaction | null> {
    const response = await this.call<TransactionsListResponse>(
      parkId,
      'POST',
      '/v2/parks/driver-profiles/transactions/list',
      {
        limit: 200,
        query: {
          park: {
            id: parkId,
            driver_profile: { id: contractorProfileId },
            transaction: {
              event_at: { from: since.toISOString(), to: this.clock.now().toISOString() },
            },
          },
        },
      },
    );
    const match = (response.body.transactions ?? []).find((item) =>
      (item.description ?? '').includes(reference),
    );
    if (!match) return null;
    const currency = (match.currency_code ?? 'AMD') as CurrencyCode;
    return {
      id: String(match.id),
      amount: parseAmount(match.amount, currency) ?? Money.zero(currency),
      description: match.description ?? '',
      eventAt: parseDate(match.event_at) ?? this.clock.now(),
    };
  }

  async ping(parkId: string): Promise<boolean> {
    try {
      await this.call(parkId, 'POST', '/v1/parks/driver-profiles/list', {
        limit: 1,
        offset: 0,
        query: { park: { id: parkId } },
      });
      return true;
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------------ plumbing

  private async call<T>(
    parkId: string,
    method: 'POST' | 'GET',
    path: string,
    body?: unknown,
    idempotencyToken?: string,
  ): Promise<CallResult<T>> {
    await this.throttle(parkId);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.env.YANDEX_TIMEOUT_MS);

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Client-ID': this.env.YANDEX_CLIENT_ID ?? '',
      'X-API-Key': this.env.YANDEX_API_KEY ?? '',
      'X-Park-ID': parkId,
      'Accept-Language': 'en',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (idempotencyToken) headers['X-Idempotency-Token'] = idempotencyToken;

    try {
      const response = await fetch(`${this.env.YANDEX_BASE_URL}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new YandexHttpError(response.status, safeErrorCode(text), text.slice(0, 500));
      }
      return { status: response.status, body: (text ? JSON.parse(text) : {}) as T };
    } catch (error) {
      if (error instanceof YandexHttpError) throw error;
      throw new YandexUnavailableError('Yandex Fleet API transport failure', error);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Yandex throttles per park; the exact budget is not documented in what we
   * have. A conservative minimum gap between calls for one park, rather than
   * discovering the real limit by being rate-limited in production.
   */
  private async throttle(parkId: string): Promise<void> {
    const minInterval = this.env.YANDEX_MIN_INTERVAL_MS;
    if (minInterval <= 0) return;
    const last = this.lastCallAt.get(parkId) ?? 0;
    const wait = last + minInterval - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastCallAt.set(parkId, Date.now());
  }

  private toProfile(parkId: string, raw: DriverProfileItem): YandexContractorProfile {
    const profile = raw.driver_profile ?? {};
    const account =
      (raw.accounts ?? []).find((item) => item.type === 'current') ?? raw.accounts?.[0];
    const currency = (account?.currency ?? 'AMD') as CurrencyCode;
    const balanceAmount = parseAmount(account?.balance, currency);
    return {
      id: String(profile.id ?? ''),
      parkId,
      firstName: profile.first_name ?? null,
      lastName: profile.last_name ?? null,
      phones: profile.phones ?? [],
      licenceNumber: profile.license?.number ?? null,
      workRuleId: profile.work_rule_id ?? null,
      balance: balanceAmount
        ? { amount: balanceAmount, accountId: account?.id ?? null, fetchedAt: this.clock.now() }
        : null,
      blocked: profile.work_status === 'fired' || profile.work_status === 'not_working',
    };
  }
}

export class YandexHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'YandexHttpError';
  }
}

interface CallResult<T> {
  readonly status: number;
  readonly body: T;
}

/**
 * Maps a 4xx rejection onto the two codes the orchestrator cares about. The
 * exact error codes v3 uses for a failed `condition` and for an insufficient
 * balance are UNKNOWN; this matches on the words the codes are overwhelmingly
 * likely to contain, and otherwise passes the API's code through.
 */
export function classifyRejection(code: string, message: string): string {
  const haystack = `${code} ${message}`.toLowerCase();
  if (/condition|balance_min|min_balance/.test(haystack)) return 'condition_failed';
  if (/insufficient|not_enough|not enough|no_money/.test(haystack)) return 'insufficient_funds';
  return code || 'rejected';
}

export function normaliseStatus(
  raw: unknown,
): 'IN_PROGRESS' | 'SUCCESS' | 'FAIL' | null | 'UNRECOGNISED' {
  if (raw === undefined || raw === null) return null;
  const value = String(raw).toLowerCase();
  if (value === 'in_progress' || value === 'pending' || value === 'processing')
    return 'IN_PROGRESS';
  if (value === 'success' || value === 'succeeded' || value === 'ok') return 'SUCCESS';
  if (value === 'fail' || value === 'failed' || value === 'error') return 'FAIL';
  return 'UNRECOGNISED';
}

export function extractTransactionId(body: CreateTransactionResponse): string | null {
  const id = body.id ?? body.transaction_id ?? body.transaction?.id;
  return id === undefined || id === null || id === '' ? null : String(id);
}

/**
 * Yandex reports balances as decimal strings, sometimes with more precision
 * than the currency's minor unit. Truncating towards zero is the only safe
 * direction for a balance we are about to pay out against: it can make us
 * withhold a fraction of a dram, never overpay one.
 */
function parseAmount(raw: unknown, currency: string): Money | null {
  if (raw === null || raw === undefined) return null;
  try {
    return Money.fromDecimalString(String(raw), currency as CurrencyCode, 'TRUNCATE');
  } catch {
    return null;
  }
}

function parseDate(raw: unknown): Date | null {
  if (typeof raw !== 'string') return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function safeErrorCode(body: string): string {
  try {
    const parsed = JSON.parse(body) as { code?: string; error?: { code?: string } };
    return parsed.code ?? parsed.error?.code ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

// --- Response shapes. Field names are UNKNOWN until verified on a sandbox park. ---

interface DriverProfilesListResponse {
  driver_profiles?: DriverProfileItem[];
}

interface DriverProfileItem {
  driver_profile?: {
    id?: string;
    first_name?: string;
    last_name?: string;
    phones?: string[];
    license?: { number?: string };
    work_rule_id?: string;
    work_status?: string;
  };
  accounts?: Array<{ id?: string; type?: string; balance?: string; currency?: string }>;
}

export interface CreateTransactionResponse {
  id?: string | number;
  transaction_id?: string | number;
  transaction?: { id?: string | number };
  status?: string;
  code?: string;
  error_code?: string;
  message?: string;
  event_at?: string;
  created_at?: string;
  balance_after?: string;
}

interface TransactionStatusResponse {
  status?: string;
  code?: string;
  error_code?: string;
  message?: string;
}

interface TransactionsListResponse {
  transactions?: Array<{
    id?: string | number;
    amount?: string;
    currency_code?: string;
    description?: string;
    event_at?: string;
  }>;
}
