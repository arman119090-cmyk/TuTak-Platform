import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import configuration, { AppConfig } from './config/configuration';
import { validate } from './config/env.validation';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { QueueModule } from './infrastructure/queue/queue.module';
import { SmsModule } from './infrastructure/sms/sms.module';
import { PushModule } from './infrastructure/push/push.module';
import { AlertsModule } from './infrastructure/alerts/alerts.module';

import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RequestContextMiddleware } from './common/observability/request-context.middleware';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { PasswordRotationGuard } from './common/guards/password-rotation.guard';

import { AuditModule } from './modules/audit/audit.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { ReferralModule } from './modules/referral/referral.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { PartnersModule } from './modules/partners/partners.module';
import { PurchaseIntentsModule } from './modules/purchase-intents/purchase-intents.module';
import { QrPaymentsModule } from './modules/qr-payments/qr-payments.module';
import { EvChargingModule } from './modules/ev-charging/ev-charging.module';
import { AdminModule } from './modules/admin/admin.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { SecurityModule } from './modules/security/security.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { SettlementModule } from './modules/settlement/settlement.module';
import { PayoutsModule } from './modules/payouts/payouts.module';
import { ReconciliationModule } from './modules/reconciliation/reconciliation.module';
import { HealthModule } from './modules/health/health.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { SweepsModule } from './modules/sweeps/sweeps.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], validate }),
    EventEmitterModule.forRoot(),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        throttlers: [
          {
            ttl: config.get('rateLimit.ttlSeconds', { infer: true }) * 1000,
            limit: config.get('rateLimit.maxRequests', { infer: true }),
          },
        ],
      }),
    }),
    PrismaModule,
    RedisModule,
    QueueModule,
    SmsModule,
    PushModule,
    AlertsModule,

    AuditModule,
    UsersModule,
    AuthModule,
    WalletModule,
    ReferralModule,
    TransactionsModule,
    PartnersModule,
    PurchaseIntentsModule,
    QrPaymentsModule,
    EvChargingModule,
    AdminModule,
    NotificationsModule,
    AnalyticsModule,
    SecurityModule,
    LedgerModule,
    PaymentsModule,
    SettlementModule,
    PayoutsModule,
    ReconciliationModule,
    // Last, and deliberately: it depends on the domain modules above rather
    // than the other way round, so nothing in the request path can reach a
    // queue by accident.
    SweepsModule,
    HealthModule,
    MetricsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: PasswordRotationGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
  ],
})
export class AppModule implements NestModule {
  /**
   * Applied to every route including the health probes: a probe that starts
   * failing is exactly when the correlation id is most wanted.
   */
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
