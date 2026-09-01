import { isProductionDeployment } from '../../config/app-environment';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { LedgerModule } from '../ledger/ledger.module';
import { PartnersModule } from '../partners/partners.module';
import { WalletModule } from '../wallet/wallet.module';
import { AuditModule } from '../audit/audit.module';
import { PaymentsController } from './payments.controller';
import { RefundsController } from './refunds.controller';
import { PaymentEngineService } from './payment-engine.service';
import { RefundEngineService } from './refund-engine.service';
import { PSP_ADAPTER } from './psp-adapter.interface';
import { SandboxPspAdapter } from './sandbox-psp.adapter';

/**
 * `PaymentsController`/`RefundsController` are live HTTP surfaces — `POST
 * /payments` and `POST /refunds` are both reachable today, JWT-guarded. This
 * comment previously claimed otherwise; corrected during the 2026-08
 * hardening pass after the discrepancy was flagged in an entry-point audit.
 */
@Module({
  imports: [LedgerModule, PartnersModule, WalletModule, AuditModule],
  controllers: [PaymentsController, RefundsController],
  providers: [
    PaymentEngineService,
    RefundEngineService,
    SandboxPspAdapter,
    {
      provide: PSP_ADAPTER,
      inject: [ConfigService, SandboxPspAdapter],
      useFactory: (config: ConfigService<AppConfig, true>, sandbox: SandboxPspAdapter) => {
        // Same discipline as SmsModule: a fake acquirer that quietly
        // approved every charge in production would be a lot worse than a
        // process that refuses to start.
        //
        // Demo mode is the one exception, and it is not a loophole: it is an
        // explicit variable, it is announced at boot, and `/health` reports
        // it, so a deployment cannot be running on a fake acquirer without
        // saying so to anyone who asks. A demonstration has to charge
        // something; what it must never do is let anyone believe the charge
        // was real.
        const isProduction = isProductionDeployment(config.get('appEnv', { infer: true }));
        if (isProduction && !config.get('demoMode', { infer: true })) {
          throw new Error(
            'PaymentsModule: no production PSP adapter is configured. Refusing to boot ' +
              'with the sandbox adapter in production — see docs/FINANCIAL_CORE_DESIGN.md. ' +
              'For a public demonstration set DEMO_MODE=true, which permits the sandbox ' +
              'and announces itself.',
          );
        }
        return sandbox;
      },
    },
  ],
  exports: [PaymentEngineService, RefundEngineService],
})
export class PaymentsModule {}
