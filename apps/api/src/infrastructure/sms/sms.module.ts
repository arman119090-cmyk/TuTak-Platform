import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { RedisModule } from '../redis/redis.module';
import { BudgetedSmsProvider } from './budgeted-sms.provider';
import { SmsBudgetService } from './sms-budget.service';
import { selectSmsTransport } from './sms-transport';
import { SMS_PROVIDER } from './sms-provider.interface';

@Global()
@Module({
  imports: [RedisModule],
  providers: [
    SmsBudgetService,
    {
      provide: SMS_PROVIDER,
      inject: [ConfigService, SmsBudgetService],
      useFactory: (config: ConfigService<AppConfig, true>, budget: SmsBudgetService) => {
        const sms = config.get('sms', { infer: true });

        const transport = selectSmsTransport({
          appEnv: config.get('appEnv', { infer: true }),
          demoMode: config.get('demoMode', { infer: true }),
          endpoint: sms.endpoint,
          authScheme: sms.authScheme,
          username: sms.username,
          token: sms.token,
          sender: sms.sender,
          encoding: sms.encoding,
        });

        // Every send, on every transport, draws on the same global ceiling —
        // including the console one, so a local run exercises the same path
        // production takes rather than a shortcut around it.
        return new BudgetedSmsProvider(transport, budget);
      },
    },
  ],
  exports: [SMS_PROVIDER, SmsBudgetService],
})
export class SmsModule {}
