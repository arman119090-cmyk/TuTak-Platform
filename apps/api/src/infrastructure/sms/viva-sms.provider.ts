import { createHash, createHmac, randomBytes } from 'node:crypto';
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
  /**
   * Shared secret for the Contabo gateway, when `baseUrl` points at it rather
   * than at Viva directly. Empty means "talking to Viva without a gateway",
   * which is the shape used in development and in every test that is not
   * about signing.
   */
  gatewaySecret: string;
}

/**
 * The string the gateway and this client both sign.
 *
 * Must stay byte-identical to `signingString` in
 * `infra/viva-gateway/gateway/viva-gateway.mjs`; the tests on both sides pin
 * the same example so a change to one fails the other.
 *
 * It covers the body, so a signature cannot be lifted onto a different
 * message; the path, so a signature for `show/progress` cannot be replayed as
 * one that sends an SMS; and a timestamp and nonce, so a captured request
 * cannot be sent twice. The secret itself never travels — which is the reason
 * for an HMAC here rather than a bearer token. On a platform with no static
 * outbound IP there is no network-level identity to lean on, so the request
 * has to prove its own authenticity, and a bearer token proves only that
 * whoever holds it once holds it forever.
 */
export function gatewaySigningString(parts: {
  timestamp: string;
  nonce: string;
  method: string;
  path: string;
  body: string;
}): string {
  const digest = createHash('sha256').update(parts.body).digest('hex');
  return [parts.timestamp, parts.nonce, parts.method.toUpperCase(), parts.path, digest].join('\n');
}

/** The three headers the gateway checks. Never logged, by anyone. */
export function gatewayAuthHeaders(
  secret: string,
  path: string,
  body: string,
  now: number = Date.now(),
  nonce: string = randomBytes(16).toString('hex'),
): Record<string, string> {
  const timestamp = String(Math.floor(now / 1000));
  return {
    'X-TuTak-Timestamp': timestamp,
    'X-TuTak-Nonce': nonce,
    'X-TuTak-Signature': createHmac('sha256', secret)
      .update(gatewaySigningString({ timestamp, nonce, method: 'POST', path, body }))
      .digest('hex'),
  };
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

  return toVivaNationalNumber(trimmed);
}

/**
 * The eight-digit local number Viva accepts, from whatever shape came in.
 *
 * Confirmed by a delivered message rather than inferred: `96040790` reaches
 * the handset. Everything else is a prefix to remove, and the shapes that
 * reach this function are not hypothetical — `+37496040790` is what the
 * platform stores, `096040790` is how an Armenian writes their own number,
 * and `37496040790` is what a form strips a `+` from.
 *
 * The leading `0` matters most, because it is the one that used to survive:
 * a nine-digit `096040790` is accepted into the batch and never delivered,
 * and the only symptom is a customer saying no code arrived.
 *
 * Deliberately separate from the platform's own phone normalisation, which
 * produces and validates `+374XXXXXXXX` and is relied on by the whole domain.
 * This shape exists for one carrier's wire format and must not leak back into
 * how a number is stored or compared.
 *
 * A number that is not Armenian is returned with only a `+` removed: guessing
 * a country code sends a stranger somebody's verification code.
 */
export function toVivaNationalNumber(phone: string): string {
  const digits = phone.trim().replace(/[\s()-]/g, '');

  // `+374…`, `00374…`, `374…` — the same country code written three ways.
  for (const prefix of [ARMENIAN_COUNTRY_CODE, `00${ARMENIAN_COUNTRY_CODE.slice(1)}`, '374']) {
    if (digits.startsWith(prefix) && digits.length - prefix.length === 8) {
      return digits.slice(prefix.length);
    }
  }

  // `0XX XXXXXX` — the national trunk prefix, which Viva does not want.
  if (/^0\d{8}$/.test(digits)) return digits.slice(1);

  // Already the eight digits Viva asked for.
  if (/^\d{8}$/.test(digits)) return digits;

  return digits.startsWith('+') ? digits.slice(1) : digits;
}

/**
 * A template tag value on the wire.
 *
 * The approved template's tag is `<n>` and the verified payload sends
 * `[123456]` — a JSON *number*. This sends a number wherever that is
 * lossless, and a string in the one case where it is not: a verification
 * code may begin with a zero (`generateNumericCode` pads to six with `'0'`),
 * and `012345` as a JSON number is `12345` — a five-digit code the customer
 * would type and be told is wrong. That failure would hit roughly one sign-in
 * in ten and look like a customer mistyping.
 *
 * So the shape follows the value: no leading zero, a number, exactly as
 * tested; a leading zero, the digits as a string, which is the only encoding
 * that can carry them at all.
 */
export function vivaTemplateParam(value: string): string | number {
  if (/^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))) {
    return Number(value);
  }
  return value;
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
const TRANSACTION_ID_FIELDS = ['transact_unique_id', 'trx_unique_id', 'trxUniqueId'] as const;

export function readTransactionId(payload: unknown): string | null {
  if (!isPlainObject(payload)) return null;

  const direct = firstString(payload, TRANSACTION_ID_FIELDS);
  if (direct) return direct;

  // One level of the envelope, and no deeper: walking an undocumented
  // structure is how a log ends up with a phone number in it. `result` is
  // where a confirmed live response puts it; `data` stays because it cost
  // nothing and this shape was never specified in writing.
  for (const key of ['result', 'data'] as const) {
    const nested = payload[key];
    if (isPlainObject(nested)) {
      const found = firstString(nested, TRANSACTION_ID_FIELDS);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Viva's own verdict, which is not the HTTP status.
 *
 * A confirmed successful send answers `{"RC":0,"msg":"Success","result":{…}}`,
 * so `RC` is the field that says whether the carrier accepted the message.
 * An HTTP 200 carrying a non-zero `RC` is a refusal wearing a success code,
 * and treating it as delivery would report a code as sent that never left.
 *
 * Absent means absent: no `RC` is not a failure, because the shape was never
 * specified in writing and inventing a rejection would break sends that work.
 */
export function readResultCode(payload: unknown): number | null {
  if (!isPlainObject(payload)) return null;

  for (const key of ['RC', 'rc'] as const) {
    const value = payload[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    // Some gateways stringify it. Only a plain integer is accepted.
    if (typeof value === 'string' && /^-?\d+$/.test(value)) return Number(value);
  }
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
  /**
   * Which token pair this is, counted from the first authentication.
   *
   * A send remembers the generation it used, so a 401 that arrives after
   * somebody else has already replaced the pair can be told apart from a 401
   * about the *current* pair. The first needs no network call at all — the
   * token it complains about is already gone — and treating it as a reason to
   * refresh again is how one expired token turns into a burst of refreshes,
   * each invalidating the last, on exactly the endpoint a carrier rate-limits.
   */
  generation: number;
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
  /**
   * One in-flight renewal, and which generation asked for it.
   *
   * Without this, N concurrent sends meeting a single expired token produce N
   * refreshes. Whether that is merely wasteful or actively harmful depends on
   * whether Viva rotates the refresh token — which is not documented and not
   * confirmed by any live test — so the safe assumption is that it does, and
   * that the last refresh wins while the others invalidate each other.
   */
  private renewal: { generation: number; promise: Promise<CachedToken> } | null = null;
  private generations = 0;

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
      // A JSON-encoded *string* whose values are arrays of tag values —
      // `{"96040790":[123456]}` — which is the payload a delivered message
      // was sent with, not a shape read off a document.
      params_data: JSON.stringify({
        [formatVivaRecipient(message.to, this.config.numberFormat)]:
          params.map(vivaTemplateParam),
      }),
      send_utf: this.config.sendUtf ? 1 : 0,
    };

    const used = await this.accessToken();
    let result = await this.transact(body, used.access);

    if (result.status === 401) {
      // Documented refresh first, a full re-authentication only if that
      // fails, then exactly one more attempt at the send. There is no loop:
      // a second 401 is a credentials or placement problem, not a stale
      // token, and retrying it would only double the failures. A 422 or any
      // other refusal never comes back here at all — retrying a rejected
      // template or sender name would fail identically, forever.
      //
      // `used.generation` is what stops a late 401 from refreshing a pair
      // that has already been replaced: this send is told which token it
      // complained about, not merely that something was unauthorised.
      const renewed = await this.renew(used.generation);
      result = await this.transact(body, renewed.access);
    }

    const resultCode = readResultCode(result.payload);

    if (!result.ok || (resultCode !== null && resultCode !== 0)) {
      this.logger.error(
        `Viva rejected the message (HTTP ${result.status}` +
          `${resultCode !== null ? `, RC=${resultCode}` : ''}` +
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
  private async renew(staleGeneration: number): Promise<CachedToken> {
    // Somebody already replaced the pair this send was using. Its 401 is
    // about a token that no longer exists, so there is nothing to renew —
    // handing back the current pair is both correct and one fewer call to an
    // endpoint that is rate-limited precisely against this pattern.
    if (this.token && this.token.generation !== staleGeneration) {
      return this.token;
    }

    // A renewal for this same generation is already running: join it rather
    // than start a second one. Two refreshes racing would, if Viva rotates
    // refresh tokens, leave one of them holding an invalidated pair.
    if (this.renewal && this.renewal.generation === staleGeneration) {
      return this.renewal.promise;
    }

    const promise = this.performRenewal(staleGeneration).finally(() => {
      if (this.renewal?.generation === staleGeneration) this.renewal = null;
    });
    this.renewal = { generation: staleGeneration, promise };
    return promise;
  }

  private async performRenewal(staleGeneration: number): Promise<CachedToken> {
    const previous = this.token;

    // The stale pair is deliberately left in place while the refresh runs.
    // Clearing it first would send any send that arrives meanwhile down the
    // full `token/get` path — a second authentication for a token that is
    // about to be replaced anyway.
    if (previous?.refresh) {
      const refreshed = await this.refresh(previous.refresh);
      if (refreshed) {
        // Re-checked after the await: a concurrent renewal may have installed
        // a newer pair while this refresh was in flight, and overwriting it
        // would put back the older of the two.
        if (this.token && this.token.generation > staleGeneration) return this.token;
        this.token = refreshed;
        return refreshed;
      }
    }

    // Either there was nothing to refresh with, or the refresh was refused —
    // which means the refresh token expired too. Drop the pair so the
    // authentication below starts from credentials, but only if nobody has
    // replaced it in the meantime.
    if (this.token === previous) this.token = null;
    return this.accessToken();
  }

  private async refresh(refreshToken: string): Promise<CachedToken | null> {
    const result = await this.post('/token/refresh', {
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      refresh_token: refreshToken,
    });

    const refreshCode = readResultCode(result.payload);
    if (!result.ok || (refreshCode !== null && refreshCode !== 0)) {
      this.logger.warn(
        `Viva refused the refresh token (HTTP ${result.status}` +
          `${refreshCode !== null ? `, RC=${refreshCode}` : ''}` +
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
    //
    // Whether Viva rotates the refresh token, and how long either token
    // lives, is not stated in the integration document and was not covered by
    // the live test. Nothing here depends on knowing: no lifetime is
    // invented, no expiry is scheduled, and a 401 is the only thing that ever
    // triggers renewal.
    return {
      access: token.access,
      refresh: token.refresh ?? refreshToken,
      generation: ++this.generations,
    };
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

    const authCode = readResultCode(result.payload);
    if (!result.ok || (authCode !== null && authCode !== 0)) {
      this.logger.error(
        `Viva refused the credentials (HTTP ${result.status}` +
          `${authCode !== null ? `, RC=${authCode}` : ''}` +
          `${formatCode(safeProviderErrorCode(result.payload))})`,
      );
      throw new ServiceUnavailableException('Could not send the SMS message');
    }

    const token = readToken(result.payload);
    if (!token) {
      this.logger.error('Viva returned no access token in an otherwise successful response');
      throw new ServiceUnavailableException('Could not send the SMS message');
    }
    return { access: token.access, refresh: token.refresh, generation: ++this.generations };
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
    const payload = JSON.stringify(body);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...extraHeaders,
          // Signed over the path the gateway sees, which is what follows the
          // base URL — not the full URL, and never the query string, which
          // carries no part of the request the gateway acts on.
          ...(this.config.gatewaySecret
            ? gatewayAuthHeaders(this.config.gatewaySecret, path, payload)
            : {}),
        },
        body: payload,
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

export function readToken(payload: unknown): { access: string; refresh: string | null } | null {
  if (!isPlainObject(payload)) return null;

  // `result` first, because that is where a confirmed live `/token/get`
  // response puts both tokens. `data` and the root stay as fallbacks: they
  // cost one lookup each and this envelope was never specified in writing.
  const candidates = [payload.result, payload.data, payload].filter(isPlainObject);

  for (const source of candidates) {
    const access = firstString(source, ['access_token', 'accessToken', 'token']);
    if (access) {
      return { access, refresh: firstString(source, ['refresh_token', 'refreshToken']) };
    }
  }
  return null;
}

/** `, code=X` or nothing — never a bare comma with an empty value. */
function formatCode(code: string | null): string {
  return code ? `, code=${code}` : '';
}
