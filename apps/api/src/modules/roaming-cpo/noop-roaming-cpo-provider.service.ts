import { Injectable, Logger } from '@nestjs/common';
import { RoamingCpoProvider } from './roaming-cpo-provider.interface';

/**
 * The only implementation of `RoamingCpoProvider` today, because no real
 * partner endpoint exists to call — see that interface's docblock. Logs
 * the notification so an operator can see the linking events happened, and
 * nothing more. This is not a stub standing in for missing work; it is the
 * whole of what TuTak can correctly do until the partner hands over a real
 * webhook contract to send this to (see the completion report's "what
 * the partner needs to build" section).
 */
@Injectable()
export class NoopRoamingCpoProvider implements RoamingCpoProvider {
  private readonly logger = new Logger(NoopRoamingCpoProvider.name);

  notifyCustomerLinked(params: {
    partnerId: string;
    externalCustomerId: string;
    tutakUserId: string;
  }): Promise<void> {
    this.logger.log(
      `Roaming-CPO customer ${params.externalCustomerId} (partner ${params.partnerId}) ` +
        `linked to TuTak user ${params.tutakUserId} — no real partner endpoint configured, logging only`,
    );
    return Promise.resolve();
  }
}
