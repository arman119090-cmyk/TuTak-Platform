import { Injectable, Logger } from '@nestjs/common';
import { OcpiAdapter } from './ocpi-adapter.interface';

export interface OcpiHttpConfig {
  /** Base URL of the CPO's OCPI versions endpoint, e.g. https://fastcharge.am/ocpi/cpo */
  baseUrl: string;
  /** Token C — the credential this platform presents as eMSP. */
  token: string;
  partyId: string;
  countryCode: string;
}

/** OCPI wraps every response; `status_code` 1000 is success, everything else is not. */
interface OcpiEnvelope<T> {
  data?: T;
  status_code: number;
  status_message?: string;
}

type CommandResult = { result: 'ACCEPTED' | 'REJECTED' | 'TIMEOUT' | 'UNKNOWN_SESSION' };

/**
 * OCPI 2.2.1 client for a roaming CPO (FastCharge or any other).
 *
 * Speaks the Commands and CDRs modules over HTTP. Authentication is the OCPI
 * `Token` scheme — base64 of the credential, which is what 2.2.1 requires and
 * is the detail most implementations get wrong on the first try.
 *
 * Two deliberate choices:
 *
 *  * Commands are asynchronous in OCPI: the CPO acknowledges receipt
 *    synchronously and reports the real outcome later to a `response_url`.
 *    This client treats only an explicit ACCEPTED as success, so a session
 *    never starts locally because a command was merely *received*.
 *  * A network failure is a rejection, not an exception that reaches the
 *    customer. `startRemoteSession` returning `accepted: false` makes the
 *    caller roll the session back cleanly, which is the behaviour that keeps
 *    a bay from being marked occupied by a charger that never started.
 *
 * Not yet exercised against a live CPO: no credentials have been issued, so
 * every path here is verified against the specification and unit tests, not
 * against FastCharge's server. The first real handshake will need the
 * credentials exchange (Token A → Token C), which is a one-time operational
 * step rather than code.
 */
@Injectable()
export class HttpOcpiAdapter implements OcpiAdapter {
  private readonly logger = new Logger('OCPI');

  constructor(private readonly config: OcpiHttpConfig) {}

  async startRemoteSession(params: {
    ocpiEvseUid: string;
    userId: string;
    localSessionId: string;
  }): Promise<{ accepted: boolean; ocpiSessionId?: string }> {
    const body = {
      response_url: `${this.config.baseUrl}/commands/START_SESSION/${params.localSessionId}`,
      token: {
        country_code: this.config.countryCode,
        party_id: this.config.partyId,
        uid: params.userId,
        type: 'APP_USER',
        contract_id: `${this.config.countryCode}-${this.config.partyId}-${params.userId}`,
        issuer: 'TuTak',
        valid: true,
        whitelist: 'ALLOWED',
      },
      evse_uid: params.ocpiEvseUid,
    };

    const result = await this.post<CommandResult>('commands/START_SESSION', body);
    if (result?.result !== 'ACCEPTED') {
      this.logger.warn(
        `CPO did not accept START_SESSION for EVSE ${params.ocpiEvseUid}: ${result?.result ?? 'no response'}`,
      );
      return { accepted: false };
    }

    return { accepted: true, ocpiSessionId: params.localSessionId };
  }

  async stopRemoteSession(params: { ocpiSessionId: string }): Promise<{ accepted: boolean }> {
    const result = await this.post<CommandResult>('commands/STOP_SESSION', {
      response_url: `${this.config.baseUrl}/commands/STOP_SESSION/${params.ocpiSessionId}`,
      session_id: params.ocpiSessionId,
    });

    if (result?.result !== 'ACCEPTED') {
      // Logged, not thrown. A charger that will not stop on command is a
      // physical problem; failing the customer's stop request on top of it
      // would leave them unable to close a session they have walked away from.
      this.logger.error(
        `CPO did not accept STOP_SESSION for ${params.ocpiSessionId}: ${result?.result ?? 'no response'}`,
      );
      return { accepted: false };
    }
    return { accepted: true };
  }

  async fetchCdr(ocpiSessionId: string): Promise<{
    ocpiCdrId: string;
    totalEnergyKwh: number;
    totalCost: number;
    totalTimeSec: number;
    raw: unknown;
  } | null> {
    const cdr = await this.get<{
      id: string;
      total_energy: number;
      total_cost?: { excl_vat: number } | number;
      total_time: number;
    }>(`cdrs/${encodeURIComponent(ocpiSessionId)}`);

    if (!cdr) return null;

    // `total_cost` is a Price object in 2.2.1 and a bare number in 2.1.1;
    // roaming partners run both, so both are accepted.
    const cost =
      typeof cdr.total_cost === 'number' ? cdr.total_cost : (cdr.total_cost?.excl_vat ?? 0);

    return {
      ocpiCdrId: cdr.id,
      totalEnergyKwh: cdr.total_energy,
      totalCost: cost,
      // OCPI reports total_time in hours; the rest of the system uses seconds.
      totalTimeSec: Math.round(cdr.total_time * 3600),
      raw: cdr,
    };
  }

  // ── Transport ─────────────────────────────────────────────────────────

  private headers(): Record<string, string> {
    return {
      // OCPI 2.2+ requires the credential base64-encoded behind `Token`.
      Authorization: `Token ${Buffer.from(this.config.token).toString('base64')}`,
      'Content-Type': 'application/json',
      'X-Request-ID': crypto.randomUUID(),
      'X-Correlation-ID': crypto.randomUUID(),
      'OCPI-from-country-code': this.config.countryCode,
      'OCPI-from-party-id': this.config.partyId,
    };
  }

  private async post<T>(path: string, body: unknown): Promise<T | null> {
    return this.request<T>(path, { method: 'POST', body: JSON.stringify(body) });
  }

  private async get<T>(path: string): Promise<T | null> {
    return this.request<T>(path, { method: 'GET' });
  }

  /**
   * Never throws. Every caller here has a meaningful "the CPO did not agree"
   * branch, and turning a roaming partner's outage into a 500 for the customer
   * standing at the charger helps nobody.
   */
  private async request<T>(path: string, init: RequestInit): Promise<T | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const response = await fetch(`${this.config.baseUrl}/${path}`, {
        ...init,
        headers: this.headers(),
        signal: controller.signal,
      });

      if (!response.ok) {
        this.logger.error(`OCPI ${path} returned HTTP ${response.status}`);
        return null;
      }

      const envelope = (await response.json()) as OcpiEnvelope<T>;
      if (envelope.status_code !== 1000) {
        this.logger.error(
          `OCPI ${path} returned status ${envelope.status_code}: ${envelope.status_message ?? ''}`,
        );
        return null;
      }
      return envelope.data ?? null;
    } catch (err) {
      this.logger.error(`OCPI ${path} failed: ${(err as Error).message}`);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}
