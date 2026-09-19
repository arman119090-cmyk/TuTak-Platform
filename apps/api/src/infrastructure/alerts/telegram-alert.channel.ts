import { Logger } from '@nestjs/common';
import { Alert, AlertChannel, AlertDelivery } from './alert-channel.interface';

const TIMEOUT_MS = 5_000;

/**
 * Posts alerts to a Telegram chat through the Bot API.
 *
 * This exists because a Slack/Mattermost-style incoming webhook is not
 * something every operator has, while a Telegram group with a bot in it is
 * ten minutes of setup on a phone. It is a second transport, not a
 * replacement: `AlertsModule` sends to every channel that is configured and
 * counts the alert delivered if *any* receiver accepted it.
 *
 * Delivered means the Bot API answered 2xx **and** said `ok: true`. Telegram
 * answers 200 with `ok: false` for a chat the bot is not in, so status alone
 * is not the receiver's word.
 *
 * The bot token is a credential. It sits in the request URL, so every error
 * path here is scrubbed before it reaches a log line or an `AlertDelivery`:
 * the token never appears in either, whatever `fetch` puts in its message.
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
    const lines = [
      `${icon} ${alert.title} — ${this.environment}`,
      alert.body,
      ...Object.entries(alert.context ?? {}).map(([k, v]) => `• ${k}: ${v}`),
      `key: ${alert.key}`,
    ];

    // Plain text on purpose: with `parse_mode` set, one unescaped underscore
    // in an error message turns into a 400 and the alert is lost.
    const payload = {
      chat_id: this.chatId,
      text: lines.join('\n').slice(0, 4000),
      disable_web_page_preview: true,
    };

    const abort = AbortSignal.timeout(TIMEOUT_MS);
    try {
      const response = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: abort,
      });

      let accepted = false;
      let description = '';
      try {
        const body = (await response.json()) as { ok?: unknown; description?: unknown };
        accepted = body.ok === true;
        description = typeof body.description === 'string' ? body.description : '';
      } catch {
        accepted = false;
      }

      if (!response.ok || !accepted) {
        const detail = this.scrub(
          `telegram answered ${response.status}${description ? ` (${description})` : ''}`,
        );
        this.logger.error(`Alert '${alert.key}' was not accepted by Telegram: ${detail}`);
        return { delivered: false, detail };
      }
      return { delivered: true, detail: `telegram answered ${response.status}` };
    } catch (err) {
      const detail = this.scrub(
        `telegram unreachable: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.logger.error(`Alert '${alert.key}' could not be delivered: ${detail}`);
      return { delivered: false, detail };
    }
  }

  /** Never let the bot token out, whatever a library put in its message. */
  private scrub(text: string): string {
    return this.botToken ? text.split(this.botToken).join('***') : text;
  }
}
