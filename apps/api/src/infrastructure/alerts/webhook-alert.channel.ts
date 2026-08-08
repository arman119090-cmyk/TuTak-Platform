import { Logger } from '@nestjs/common';
import { Alert, AlertChannel } from './alert-channel.interface';

const TIMEOUT_MS = 5_000;

/**
 * Posts alerts to a webhook.
 *
 * The body carries both a `text` field and the structured fields, because the
 * things people actually point this at disagree about the shape: Slack,
 * Mattermost and Discord render `text`, while a generic receiver wants the
 * parts separately. Sending both costs a few bytes and means the URL can be
 * swapped without a code change.
 *
 * The message is written to be readable on a phone at three in the morning by
 * someone who has not opened the codebase in a month: what happened, what it
 * means for money, and where to look.
 */
export class WebhookAlertChannel implements AlertChannel {
  readonly name = 'webhook';
  private readonly logger = new Logger(WebhookAlertChannel.name);

  constructor(
    private readonly url: string,
    private readonly environment: string,
  ) {}

  async send(alert: Alert): Promise<void> {
    const icon = alert.severity === 'critical' ? '🔴' : '🟡';
    const lines = [
      `${icon} *${alert.title}* — ${this.environment}`,
      alert.body,
      ...Object.entries(alert.context ?? {}).map(([k, v]) => `• ${k}: ${v}`),
    ];

    const payload = {
      text: lines.join('\n'),
      severity: alert.severity,
      title: alert.title,
      body: alert.body,
      key: alert.key,
      environment: this.environment,
      context: alert.context ?? {},
      firedAt: new Date().toISOString(),
    };

    // A hung webhook must not hold a database transaction or a queue worker
    // open. Five seconds, then give up and log — the alert is lost, which is
    // bad, but a wedged reconciliation run is worse.
    const abort = AbortSignal.timeout(TIMEOUT_MS);

    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: abort,
      });

      if (!response.ok) {
        this.logger.error(
          `Alert '${alert.key}' was not accepted by the webhook: ${response.status} ${response.statusText}`,
        );
      }
    } catch (err) {
      // Deliberately swallowed — see the note on AlertChannel.
      this.logger.error(
        `Alert '${alert.key}' could not be delivered: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
