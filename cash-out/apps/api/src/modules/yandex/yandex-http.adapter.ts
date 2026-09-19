import { Inject, Injectable } from '@nestjs/common';
import { Money } from '@cashout/money';
import type { CurrencyCode } from '@cashout/money';
import { ENV, Env } from '../../config/env';
import { AppLogger } from '../../common/logging/logger.service';
import { Clock } from '../../common/clock';
import {
  YandexBalance,
  YandexContractorProfile,
  YandexFleetPort,
  YandexTransaction,
  YandexTransactionInput,
  YandexTransactionOutcome,
  YandexUnavailableError,
} from './yandex.port';

/**
 * The live Fleet API adapter.
 *
 * ## Provenance of what is encoded here — read before trusting it
 *
 * The official reference (`fleet.taxi.yandex.ru/docs/api/reference`,
 * `yandex.ru/dev/fleet-api`) is not reachable from the environment this was
 * written in: the egress policy blocks the `yandex.ru` domain. The base URL,
 * the header names and the endpoint paths below are corroborated across two
 * independent open-source clients and the public search index of the official
 * reference pages, and they agree with each other:
 *
 *   * base URL `https://fleet-api.taxi.yandex.net`
 *   * `X-Client-ID`, `X-API-Key`, `X-Idempotency-Token`, `X-Park-ID`
 *   * `POST /v1/parks/driver-profiles/list`
 *   * `POST /v2/parks/driver-profiles/transactions`
 *   * `POST /v2/parks/driver-profiles/transactions/list`
 *
 * The *request and response field names* below are the ones those clients use,
 * but they have not been verified against a live park, and error codes, paging
 * semantics, rate limits and the exact balance precision are not knowable from
 * a third-party client at all.
 *
 * Therefore: every response is parsed defensively and a shape we do not
 * recognise is reported as `UNKNOWN` rather than assumed to be a failure, and
 * this adapter must be replayed against a real sandbox park before it is
 * allowed to run with `YANDEX_MODE=live`. `docs/YANDEX_INTEGRATION.md` lists
 * exactly what has to be confirmed.
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

  async findProfilesByPhone(parkId: string, phone: string): Promise<YandexContractorProfile[]> {
    const body = {
      limit: 50,
      offset: 0,
      query: { park: { id: parkId, driver_profile: { phone: [phone] } } },
      fields: {
        driver_profile: ['id', 'first_name', 'last_name', 'phones', 'license', 'work_rule_id'],
        account: ['id', 'balance', 'currency', 'balance_limit'],
      },
    };
    const response = await this.call<DriverProfilesListResponse>(
      parkId,
      'POST',
      '/v1/parks/driver-profiles/list',
      body,
    );
    return (response.driver_profiles ?? []).map((item) => this.toProfile(parkId, item));
  }

  async getProfile(
    parkId: string,
    contractorProfileId: string,
  ): Promise<YandexContractorProfile | null> {
    const body = {
      limit: 1,
      offset: 0,
      query: { park: { id: parkId, driver_profile: { id: [contractorProfileId] } } },
      fields: {
        driver_profile: ['id', 'first_name', 'last_name', 'phones', 'license', 'work_rule_id'],
        account: ['id', 'balance', 'currency', 'balance_limit'],
      },
    };
    const response = await this.call<DriverProfilesListResponse>(
      parkId,
      'POST',
      '/v1/parks/driver-profiles/list',
      body,
    );
    const first = response.driver_profiles?.[0];
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

  async createDebit(input: YandexTransactionInput): Promise<YandexTransactionOutcome> {
    return this.createTransaction(input, input.amount.negated());
  }

  async createCredit(input: YandexTransactionInput): Promise<YandexTransactionOutcome> {
    return this.createTransaction(input, input.amount.abs());
  }

  private async createTransaction(
    input: YandexTransactionInput,
    signedAmount: ReturnType<Money['abs']>,
  ): Promise<YandexTransactionOutcome> {
    const body = {
      park_id: input.parkId,
      driver_profile_id: input.contractorProfileId,
      category_id: input.categoryId,
      amount: signedAmount.toDecimalString(),
      description: input.description,
    };

    try {
      const response = await this.call<CreateTransactionResponse>(
        input.parkId,
        'POST',
        '/v2/parks/driver-profiles/transactions',
        body,
        input.idempotencyToken,
      );
      const transaction = this.toTransaction(response, input.amount.currency);
      if (!transaction) {
        // A 2xx we cannot parse means the transaction may well exist. Treating
        // this as a failure would risk paying the driver without a debit.
        this.logger.warning('Yandex returned an unrecognised transaction payload', {
          parkId: input.parkId,
          idempotencyToken: input.idempotencyToken,
        });
        return { status: 'UNKNOWN', reason: 'unparseable_success_response' };
      }
      return {
        status: 'APPLIED',
        transaction,
        balanceAfter: parseAmount(response.balance_after, input.amount.currency),
      };
    } catch (error) {
      if (error instanceof YandexHttpError) {
        if (
          error.status >= 400 &&
          error.status < 500 &&
          error.status !== 408 &&
          error.status !== 429
        ) {
          return { status: 'REJECTED', code: error.code, message: error.message };
        }
        return { status: 'UNKNOWN', reason: `http_${error.status}` };
      }
      return {
        status: 'UNKNOWN',
        reason: error instanceof Error ? error.name : 'transport_error',
      };
    }
  }

  async findTransaction(
    parkId: string,
    contractorProfileId: string,
    reference: string,
    since: Date,
  ): Promise<YandexTransaction | null> {
    const body = {
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
    };
    const response = await this.call<TransactionsListResponse>(
      parkId,
      'POST',
      '/v2/parks/driver-profiles/transactions/list',
      body,
    );
    const match = (response.transactions ?? []).find((item) =>
      (item.description ?? '').includes(reference),
    );
    if (!match) return null;
    const currency = match.currency_code ?? 'AMD';
    return {
      id: String(match.id),
      amount: parseAmount(match.amount, currency) ?? Money.zero(currency as CurrencyCode),
      description: match.description ?? '',
      eventAt: match.event_at ? new Date(match.event_at) : this.clock.now(),
      categoryId: match.category_id ?? null,
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
  ): Promise<T> {
    await this.throttle(parkId);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.env.YANDEX_TIMEOUT_MS);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Client-ID': this.env.YANDEX_CLIENT_ID ?? '',
      'X-API-Key': this.env.YANDEX_API_KEY ?? '',
      'X-Park-ID': parkId,
      'Accept-Language': 'en',
    };
    if (idempotencyToken) {
      headers['X-Idempotency-Token'] = idempotencyToken;
    }

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
      return (text ? JSON.parse(text) : {}) as T;
    } catch (error) {
      if (error instanceof YandexHttpError) throw error;
      throw new YandexUnavailableError('Yandex Fleet API transport failure', error);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Yandex throttles per park. The exact budget is not documented publicly, so
   * this enforces a conservative minimum gap between calls for one park rather
   * than discovering the real limit by being rate-limited in production.
   */
  private async throttle(parkId: string): Promise<void> {
    const minInterval = this.env.YANDEX_MIN_INTERVAL_MS;
    if (minInterval <= 0) return;
    const last = this.lastCallAt.get(parkId) ?? 0;
    const wait = last + minInterval - Date.now();
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    this.lastCallAt.set(parkId, Date.now());
  }

  private toProfile(parkId: string, raw: DriverProfileItem): YandexContractorProfile {
    const profile = raw.driver_profile ?? {};
    const account =
      (raw.accounts ?? []).find((item) => item.type === 'current') ?? raw.accounts?.[0];
    const currency = account?.currency ?? 'AMD';
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

  private toTransaction(
    response: CreateTransactionResponse,
    currency: string,
  ): YandexTransaction | null {
    const id = response.id ?? response.transaction?.id;
    if (!id) return null;
    const amount = parseAmount(response.amount ?? response.transaction?.amount, currency);
    if (!amount) return null;
    return {
      id: String(id),
      amount,
      description: response.description ?? response.transaction?.description ?? '',
      eventAt: response.event_at ? new Date(response.event_at) : this.clock.now(),
      categoryId: response.category_id ?? null,
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

/**
 * Yandex reports balances as decimal strings, sometimes with more precision
 * than the currency's minor unit. Truncating towards zero is the only safe
 * direction for a balance we are about to pay out against: it can make us
 * withhold a fraction of a dram, never overpay one.
 */
function parseAmount(raw: unknown, currency: string): Money | null {
  if (raw === null || raw === undefined) return null;
  const text = typeof raw === 'string' ? raw : String(raw);
  try {
    return Money.fromDecimalString(text, currency as CurrencyCode, 'TRUNCATE');
  } catch {
    return null;
  }
}

function safeErrorCode(body: string): string {
  try {
    const parsed = JSON.parse(body) as { code?: string; error?: { code?: string } };
    return parsed.code ?? parsed.error?.code ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

// --- Response shapes, as used by the open-source clients this was built from ---

interface DriverProfilesListResponse {
  driver_profiles?: DriverProfileItem[];
  total?: number;
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
  accounts?: Array<{
    id?: string;
    type?: string;
    balance?: string;
    currency?: string;
    balance_limit?: string;
  }>;
}

interface CreateTransactionResponse {
  id?: string;
  amount?: string;
  description?: string;
  event_at?: string;
  category_id?: string;
  balance_after?: string;
  transaction?: { id?: string; amount?: string; description?: string };
}

interface TransactionsListResponse {
  transactions?: Array<{
    id?: string;
    amount?: string;
    currency_code?: string;
    description?: string;
    event_at?: string;
    category_id?: string;
  }>;
}
