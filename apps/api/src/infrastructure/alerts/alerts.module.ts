import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { ALERT_CHANNEL } from './alert-channel.interface';
import { AlertsService } from './alerts.service';
import { AlertChannel } from './alert-channel.interface';
import { CompositeAlertChannel } from './composite-alert.channel';
import { ConsoleAlertChannel } from './console-alert.channel';
import { TelegramAlertChannel } from './telegram-alert.channel';
import { WebhookAlertChannel } from './webhook-alert.channel';

@Global()
@Module({
  providers: [
    {
      provide: ALERT_CHANNEL,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const alerts = config.get('alerts', { infer: true });
        const environment = config.get('appEnv', { infer: true });
        const logger = new Logger('AlertsModule');

        const channels: AlertChannel[] = [];
        if (alerts.webhookUrl) channels.push(new WebhookAlertChannel(alerts.webhookUrl, environment));
        if (alerts.telegramBotToken && alerts.telegramChatId) {
          channels.push(new TelegramAlertChannel(alerts.telegramBotToken, alerts.telegramChatId, environment));
        }

        if (channels.length === 0) {
          // Unlike SMS and push, this does *not* refuse to boot.
          //
          // Those two are how a customer receives something, and a
          // deployment that silently swallows them looks healthy while every
          // customer wonders why their phone stayed quiet. Alerting is
          // different in one specific way: refusing to serve payments
          // because the notification channel is unset would trade a real
          // outage for a monitoring gap, and the platform would be down at
          // exactly the moment the operator was trying to fix it.
          //
          // So it boots — loudly. This message is at `warn` in production on
          // purpose: it should be the first thing in the log of any
          // deployment that nobody is watching.
          if (environment === 'production') {
            logger.warn(
              'Neither ALERT_WEBHOOK_URL nor ALERT_TELEGRAM_BOT_TOKEN+ALERT_TELEGRAM_CHAT_ID is set. ' +
                'Reconciliation discrepancies, dead-lettered outbox events and failed background jobs ' +
                'will be logged and nothing more — no one will be told. Set one before taking real money.',
            );
          }
          return new ConsoleAlertChannel();
        }

        const channel = channels.length === 1 ? channels[0]! : new CompositeAlertChannel(channels);
        logger.log(`Alerts will be delivered by ${channel.name} (${environment})`);
        return channel;
      },
    },
    AlertsService,
  ],
  exports: [ALERT_CHANNEL, AlertsService],
})
export class AlertsModule {}
