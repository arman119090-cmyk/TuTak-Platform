import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { SmsMessage, SmsProvider } from './sms-provider.interface';

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
}

/** Viva's own example numbers are bare 8-digit subscriber numbers: `93600600`. */
const ARMENIAN_COUNTRY_CODE = '+374';

/**
 * Turns a stored `+374XXXXXXXX` number into the form Viva addresses.
 *
 * Exported and tested separately because getting it wrong is not a visible
 * failure: an unrecognised number is one the carrier accepts into a batch and
 * silently never delivers, and the only symptom is a customer who says the
 * code never arrived.
 */
export function toVivaSubscriberNumber(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.startsWith(ARMENIAN_COUNTRY_CODE)) {
    return trimmed.slice(ARMENIAN_COUNTRY_CODE.length);
  }
  // Not an Armenian number in our own stored format. Strip a leading `+` and
  // pass the rest through rather than guessing at a prefix — a wrong guess
  // sends someone else's phone a code.
  return trimmed.startsWith('+') ? trimmed.slice(1) : trimmed;
}

interface CachedToken {
  access: string;
  refresh: string | null;
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
 * here. So the code we want the customer to read travels as a tag value,
 * which is why `SmsMessage` carries `templateParams` separately from `body`.
 *
 * The send endpoint is also a *batch*: recipients are the keys of
 * `params_data`, up to 200 per call. This provider sends one recipient per
 * call, because every caller in this codebase is delivering a verification or
 * password-reset code to one person and batching them would couple unrelated
 * sign-ins together.
 *
 * ## What the integration document does not say
 *
 * The document (4 pages, `docs/SMS_VIVA_RU.md` records what it covers)
 * specifies the four request shapes and nothing else. It does not state:
 *
 *   - **how the access token is presented** on the transact calls. `Bearer`
 *     in an `Authorization` header is the overwhelmingly common convention
 *     for an OAuth-shaped `token/get` + `token/refresh` pair, and is what
 *     this sends — but it is an inference, not something the document says,
 *     and it is the first thing to check against a real account.
 *   - **the response bodies**, success or failure. Everything read out of a
 *     response here is therefore optional: a missing `trx_unique_id` is
 *     logged and returned as `null` rather than treated as a failed send,
 *     because the HTTP status is the only documented signal.
 *   - **how long an access token lives.** Rather than invent a lifetime, the
 *     token is cached until a call comes back 401, then refreshed once and
 *     the call retried once. That is correct for any lifetime.
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
      throw new ServiceUnavailableException('Could not send the SMS message');
    }

    const recipient = toVivaSubscriberNumber(message.to);
    const body = {
      sender_name: this.config.senderName,
      template_name: this.config.templateName,
      // A JSON-encoded *string*, per the document — not a nested object.
      params_data: JSON.stringify({ [recipient]: params }),
      send_utf: this.config.sendUtf ? 1 : 0,
    };

    let token = await this.accessToken();
    let response = await this.post('/transact/send/batch', body, token.access);

    if (response.status === 401) {
      // The cached token has expired or been revoked. One refresh, one retry;
      // a second 401 is a credentials problem, not a stale token, and looping
      // on it would turn every send into two failed round trips.
      this.token = null;
      token = await this.accessToken();
      response = await this.post('/transact/send/batch', body, token.access);
    }

    if (!response.ok) {
      // Viva's error text can name the account and the template. It is logged
      // and never propagated to the caller, which is on the sign-in path.
      const detail = await response.text().catch(() => '');
      this.logger.error(`Viva rejected the message (${response.status}): ${detail}`);
      throw new ServiceUnavailableException('Could not send the SMS message');
    }

    return { providerMessageId: await this.transactionId(response) };
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
    const response = await this.post('/token/get', {
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      username: this.config.username,
      password: this.config.password,
      // The document names exactly this scope for sending and reading results.
      scopes: ['transact'],
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      this.logger.error(`Viva refused the credentials (${response.status}): ${detail}`);
      throw new ServiceUnavailableException('Could not send the SMS message');
    }

    const payload = await this.json(response);
    const access = readString(payload, 'access_token') ?? readString(payload, 'token');
    if (!access) {
      this.logger.error('Viva returned no access token in an otherwise successful response');
      throw new ServiceUnavailableException('Could not send the SMS message');
    }

    return { access, refresh: readString(payload, 'refresh_token') };
  }

  private post(path: string, body: unknown, accessToken?: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    // See the class comment: an inference from the endpoint pair's shape,
    // not something the integration document states.
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    return fetch(`${this.config.baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })
      .catch((err: Error) => {
        this.logger.error(`Viva request to ${path} failed: ${err.message}`);
        throw new ServiceUnavailableException('Could not send the SMS message');
      })
      .finally(() => clearTimeout(timeout)) as Promise<Response>;
  }

  private async json(response: Response): Promise<Record<string, unknown>> {
    try {
      const parsed: unknown = await response.json();
      return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  /**
   * Best effort, and deliberately so. The transaction id is what
   * `/transact/show/progress` takes, so it is worth keeping — but the
   * document describes no response body, and a send whose HTTP status said
   * it was accepted must not be reported as failed because a field was
   * named something else.
   */
  private async transactionId(response: Response): Promise<string | null> {
    const payload = await this.json(response);
    return (
      readString(payload, 'trx_unique_id') ??
      readString(payload, 'trxUniqueId') ??
      readString((payload.data as Record<string, unknown>) ?? {}, 'trx_unique_id')
    );
  }
}

function readString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}
