import { Global, Module } from '@nestjs/common';
import { ENV, Env } from '../../config/env';
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
      inject: [ENV, NotificationMockAdapter],
      useFactory: (env: Env, mock: NotificationMockAdapter) => {
        if (env.PUSH_MODE === 'live') {
          throw new Error(
            'PUSH_MODE=live is set, but no live push adapter is implemented. ' +
              'Implement NotificationPort for the chosen push service and register it here.',
          );
        }
        return mock;
      },
    },
    NotificationService,
  ],
  exports: [NotificationService, NotificationPort, NotificationMockAdapter],
})
export class NotificationModule {}
