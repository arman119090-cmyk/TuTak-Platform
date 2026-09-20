import { Injectable } from '@nestjs/common';
import { DeliveryResult, NotificationPort, OutgoingNotification } from './notification.port';

/**
 * MOCK. Records what would have been sent; sends nothing. Tests read `sent`;
 * the integrations tile shows this adapter as MOCK.
 */
@Injectable()
export class NotificationMockAdapter extends NotificationPort {
  readonly name = 'push-mock';
  readonly mode = 'mock' as const;

  sent: OutgoingNotification[] = [];
  behaviour: 'deliver' | 'fail' = 'deliver';

  reset(): void {
    this.sent = [];
    this.behaviour = 'deliver';
  }

  async send(notification: OutgoingNotification): Promise<DeliveryResult> {
    if (this.behaviour === 'fail') return { delivered: false, reason: 'mock_push_failure' };
    this.sent.push(notification);
    return { delivered: true, providerMessageId: `mock-${this.sent.length}` };
  }
}
