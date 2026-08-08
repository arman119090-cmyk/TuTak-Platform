import { Injectable, Logger } from '@nestjs/common';
import { PushDeliveryResult, PushMessage, PushProvider } from './push-provider.interface';

/**
 * Writes the notification to the log instead of delivering it.
 *
 * The default outside production, so the app can be developed without an
 * Expo project or a signed build. It refuses to be used in production — see
 * PushModule — for the same reason the console SMS provider does: a
 * notification nobody receives looks exactly like one that worked.
 */
@Injectable()
export class ConsolePushProvider implements PushProvider {
  readonly name = 'console';
  private readonly logger = new Logger('Push');

  send(messages: PushMessage[]): Promise<PushDeliveryResult> {
    for (const message of messages) {
      this.logger.warn(`[not actually sent] to=${message.to} "${message.title}" ${message.body}`);
    }
    return Promise.resolve({ invalidTokens: [], delivered: messages.length });
  }
}
