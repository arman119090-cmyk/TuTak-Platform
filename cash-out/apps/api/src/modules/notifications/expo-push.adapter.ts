import { AppLogger } from '../../common/logging/logger.service';
import { IntegrationHealthRecorder } from '../integration-health/integration-health.recorder';
import { notificationText } from './notification-texts';
import { DeliveryResult, NotificationPort, OutgoingNotification } from './notification.port';

export interface ExpoPushOptions {
  readonly accessToken?: string;
  readonly timeoutMs: number;
  readonly endpoint?: string;
}

export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ status: number; text(): Promise<string> }>;

/** Reasons the sweeper treats as final for this token rather than retrying. */
export const PUSH_TOKEN_DEAD = 'device_not_registered';

/**
 * Expo's push service (https://exp.host/--/api/v2/push/send), the delivery
 * path for an Expo-built app: Expo holds the FCM and APNs credentials, the API
 * holds only an optional Expo access token.
 *
 * **LIVE-UNVERIFIED.** The request and response shapes follow Expo's
 * published API; nothing here has been exercised against a real device from
 * this repository. `PUSH_MODE=live PUSH_PROVIDER=expo` turns it on; the app
 * must register an `ExponentPushToken[...]` through `POST
 * /v1/notifications/push-token`, which needs `expo-notifications` and the EAS
 * project id on the mobile side (docs/LIVE_READINESS.md).
 *
 * Outcomes: `ok` → delivered; `DeviceNotRegistered` → the token is dead and
 * the sweeper drops it instead of retrying; any other error, a non-2xx status
 * or a timeout → not delivered, retried by the outbox with backoff.
 */
export class ExpoPushAdapter extends NotificationPort {
  readonly name = 'expo-push';
  readonly mode = 'live' as const;

  constructor(
    private readonly options: ExpoPushOptions,
    private readonly logger: AppLogger,
    private readonly health: IntegrationHealthRecorder,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {
    super();
  }

  async send(notification: OutgoingNotification): Promise<DeliveryResult> {
    if (!notification.pushToken) return { delivered: false, reason: 'no_push_token' };
    if (!/^(ExponentPushToken|ExpoPushToken)\[.+\]$/.test(notification.pushToken)) {
      return { delivered: false, reason: PUSH_TOKEN_DEAD };
    }

    const text = notificationText(notification.kind, notification.locale, notification.payload);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await this.fetchImpl(
        this.options.endpoint ?? 'https://exp.host/--/api/v2/push/send',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...(this.options.accessToken
              ? { Authorization: `Bearer ${this.options.accessToken}` }
              : {}),
          },
          body: JSON.stringify({
            to: notification.pushToken,
            title: text.title,
            body: text.body,
            sound: 'default',
            priority: 'high',
            data: { kind: notification.kind, ...notification.payload },
          }),
          signal: controller.signal,
        },
      );
      const raw = await response.text();
      if (response.status < 200 || response.status >= 300) {
        await this.health.record(this.name, false, `http ${response.status}`);
        return { delivered: false, reason: `http_${response.status}` };
      }
      const outcome = parseExpoReply(raw);
      await this.health.record(
        this.name,
        outcome.delivered,
        outcome.delivered ? undefined : outcome.reason,
      );
      return outcome;
    } catch {
      const reason = controller.signal.aborted ? 'timeout' : 'network_error';
      await this.health.record(this.name, false, reason);
      this.logger.warning('Expo push failed', { reason, kind: notification.kind });
      return { delivered: false, reason };
    } finally {
      clearTimeout(timer);
    }
  }
}

function parseExpoReply(raw: string): DeliveryResult {
  let body: {
    data?: Array<{ status?: string; id?: string; message?: string; details?: { error?: string } }>;
    errors?: unknown[];
  };
  try {
    body = JSON.parse(raw);
  } catch {
    return { delivered: false, reason: 'malformed_reply' };
  }
  if (body.errors && Array.isArray(body.errors) && body.errors.length > 0) {
    return { delivered: false, reason: 'request_error' };
  }
  const ticket = body.data?.[0];
  if (!ticket) return { delivered: false, reason: 'no_ticket' };
  if (ticket.status === 'ok') return { delivered: true, providerMessageId: ticket.id ?? null };
  const detail = ticket.details?.error;
  if (detail === 'DeviceNotRegistered') return { delivered: false, reason: PUSH_TOKEN_DEAD };
  return { delivered: false, reason: `expo_${detail ?? 'error'}` };
}
