import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { PartnerIntegrationsController } from './partner-integrations.controller';
import { PartnerIntegrationsService } from './partner-integrations.service';
import { PartnersController } from './partners.controller';
import { PartnersService } from './partners.service';

@Module({
  imports: [AuditModule, TransactionsModule],
  controllers: [PartnersController, PartnerIntegrationsController],
  providers: [PartnersService, PartnerIntegrationsService],
  exports: [PartnersService],
})
export class PartnersModule {}
