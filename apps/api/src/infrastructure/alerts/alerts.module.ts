import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { ALERT_CHANNEL } from './alert-channel.interface';
import { AlertsService } from './alerts.service';
import { ConsoleAlertChannel } from './console-alert.channel';
import { WebhookAlertChannel } from './webhook-alert.channel';

@Global()
@Module({
  providers: [
    {
      provide: ALERT_CHANNEL,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const alerts = config.get('alerts', { infer: true });
        const environment = config.get('nodeEnv', { infer: true });
        const logger = new Logger('AlertsModule');

        if (!alerts.webhookUrl) {
          // Unlike SMS and push, this does *not* refuse to boot.
          //
          // Those two are how a customer receives something, and a
          // deployment that silently swallows them looks healthy while every
          // customer wonders why their phone stayed quiet. Alerting is
          // different in one specific way: refusing to serve payments
          // because the notification webhook is unset would trade a real
          // outage for a monitoring gap, and the platform would be down at
          // exactly the moment the operator was trying to fix the webhook.
          //
          // So it boots — loudly. This message is at `warn` in production on
          // purpose: it should be the first thing in the log of any
          // deployment that nobody is watching.
          if (environment === 'production') {
            logger.warn(
              'ALERT_WEBHOOK_URL is not set. Reconciliation discrepancies, dead-lettered ' +
                'outbox events and failed background jobs will be logged and nothing more — ' +
                'no one will be told. Set it before taking real money.',
            );
          }
          return new ConsoleAlertChannel();
        }

        logger.log(`Alerts will be delivered by webhook (${environment})`);
        return new WebhookAlertChannel(alerts.webhookUrl, environment);
      },
    },
    AlertsService,
  ],
  exports: [ALERT_CHANNEL, AlertsService],
})
export class AlertsModule {}
