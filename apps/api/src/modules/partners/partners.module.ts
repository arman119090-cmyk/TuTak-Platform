import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { MediaModule } from '../media/media.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { PartnerIntegrationsController } from './partner-integrations.controller';
import { PartnerIntegrationsService } from './partner-integrations.service';
import { PartnersController } from './partners.controller';
import { PartnersService } from './partners.service';
import { PartnerBranchStaffController, PartnerStaffController } from './partner-branch-staff.controller';
import { PartnerBranchStaffService } from './partner-branch-staff.service';
import { PartnerBranchQrController, PartnerBranchQrResolveController } from './partner-branch-qr.controller';
import { PartnerBranchQrService } from './partner-branch-qr.service';

@Module({
  imports: [AuditModule, MediaModule, TransactionsModule],
  controllers: [
    PartnersController,
    PartnerIntegrationsController,
    PartnerBranchStaffController,
    PartnerStaffController,
    PartnerBranchQrController,
    PartnerBranchQrResolveController,
  ],
  providers: [PartnersService, PartnerIntegrationsService, PartnerBranchStaffService, PartnerBranchQrService],
  exports: [PartnersService],
})
export class PartnersModule {}
