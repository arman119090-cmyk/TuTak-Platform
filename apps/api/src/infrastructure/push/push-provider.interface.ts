/**
 * Outbound push notifications.
 *
 * A port, for the same reason SMS is one: which service carries the message
 * is a deployment decision. Expo's push service is the natural first
 * implementation for an Expo app — it fans out to both APNs and FCM from one
 * token — but nothing in the domain should know that.
 */
export interface PushMessage {
  /** Device token. Expo tokens look like `ExponentPushToken[xxxx]`. */
  to: string;
  title: string;
  body: string;
  /** Delivered to the app so it can open the right screen. */
  data?: Record<string, string | number>;
}

export interface PushDeliveryResult {
  /** Tokens the service rejected as no longer valid. */
  invalidTokens: string[];
  delivered: number;
}

export interface PushProvider {
  /**
   * Delivers to many devices at once.
   *
   * Never rejects. A notification is a courtesy on top of something that
   * already happened — the money moved, the account was created — and a
   * push service being unreachable must not turn a completed payment into a
   * failed request. Failures are logged and reported through the result.
   */
  send(messages: PushMessage[]): Promise<PushDeliveryResult>;

  /** Identifies the implementation in logs and health output. */
  readonly name: string;
}

export const PUSH_PROVIDER = 'PUSH_PROVIDER';
