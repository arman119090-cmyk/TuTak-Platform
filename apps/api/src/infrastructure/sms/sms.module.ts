import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { ConsoleSmsProvider } from './console-sms.provider';
import { HttpSmsProvider } from './http-sms.provider';
import { SMS_PROVIDER } from './sms-provider.interface';

@Global()
@Module({
  providers: [
    {
      provide: SMS_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const sms = config.get('sms', { infer: true });
        const isProduction = config.get('nodeEnv', { infer: true }) === 'production';

        if (!sms.endpoint) {
          // Refusing to boot is the point. A production deployment that falls
          // back to logging codes would appear healthy while every user who
          // needed a verification or reset code was silently locked out.
          //
          // A demonstration has no carrier contract either, and the same
          // lockout applies there — which is why the demo is seeded with
          // accounts that are already verified, and why the walkthrough tells
          // whoever is looking to sign in with one rather than register.
          // See docs/INVESTOR_DEMO_RU.md.
          if (isProduction && !config.get('demoMode', { infer: true })) {
            throw new Error(
              'SMS_ENDPOINT must be configured in production — verification and password ' +
                'reset codes cannot be delivered without a carrier.',
            );
          }
          return new ConsoleSmsProvider();
        }

        return new HttpSmsProvider({
          endpoint: sms.endpoint,
          authScheme: sms.authScheme,
          username: sms.username,
          password: sms.token,
          sender: sms.sender,
          encoding: sms.encoding,
        });
      },
    },
  ],
  exports: [SMS_PROVIDER],
})
export class SmsModule {}
