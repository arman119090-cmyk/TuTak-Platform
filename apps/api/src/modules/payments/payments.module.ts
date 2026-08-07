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
 * No controllers, matching `LedgerModule`: the payment engine is a service
 * other modules (checkout flows, once they exist) call into, not an HTTP
 * surface of its own yet.
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
        if (config.get('nodeEnv', { infer: true }) === 'production') {
          throw new Error(
            'PaymentsModule: no production PSP adapter is configured. Refusing to boot ' +
              'with the sandbox adapter in production — see docs/FINANCIAL_CORE_DESIGN.md.',
          );
        }
        return sandbox;
      },
    },
  ],
  exports: [PaymentEngineService, RefundEngineService],
})
export class PaymentsModule {}
