import { Injectable, Logger } from '@nestjs/common';
import { SmsProvider } from './sms-provider.interface';

/**
 * Writes the message to the log instead of sending it.
 *
 * Local development and automated tests only. `SmsModule` cannot select it
 * for a staging or production deployment at all — not even under
 * `DEMO_MODE`, which used to be the one configuration that could put live
 * verification codes into a hosted log. A public deployment with no carrier
 * gets `UnavailableSmsProvider` instead.
 *
 * Printing the body is the entire point on a developer's machine: it is how
 * you complete a verification or reset flow with no carrier account. That is
 * safe precisely because this class is now unreachable anywhere the log is
 * not the developer's own terminal.
 */
@Injectable()
export class ConsoleSmsProvider implements SmsProvider {
  readonly name = 'console';
  private readonly logger = new Logger('SMS');

  send(params: { to: string; body: string }): Promise<{ providerMessageId: string | null }> {
    this.logger.warn(`[not actually sent] to=${params.to} body=${params.body}`);
    return Promise.resolve({ providerMessageId: null });
  }
}
