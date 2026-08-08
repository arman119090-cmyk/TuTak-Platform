import { Injectable, Logger } from '@nestjs/common';
import { PushDeliveryResult, PushMessage, PushProvider } from './push-provider.interface';

export interface ExpoPushConfig {
  endpoint: string;
  /**
   * Required once the Expo project enables "enhanced security"; optional
   * otherwise. Sent as a bearer token when present.
   */
  accessToken: string;
}

/** Expo accepts at most 100 messages per request. */
const BATCH_SIZE = 100;

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

/**
 * Delivery through Expo's push service.
 *
 * The right first implementation for this app: the mobile client is Expo, so
 * one token reaches both APNs and FCM without the deployment holding an Apple
 * key and a Firebase service account. Swapping to raw FCM later is a new
 * `PushProvider`, not a change to anything that calls one.
 *
 * Uses `fetch` rather than `expo-server-sdk` for the same reason the SMS
 * client avoids a vendor SDK — this is one POST, and a dependency here would
 * tie the server's release cycle to a client library's.
 */
@Injectable()
export class ExpoPushProvider implements PushProvider {
  readonly name = 'expo';
  private readonly logger = new Logger('Push');

  constructor(private readonly config: ExpoPushConfig) {}

  async send(messages: PushMessage[]): Promise<PushDeliveryResult> {
    const invalidTokens: string[] = [];
    let delivered = 0;

    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      const batch = messages.slice(i, i + BATCH_SIZE);
      const result = await this.sendBatch(batch);
      invalidTokens.push(...result.invalidTokens);
      delivered += result.delivered;
    }

    return { invalidTokens, delivered };
  }

  private async sendBatch(batch: PushMessage[]): Promise<PushDeliveryResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(this.config.accessToken
            ? { Authorization: `Bearer ${this.config.accessToken}` }
            : {}),
        },
        body: JSON.stringify(
          batch.map((m) => ({
            to: m.to,
            title: m.title,
            body: m.body,
            data: m.data,
            sound: 'default',
          })),
        ),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        this.logger.error(`Expo rejected the batch (${response.status}): ${detail}`);
        return { invalidTokens: [], delivered: 0 };
      }

      const body = (await response.json()) as { data?: ExpoTicket[] };
      return this.readTickets(batch, body.data ?? []);
    } catch (err) {
      // Swallowed by contract. A push service being unreachable must not
      // fail whatever caused the notification.
      this.logger.error(`Push delivery failed: ${(err as Error).message}`);
      return { invalidTokens: [], delivered: 0 };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Tickets come back positionally, one per message in the batch.
   *
   * `DeviceNotRegistered` is the one worth acting on: the app was deleted or
   * the token rotated, and continuing to send to it wastes a slot in every
   * future batch. It is reported so the caller can forget the token.
   */
  private readTickets(batch: PushMessage[], tickets: ExpoTicket[]): PushDeliveryResult {
    const invalidTokens: string[] = [];
    let delivered = 0;

    tickets.forEach((ticket, index) => {
      if (ticket.status === 'ok') {
        delivered += 1;
        return;
      }
      const token = batch[index]?.to;
      if (ticket.details?.error === 'DeviceNotRegistered' && token) {
        invalidTokens.push(token);
      } else {
        this.logger.warn(`Expo ticket error for ${token ?? 'unknown token'}: ${ticket.message}`);
      }
    });

    return { invalidTokens, delivered };
  }
}
