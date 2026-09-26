import { Logger } from '@nestjs/common';
import { Alert, AlertChannel, AlertDelivery } from './alert-channel.interface';

const TIMEOUT_MS = 5_000;

/**
 * Posts alerts to a Telegram chat through the Bot API.
 *
 * Why a second transport next to the webhook: production on Railway was
 * found (26.09.2026) with `ALERT_TELEGRAM_BOT_TOKEN` and `ALERT_TELEGRAM_CHAT_ID`
 * set and nothing in the codebase reading them — the operator had wired a
 * channel that did not exist, `AlertsModule` fell back to the console, and
 * every money alert since had gone to a log nobody was attached to. A
 * variable that looks configured and does nothing is worse than an unset
 * one, so this channel now exists and those two names mean what they say.
 *
 * The message is plain text on purpose — no `parse_mode`. Telegram's Markdown
 * rejects unescaped underscores and brackets, both of which appear in alert
 * keys (`psp.callback-dead-letter:<id>`) and context values, and a rejected
 * alert is the one thing this channel must never produce over formatting.
 *
 * `delivered` is Telegram's word: HTTP 2xx *and* `ok: true` in the body. The
 * Bot API answers 200 with `ok: false` for some errors and 4xx for others,
 * so the status code alone is not enough. The bot token is part of the URL
 * and is never written to a log line or a returned detail.
 */
export class TelegramAlertChannel implements AlertChannel {
  readonly name = 'telegram';
  private readonly logger = new Logger(TelegramAlertChannel.name);

  constructor(
    private readonly botToken: string,
    private readonly chatId: string,
    private readonly environment: string,
  ) {}

  async send(alert: Alert): Promise<AlertDelivery> {
    const icon = alert.severity === 'critical' ? '🔴' : '🟡';
    const text = [
      `${icon} ${alert.title} — ${this.environment}`,
      alert.body,
      ...Object.entries(alert.context ?? {}).map(([k, v]) => `• ${k}: ${v}`),
      `key: ${alert.key}`,
    ].join('\n');

    // A hung receiver must not hold a database transaction or a queue worker
    // open. Same budget as the webhook channel, for the same reason.
    const abort = AbortSignal.timeout(TIMEOUT_MS);

    try {
      const response = await fetch(
        `https://api.telegram.org/bot${this.botToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: this.chatId,
            // Telegram caps a message at 4096 characters; an alert that long
            // is truncated rather than refused, so it still arrives.
            text: text.length > 4000 ? `${text.slice(0, 3990)}…` : text,
            disable_web_page_preview: true,
          }),
          signal: abort,
        },
      );

      const body = (await response.json().catch(() => null)) as
        | { ok?: boolean; description?: string }
        | null;

      if (!response.ok || body?.ok !== true) {
        const description = body?.description ? `: ${body.description}` : '';
        const detail = `telegram answered ${response.status}${description}`;
        this.logger.error(`Alert '${alert.key}' was not accepted by Telegram: ${detail}`);
        return { delivered: false, detail };
      }
      return { delivered: true, detail: `telegram answered ${response.status}` };
    } catch (err) {
      // Deliberately swallowed — see the note on AlertChannel — but reported.
      // The error message from fetch never contains the URL, so the token
      // stays out of the log.
      const detail = `telegram unreachable: ${err instanceof Error ? err.message : String(err)}`;
      this.logger.error(`Alert '${alert.key}' could not be delivered: ${detail}`);
      return { delivered: false, detail };
    }
  }
}
