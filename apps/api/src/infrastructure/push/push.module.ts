import { isProductionDeployment } from '../../config/app-environment';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { ConsolePushProvider } from './console-push.provider';
import { ExpoPushProvider } from './expo-push.provider';
import { PUSH_PROVIDER } from './push-provider.interface';

@Global()
@Module({
  providers: [
    {
      provide: PUSH_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const push = config.get('push', { infer: true });
        const isProduction = isProductionDeployment(config.get('appEnv', { infer: true }));

        if (!push.enabled) {
          // Same discipline as SMS. A deployment that quietly logged
          // notifications instead of delivering them would look healthy
          // while every customer wondered why their phone stayed silent —
          // and unlike a verification code, nobody reports the absence.
          //
          // Exempt in demo mode alongside the acquirer and the carrier: a
          // demonstration has no push credentials either, and there is
          // nobody waiting for a notification that never arrives. This one
          // was found by trying to boot a demo rather than by reading the
          // code, which is the argument for booting it.
          if (isProduction && !config.get('demoMode', { infer: true })) {
            throw new Error(
              'PUSH_ENABLED must be true in production, with PUSH_ENDPOINT configured — ' +
                'notifications cannot be delivered otherwise.',
            );
          }
          return new ConsolePushProvider();
        }

        return new ExpoPushProvider({
          endpoint: push.endpoint,
          accessToken: push.accessToken,
        });
      },
    },
  ],
  exports: [PUSH_PROVIDER],
})
export class PushModule {}
