import { Module, forwardRef } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PartnersModule } from '../partners/partners.module';
import { SecurityModule } from '../security/security.module';
import { AuthModule } from '../auth/auth.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { WalletModule } from '../wallet/wallet.module';
import { QrPaymentsController } from './qr-payments.controller';
import { QrPaymentsService } from './qr-payments.service';

@Module({
  imports: [
    WalletModule,
    TransactionsModule,
    PartnersModule,
    AuditModule,
    SecurityModule,
    forwardRef(() => AuthModule),
  ],
  controllers: [QrPaymentsController],
  providers: [QrPaymentsService],
  exports: [QrPaymentsService],
})
export class QrPaymentsModule {}
