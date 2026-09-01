import { Injectable, Logger } from '@nestjs/common';
import { SmsProvider } from './sms-provider.interface';

/**
 * Writes the message to the log instead of sending it.
 *
 * The default outside production, so a developer can complete a verification
 * or reset flow end to end without a carrier account. It refuses to be used in
 * production — see SmsModule — because a silently undelivered verification
 * code is indistinguishable from a working one until a real user is locked
 * out by it.
 */
@Injectable()
export class ConsoleSmsProvider implements SmsProvider {
  readonly name = 'console';
  private readonly logger = new Logger('SMS');

  /**
   * `redactBody` exists for the one deployment that reaches this provider
   * with real users in front of it: a public demonstration, where SmsModule
   * allows the console fallback in production because there is no carrier
   * contract. Printing the message there would write live verification codes
   * into a hosted log — readable by anyone who can see the logs, for every
   * number that asks. On a developer's own machine the body is the entire
   * point of this provider, so it stays.
   */
  constructor(private readonly redactBody = false) {}

  send(params: { to: string; body: string }): Promise<{ providerMessageId: string | null }> {
    const body = this.redactBody ? `[redacted ${params.body.length} chars]` : params.body;
    this.logger.warn(`[not actually sent] to=${params.to} body=${body}`);
    return Promise.resolve({ providerMessageId: null });
  }
}
