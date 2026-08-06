import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { SmsProvider } from './sms-provider.interface';

export interface HttpSmsConfig {
  endpoint: string;
  /** `basic` suits Twilio (Account SID + Auth Token); `bearer` most others. */
  authScheme: 'basic' | 'bearer';
  username: string;
  password: string;
  sender: string;
  /** `form` for Twilio's application/x-www-form-urlencoded API; `json` otherwise. */
  encoding: 'form' | 'json';
}

/**
 * A real SMS client over HTTP, configured rather than hard-coded to a vendor.
 *
 * Twilio's Messages API is form-encoded with Basic auth and the fields
 * `To`/`From`/`Body`; most other gateways — including local Armenian carriers —
 * take JSON with a bearer token. Both shapes are reachable from configuration,
 * so changing carrier is an environment change and not a code change.
 *
 * Deliberately uses `fetch` with an explicit timeout rather than a vendor SDK:
 * an SDK would tie the deployment to one carrier's release cycle for the sake
 * of a single POST, and this is on the login path.
 */
@Injectable()
export class HttpSmsProvider implements SmsProvider {
  readonly name = 'http';
  private readonly logger = new Logger('SMS');

  constructor(private readonly config: HttpSmsConfig) {}

  async send(params: { to: string; body: string }): Promise<{ providerMessageId: string | null }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: this.headers(),
        body: this.body(params),
        signal: controller.signal,
      });

      if (!response.ok) {
        // The carrier's error text can name account identifiers, so it is
        // logged and never propagated to whatever triggered the send.
        const detail = await response.text().catch(() => '');
        this.logger.error(`SMS carrier rejected the message (${response.status}): ${detail}`);
        throw new ServiceUnavailableException('Could not send the SMS message');
      }

      return { providerMessageId: await this.extractMessageId(response) };
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      this.logger.error(`SMS delivery failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException('Could not send the SMS message');
    } finally {
      clearTimeout(timeout);
    }
  }

  private headers(): Record<string, string> {
    const auth =
      this.config.authScheme === 'basic'
        ? `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`
        : `Bearer ${this.config.password}`;

    return {
      Authorization: auth,
      'Content-Type':
        this.config.encoding === 'form' ? 'application/x-www-form-urlencoded' : 'application/json',
    };
  }

  private body(params: { to: string; body: string }): string {
    if (this.config.encoding === 'form') {
      return new URLSearchParams({
        To: params.to,
        From: this.config.sender,
        Body: params.body,
      }).toString();
    }
    return JSON.stringify({ to: params.to, from: this.config.sender, text: params.body });
  }

  /** Best-effort: the id is for correlation only, so an odd shape is not fatal. */
  private async extractMessageId(response: Response): Promise<string | null> {
    try {
      const payload = (await response.json()) as Record<string, unknown>;
      const id = payload.sid ?? payload.message_id ?? payload.messageId ?? payload.id;
      return typeof id === 'string' ? id : null;
    } catch {
      return null;
    }
  }
}
