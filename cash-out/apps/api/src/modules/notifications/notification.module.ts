import { Global, Module } from '@nestjs/common';
import { ENV, Env } from '../../config/env';
import { AppLogger } from '../../common/logging/logger.service';
import { IntegrationHealthRecorder } from '../integration-health/integration-health.recorder';
import { ExpoPushAdapter } from './expo-push.adapter';
import { NotificationMockAdapter } from './notification-mock.adapter';
import { NotificationController } from './notification.controller';
import { NotificationPort } from './notification.port';
import { NotificationService } from './notification.service';

/**
 * Global, because every module that changes something the driver should hear
 * about enqueues through it. The port resolves to the mock until a push
 * provider exists; `PUSH_MODE=live` refuses to start rather than pretend.
 */
@Global()
@Module({
  controllers: [NotificationController],
  providers: [
    NotificationMockAdapter,
    {
      provide: NotificationPort,
      inject: [ENV, NotificationMockAdapter, AppLogger, IntegrationHealthRecorder],
      useFactory: (
        env: Env,
        mock: NotificationMockAdapter,
        logger: AppLogger,
        health: IntegrationHealthRecorder,
      ) => {
        if (env.PUSH_MODE !== 'live') return mock;
        if (env.PUSH_PROVIDER === 'expo') {
          return new ExpoPushAdapter(
            { accessToken: env.EXPO_ACCESS_TOKEN, timeoutMs: env.PUSH_TIMEOUT_MS },
            logger,
            health,
          );
        }
        throw new Error(
          `PUSH_MODE=live with PUSH_PROVIDER=${env.PUSH_PROVIDER ?? '(unset)'}: no adapter. ` +
            'Implement NotificationPort for the provider and register it here.',
        );
      },
    },
    NotificationService,
  ],
  exports: [NotificationService, NotificationPort, NotificationMockAdapter],
})
export class NotificationModule {}
