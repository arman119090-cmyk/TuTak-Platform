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

  send(params: { to: string; body: string }): Promise<{ providerMessageId: string | null }> {
    this.logger.warn(`[not actually sent] to=${params.to} body=${params.body}`);
    return Promise.resolve({ providerMessageId: null });
  }
}
