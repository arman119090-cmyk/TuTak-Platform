import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { SmsProvider } from './sms-provider.interface';

/**
 * What a public deployment uses when no carrier is configured.
 *
 * The alternative used to be `ConsoleSmsProvider`, which writes the message
 * body to the log. On a developer's machine that is the entire point; on a
 * hosted service it publishes every verification code to whoever can read
 * the logs, for every number that asks. `DEMO_MODE` made that reachable in
 * production, which is the hole this class closes: outside development
 * there is no configuration at all that routes a code to a log.
 *
 * Refusing loudly rather than pretending to send: a caller gets a generic
 * "temporarily unavailable", identical whatever number they asked about, and
 * the log records that a carrier is missing — never the recipient's code,
 * and never the body.
 */
export class UnavailableSmsProvider implements SmsProvider {
  readonly name = 'unavailable';
  private readonly logger = new Logger('SMS');

  send(params: { to: string; body: string }): Promise<{ providerMessageId: string | null }> {
    void params;
    this.logger.error(
      'Refusing to send SMS: no carrier is configured for this deployment. ' +
        'Set SMS_ENDPOINT (and its credentials) — see docs/DEPLOYMENT.md.',
    );
    return Promise.reject(
      new ServiceUnavailableException(
        'Verification code delivery is temporarily unavailable. Please try again later.',
      ),
    );
  }
}
