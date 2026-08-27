import { Injectable, Logger } from '@nestjs/common';
import { FastChargeProvider } from './fastcharge-provider.interface';

/**
 * The only implementation of `FastChargeProvider` today, because no real
 * FastCharge endpoint exists to call — see that interface's docblock. Logs
 * the notification so an operator can see the linking events happened, and
 * nothing more. This is not a stub standing in for missing work; it is the
 * whole of what TuTak can correctly do until FastCharge hands over a real
 * webhook contract to send this to (see the completion report's "what
 * FastCharge needs to build" section).
 */
@Injectable()
export class NoopFastChargeProvider implements FastChargeProvider {
  private readonly logger = new Logger(NoopFastChargeProvider.name);

  notifyCustomerLinked(params: {
    partnerId: string;
    fastChargeCustomerId: string;
    tutakUserId: string;
  }): Promise<void> {
    this.logger.log(
      `FastCharge customer ${params.fastChargeCustomerId} (partner ${params.partnerId}) ` +
        `linked to TuTak user ${params.tutakUserId} — no real FastCharge endpoint configured, logging only`,
    );
    return Promise.resolve();
  }
}
