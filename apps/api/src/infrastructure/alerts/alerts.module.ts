import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { ALERT_CHANNEL, AlertChannel } from './alert-channel.interface';
import { AlertsService } from './alerts.service';
import { ConsoleAlertChannel } from './console-alert.channel';
import { TelegramAlertChannel } from './telegram-alert.channel';
import { WebhookAlertChannel } from './webhook-alert.channel';

/**
 * Which channel a deployment gets, from its configuration alone.
 *
 * Exported so the selection can be tested without booting a Nest module:
 * the bug this guards against (26.09.2026) was a channel that the operator
 * had configured and the platform did not know about — variables set,
 * console chosen, nobody told. Precedence: webhook, then a complete Telegram
 * pair, then the console. Half a Telegram pair is an error, not a channel.
 */
export function selectAlertChannel(
  alerts: AppConfig['alerts'],
  environment: string,
  logger: Pick<Logger, 'log' | 'warn' | 'error'> = new Logger('AlertsModule'),
): AlertChannel {
  if (alerts.webhookUrl) {
    logger.log(`Alerts will be delivered by webhook (${environment})`);
    return new WebhookAlertChannel(alerts.webhookUrl, environment);
  }

  // Telegram is the second real channel. Half a pair — a token without a
  // chat, or the reverse — is a misconfiguration, not a channel, and is said
  // so rather than silently becoming the console.
  if (alerts.telegramBotToken || alerts.telegramChatId) {
    if (alerts.telegramBotToken && alerts.telegramChatId) {
      logger.log(`Alerts will be delivered by Telegram (${environment})`);
      return new TelegramAlertChannel(alerts.telegramBotToken, alerts.telegramChatId, environment);
    }
    logger.error(
      'Only one of ALERT_TELEGRAM_BOT_TOKEN / ALERT_TELEGRAM_CHAT_ID is set; both are needed. ' +
        'Falling back to the console — no human will be told.',
    );
    return new ConsoleAlertChannel();
  }

  // Unlike SMS and push, this does *not* refuse to boot.
  //
  // Those two are how a customer receives something, and a deployment that
  // silently swallows them looks healthy while every customer wonders why
  // their phone stayed quiet. Alerting is different in one specific way:
  // refusing to serve payments because the notification channel is unset
  // would trade a real outage for a monitoring gap, and the platform would
  // be down at exactly the moment the operator was trying to fix it.
  //
  // So it boots — loudly. This message is at `warn` in production on
  // purpose: it should be the first thing in the log of any deployment that
  // nobody is watching.
  if (environment === 'production') {
    logger.warn(
      'Neither ALERT_WEBHOOK_URL nor ALERT_TELEGRAM_BOT_TOKEN + ALERT_TELEGRAM_CHAT_ID is set. ' +
        'Reconciliation discrepancies, dead-lettered outbox events and failed background ' +
        'jobs will be logged and nothing more — no one will be told. Set one before taking real money.',
    );
  }
  return new ConsoleAlertChannel();
}

@Global()
@Module({
  providers: [
    {
      provide: ALERT_CHANNEL,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) =>
        selectAlertChannel(
          config.get('alerts', { infer: true }),
          config.get('appEnv', { infer: true }),
        ),
    },
    AlertsService,
  ],
  exports: [ALERT_CHANNEL, AlertsService],
})
export class AlertsModule {}
