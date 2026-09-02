import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { SmsMessage, SmsProvider } from './sms-provider.interface';

/**
 * How a recipient's number is written on the wire.
 *
 * There is no default, and `missingVivaSettings` requires it, because the
 * integration document settles this only by example — one line showing
 * `{93600600:[],94600600:[]}` — and an example is not a specification. The
 * failure it would cause is invisible: a number in a shape Viva does not
 * recognise is accepted into the batch and simply never delivered, and the
 * only symptom is a customer saying the code never arrived. Ask Viva, then
 * state the answer here.
 */
export const VIVA_NUMBER_FORMATS = ['national', 'msisdn', 'e164'] as const;
export type VivaNumberFormat = (typeof VIVA_NUMBER_FORMATS)[number];

/**
 * Where the access token goes on the `transact/*` calls.
 *
 * The integration document does not say. It describes an OAuth-shaped
 * `token/get` + `token/refresh` pair and then never mentions the token
 * again, so `Bearer` is an inference from the shape — a good one, and still
 * an inference. No official Viva Armenia reference for
 * `businesshubapi.viva.am` could be found; `developer.viva.com` documents
 * Viva.com (Viva Wallet), a different company, and says nothing about this
 * host.
 *
 * So the placement is data rather than code: if the first live call comes
 * back 401, the fix is an environment variable, not a change to this class.
 *
 *   `bearer`          Authorization: Bearer <token>       (the default)
 *   `header:<Name>`   <Name>: <token>
 *   `body:<field>`    <field> added to the JSON request body
 *   `query:<param>`   ?<param>=<token>
 */
export type VivaTokenPlacement = string;

export interface VivaSmsConfig {
  /** Base URL, no trailing slash, e.g. https://businesshubapi.viva.am/api/v1 */
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  /** Partner username — an e-mail address in Viva's own example. */
  username: string;
  password: string;
  /** Must match a name registered under Templates/Sender name in the profile. */
  senderName: string;
  /** Must match a name registered under Templates/Text in the profile. */
  templateName: string;
  /** 1 asks Viva to send Unicode where it can — required for Armenian text. */
  sendUtf: boolean;
  numberFormat: VivaNumberFormat;
  tokenPlacement: VivaTokenPlacement;
}

const ARMENIAN_COUNTRY_CODE = '+374';

/**
 * Writes a stored `+374XXXXXXXX` number in the requested shape.
 *
 * `national` drops the country code, which is what Viva's one example
 * implies; `msisdn` keeps it without the `+`; `e164` sends what we store.
 * A number that is not Armenian is never re-prefixed under any of them — a
 * guessed country code sends a stranger a verification code.
 */
export function formatVivaRecipient(phone: string, format: VivaNumberFormat): string {
  const trimmed = phone.trim();

  if (format === 'e164') return trimmed;
  if (format === 'msisdn') return trimmed.startsWith('+') ? trimmed.slice(1) : trimmed;

  if (trimmed.startsWith(ARMENIAN_COUNTRY_CODE)) {
    return trimmed.slice(ARMENIAN_COUNTRY_CODE.length);
  }
  return trimmed.startsWith('+') ? trimmed.slice(1) : trimmed;
}

export interface TokenCarrier {
  headers: Record<string, string>;
  body: Record<string, unknown>;
  query: Record<string, string>;
}

/**
 * Puts the access token wherever this deployment has been told to put it.
 *
 * A pure function so every placement is checked without a network, and so
 * changing the answer after Viva confirms it is a configuration edit rather
 * than a rewrite. An unrecognised placement throws: silently falling back to
 * `bearer` would hide a typo behind a 401 that looks like bad credentials.
 */
export function applyAccessToken(
  placement: VivaTokenPlacement,
  token: string,
  carrier: TokenCarrier,
): TokenCarrier {
  if (placement === 'bearer') {
    return { ...carrier, headers: { ...carrier.headers, Authorization: `Bearer ${token}` } };
  }

  const separator = placement.indexOf(':');
  const kind = separator === -1 ? placement : placement.slice(0, separator);
  const name = separator === -1 ? '' : placement.slice(separator + 1).trim();

  if (name) {
    if (kind === 'header') {
      return { ...carrier, headers: { ...carrier.headers, [name]: token } };
    }
    if (kind === 'body') {
      return { ...carrier, body: { ...carrier.body, [name]: token } };
    }
    if (kind === 'query') {
      return { ...carrier, query: { ...carrier.query, [name]: token } };
    }
  }

  throw new Error(
    `SMS_VIVA_TOKEN_PLACEMENT="${placement}" is not a placement this client knows. ` +
      'Use bearer, header:<Name>, body:<field> or query:<param>.',
  );
}

/**
 * A provider error code short and plain enough to put in a log.
 *
 * Viva's error payloads are not documented, so anything could be in them:
 * an echoed request carrying the recipient's number, a template body
 * carrying the code, an account identifier. None of that belongs in a log,
 * and "log it all, we'll redact later" is how it ends up there permanently.
 *
 * Only a short identifier-shaped value from a field that is named like a
 * code survives — never a message, never free text, never a nested object.
 */
const SAFE_CODE = /^[A-Za-z0-9_.-]{1,64}$/;
const CODE_FIELDS = ['code', 'error_code', 'errorCode', 'status_code', 'statusCode'] as const;

export function safeProviderErrorCode(payload: unknown): string | null {
  if (!isPlainObject(payload)) return null;

  for (const field of CODE_FIELDS) {
    const value = payload[field];
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'string' && SAFE_CODE.test(value)) return value;
  }

  // `error` is a code in some APIs and a sentence in others. Taken only when
  // it is unmistakably the former.
  const error = payload.error;
  if (typeof error === 'string' && SAFE_CODE.test(error)) return error;

  return null;
}

/**
 * The transaction id, read without assuming a shape.
 *
 * `/transact/show/progress` takes this value, so it is worth having — but
 * the document describes no response body at all, so every step is guarded
 * and a miss is `null` rather than an error. A send the carrier accepted
 * must never be reported as failed because a field was named differently.
 */
export function readTransactionId(payload: unknown): string | null {
  if (!isPlainObject(payload)) return null;

  const direct = firstString(payload, ['trx_unique_id', 'trxUniqueId']);
  if (direct) return direct;

  // One level of the common `{ data: { ... } }` envelope, and no deeper:
  // walking an undocumented structure is how a log ends up with a phone
  // number in it.
  const data = payload.data;
  if (isPlainObject(data)) return firstString(data, ['trx_unique_id', 'trxUniqueId']);

  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstString(payload: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

interface CachedToken {
  access: string;
  refresh: string | null;
}

/** What a Viva call returned, reduced to what is safe to keep. */
interface VivaResult {
  ok: boolean;
  status: number;
  payload: unknown;
}

/**
 * SMS through the Viva Business Hub API (`businesshubapi.viva.am`).
 *
 * ## Why this is not `HttpSmsProvider` with different settings
 *
 * `HttpSmsProvider` posts the rendered message text. Viva does not accept
 * message text at all. A send names a **template** registered beforehand in
 * the Viva profile (Templates/Text) and supplies the values of that
 * template's tags; the wording lives on Viva's side and cannot be set from
 * here. So the code the customer reads travels as a tag value, which is why
 * `SmsMessage` carries `templateParams` separately from `body`.
 *
 * The send endpoint is a *batch*: recipients are the keys of `params_data`,
 * up to 200 per call. This provider sends one recipient per call, because
 * every caller in this codebase delivers a code to one person and batching
 * would couple unrelated sign-ins together.
 *
 * ## What is inference rather than specification
 *
 * The integration document is four pages and specifies four request shapes.
 * It does not state how the token is presented, what any response looks
 * like, how long a token lives, or what a recipient number should look like
 * beyond one example. Each of those is handled by making the assumption
 * *movable* instead of hiding it:
 *
 *   - the token placement is configuration (`applyAccessToken`);
 *   - the number format is configuration, and required (`formatVivaRecipient`);
 *   - nothing is read from a response without a guard (`readTransactionId`);
 *   - no token lifetime is invented — a 401 is what drives re-authentication.
 *
 * `docs/SMS_VIVA_RU.md` is the list of what still needs Viva to confirm it.
 */
@Injectable()
export class VivaSmsProvider implements SmsProvider {
  readonly name = 'viva';
  private readonly logger = new Logger('SMS');
  private token: CachedToken | null = null;
  /** One in-flight authentication, so a burst of sends does not stampede. */
  private pending: Promise<CachedToken> | null = null;

  constructor(private readonly config: VivaSmsConfig) {}

  async send(message: SmsMessage): Promise<{ providerMessageId: string | null }> {
    const params = message.templateParams;
    if (!params) {
      // Not recoverable by retrying, and not something to paper over: Viva
      // cannot send free text, so a caller that supplied only `body` would
      // otherwise have its message quietly replaced by an empty template.
      this.logger.error('Refusing a Viva send with no template parameters');
      throw new ServiceUnavailableException('Could not send the SMS message');
    }

    const body = {
      sender_name: this.config.senderName,
      template_name: this.config.templateName,
      // A JSON-encoded *string*, per the document — not a nested object.
      params_data: JSON.stringify({
        [formatVivaRecipient(message.to, this.config.numberFormat)]: params,
      }),
      send_utf: this.config.sendUtf ? 1 : 0,
    };

    let result = await this.transact(body, (await this.accessToken()).access);

    if (result.status === 401) {
      // Documented refresh first, a full re-authentication only if that
      // fails, then exactly one more attempt at the send. There is no loop:
      // a second 401 is a credentials or placement problem, not a stale
      // token, and retrying it would only double the failures.
      const renewed = await this.renew();
      result = await this.transact(body, renewed.access);
    }

    if (!result.ok) {
      this.logger.error(
        `Viva rejected the message (HTTP ${result.status}` +
          `${formatCode(safeProviderErrorCode(result.payload))})`,
      );
      throw new ServiceUnavailableException('Could not send the SMS message');
    }

    return { providerMessageId: readTransactionId(result.payload) };
  }

  /**
   * A new access token after a 401, by the documented route if there is one.
   *
   * `token/refresh` is what the document provides for this, so it is what is
   * tried first. A refresh that fails is not an error worth surfacing — it
   * means the refresh token expired too, and the answer to that is the full
   * `token/get` the next line performs.
   */
  private async renew(): Promise<CachedToken> {
    const previous = this.token;
    this.token = null;

    if (previous?.refresh) {
      const refreshed = await this.refresh(previous.refresh);
      if (refreshed) {
        this.token = refreshed;
        return refreshed;
      }
    }

    return this.accessToken();
  }

  private async refresh(refreshToken: string): Promise<CachedToken | null> {
    const result = await this.post('/token/refresh', {
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      refresh_token: refreshToken,
    });

    if (!result.ok) {
      this.logger.warn(
        `Viva refused the refresh token (HTTP ${result.status}` +
          `${formatCode(safeProviderErrorCode(result.payload))}); re-authenticating`,
      );
      return null;
    }

    const token = readToken(result.payload);
    if (!token) {
      this.logger.warn('Viva accepted the refresh but returned no token; re-authenticating');
      return null;
    }
    // A refresh that returns no new refresh token leaves the old one in
    // place: it is the only one there is, and dropping it would force a full
    // re-authentication on the next 401 for no reason.
    return { access: token.access, refresh: token.refresh ?? refreshToken };
  }

  /**
   * A usable access token, authenticating only when there is none cached.
   *
   * The single `pending` promise matters on the login path: without it, the
   * first burst after a restart sends one `token/get` per concurrent send,
   * and an authentication endpoint is exactly the sort of thing that rate
   * limits.
   */
  private async accessToken(): Promise<CachedToken> {
    if (this.token) return this.token;
    if (this.pending) return this.pending;

    this.pending = this.authenticate()
      .then((token) => {
        this.token = token;
        return token;
      })
      .finally(() => {
        this.pending = null;
      });

    return this.pending;
  }

  private async authenticate(): Promise<CachedToken> {
    const result = await this.post('/token/get', {
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      username: this.config.username,
      password: this.config.password,
      // The document names exactly this scope for sending and reading results.
      scopes: ['transact'],
    });

    if (!result.ok) {
      this.logger.error(
        `Viva refused the credentials (HTTP ${result.status}` +
          `${formatCode(safeProviderErrorCode(result.payload))})`,
      );
      throw new ServiceUnavailableException('Could not send the SMS message');
    }

    const token = readToken(result.payload);
    if (!token) {
      this.logger.error('Viva returned no access token in an otherwise successful response');
      throw new ServiceUnavailableException('Could not send the SMS message');
    }
    return { access: token.access, refresh: token.refresh };
  }

  private transact(body: Record<string, unknown>, accessToken: string): Promise<VivaResult> {
    const carrier = applyAccessToken(this.config.tokenPlacement, accessToken, {
      headers: {},
      body,
      query: {},
    });
    return this.post('/transact/send/batch', carrier.body, carrier.headers, carrier.query);
  }

  private async post(
    path: string,
    body: Record<string, unknown>,
    extraHeaders: Record<string, string> = {},
    query: Record<string, string> = {},
  ): Promise<VivaResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const search = new URLSearchParams(query).toString();
    const url = `${this.config.baseUrl}${path}${search ? `?${search}` : ''}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...extraHeaders },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      return { ok: response.ok, status: response.status, payload: await readJson(response) };
    } catch (err) {
      // The message of a network error names the host and nothing sensitive.
      this.logger.error(`Viva request to ${path} failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException('Could not send the SMS message');
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    // Deliberately not falling back to `response.text()`. An unparseable body
    // is exactly the one whose contents nobody has vetted, and the only use
    // this class has for a body is a guarded field lookup.
    return null;
  }
}

function readToken(payload: unknown): { access: string; refresh: string | null } | null {
  if (!isPlainObject(payload)) return null;

  const source = isPlainObject(payload.data) ? payload.data : payload;
  const access = firstString(source, ['access_token', 'accessToken', 'token']);
  if (!access) return null;

  return { access, refresh: firstString(source, ['refresh_token', 'refreshToken']) };
}

/** `, code=X` or nothing — never a bare comma with an empty value. */
function formatCode(code: string | null): string {
  return code ? `, code=${code}` : '';
}
