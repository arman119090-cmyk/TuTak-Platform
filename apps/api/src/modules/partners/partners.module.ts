import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { MediaModule } from '../media/media.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { PartnerIntegrationsController } from './partner-integrations.controller';
import { PartnerIntegrationsService } from './partner-integrations.service';
import { PartnersController } from './partners.controller';
import { PartnersService } from './partners.service';
import {
  PartnerBranchStaffController,
  PartnerStaffController,
} from './partner-branch-staff.controller';
import { PartnerBranchStaffService } from './partner-branch-staff.service';
import { PartnerEmployeeController } from './partner-employee.controller';
import { PartnerEmployeeService } from './partner-employee.service';
import {
  PartnerBranchQrController,
  PartnerBranchQrResolveController,
} from './partner-branch-qr.controller';
import { PartnerBranchQrService } from './partner-branch-qr.service';
import {
  PartnerContributionRuleController,
  PartnerOwnContributionRuleController,
} from './contribution/partner-contribution-rule.controller';
import { PartnerContributionRuleService } from './contribution/partner-contribution-rule.service';

@Module({
  imports: [AuditModule, MediaModule, TransactionsModule],
  controllers: [
    PartnersController,
    PartnerIntegrationsController,
    PartnerBranchStaffController,
    PartnerStaffController,
    PartnerEmployeeController,
    PartnerBranchQrController,
    PartnerBranchQrResolveController,
    PartnerContributionRuleController,
    PartnerOwnContributionRuleController,
  ],
  providers: [
    PartnersService,
    PartnerIntegrationsService,
    PartnerBranchStaffService,
    PartnerEmployeeService,
    PartnerBranchQrService,
    PartnerContributionRuleService,
  ],
  exports: [PartnersService, PartnerContributionRuleService, PartnerEmployeeService],
})
export class PartnersModule {}
