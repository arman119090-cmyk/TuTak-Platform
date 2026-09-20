import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { Env, loadEnv } from './config/env';
import { AppExceptionFilter } from './common/error.filter';
import { RequestContextMiddleware } from './common/request-context.middleware';
import { CoreModule } from './core.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './modules/audit/audit.module';
import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { AutoPayoutModule } from './modules/auto-payout/auto-payout.module';
import { DriverAuthGuard } from './modules/auth/auth.guard';
import { DriverIdModule } from './modules/driver-id/driver-id.module';
import { DriversModule } from './modules/drivers/drivers.module';
import { FeesModule } from './modules/fees/fees.module';
import { HealthModule } from './modules/health/health.module';
import { HistoryModule } from './modules/history/history.module';
import { IdramModule } from './modules/idram/idram.module';
import { IntegrationHealthModule } from './modules/integration-health/integration-health.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { LimitsModule } from './modules/limits/limits.module';
import { NotificationModule } from './modules/notifications/notification.module';
import { ObservabilityModule } from './modules/observability/observability.module';
import { PaymentProviderModule } from './modules/payment-provider/payment-provider.module';
import { ParksModule } from './modules/parks/parks.module';
import { PayoutMethodsModule } from './modules/payout-methods/payout-methods.module';
import { ReconciliationModule } from './modules/reconciliation/reconciliation.module';
import { SecurityModule } from './modules/security/security.module';
import { WithdrawalsModule } from './modules/withdrawals/withdrawals.module';
import { YandexModule } from './modules/yandex/yandex.module';

export interface AppModuleOptions {
  readonly env?: Env;
  /** Tests disable the cron scheduler and drive the worker explicitly. */
  readonly enableScheduler?: boolean;
}

@Module({})
export class AppModule implements NestModule {
  static register(options: AppModuleOptions = {}) {
    const env = options.env ?? loadEnv();
    const enableScheduler = options.enableScheduler ?? env.NODE_ENV !== 'test';

    return {
      module: AppModule,
      imports: [
        CoreModule.forRoot(env),
        ...(enableScheduler ? [ScheduleModule.forRoot()] : []),
        PrismaModule,
        CryptoModule,
        AuditModule,
        IntegrationHealthModule,
        NotificationModule,
        AuthModule,
        ParksModule,
        DriversModule,
        DriverIdModule,
        PayoutMethodsModule,
        IdramModule,
        SecurityModule,
        WithdrawalsModule,
        AutoPayoutModule,
        HistoryModule,
        LedgerModule,
        FeesModule,
        LimitsModule,
        YandexModule,
        PaymentProviderModule,
        ReconciliationModule,
        AdminModule,
        HealthModule,
        ObservabilityModule,
      ],
      providers: [
        // Authentication is on by default; `@Public()` is the exception.
        { provide: APP_GUARD, useClass: DriverAuthGuard },
        { provide: APP_FILTER, useClass: AppExceptionFilter },
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
