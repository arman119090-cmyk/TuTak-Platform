import type { NotificationKind } from '@cashout/contracts';

export interface OutgoingNotification {
  readonly driverId: string;
  readonly kind: NotificationKind;
  readonly locale: string;
  /** The device token, when the driver registered one. */
  readonly pushToken: string | null;
  readonly payload: Record<string, string | number | null>;
}

export type DeliveryResult =
  | { readonly delivered: true; readonly providerMessageId: string | null }
  | { readonly delivered: false; readonly reason: string };

/**
 * Where notifications go. One implementation exists: the mock, which records
 * them. A live push provider (Expo push, FCM/APNs) would implement `send` and
 * be registered in the module under `PUSH_MODE=live`; until then nothing here
 * is a claim that a driver's phone will buzz.
 */
export abstract class NotificationPort {
  abstract readonly name: string;
  abstract readonly mode: 'mock' | 'live';
  abstract send(notification: OutgoingNotification): Promise<DeliveryResult>;
}
