import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionName } from '@prisma/client';
import { assertPartnerScope } from '../../../common/auth/partner-scope';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { UuidParam } from '../../../common/decorators/uuid-param.decorator';
import { RequestUser } from '../../auth/types/request-user.type';
import {
  DecideContributionRuleDto,
  ProposeContributionRuleDto,
  RejectContributionRuleDto,
} from './dto/contribution-rule.dto';
import { PartnerContributionRuleService } from './partner-contribution-rule.service';

/**
 * A partner's commercial terms, proposed by one person and approved by
 * another.
 *
 * Two permissions rather than one, and that is the point: `..._PROPOSE` and
 * `..._APPROVE` are separate grants, so "two different people" can be
 * arranged by role and is not left to comparing user ids at the last moment.
 * The id comparison still happens — in the service and again in the database
 * — because roles are a policy and the constraint is a guarantee.
 */
@ApiTags('contribution-rules')
@ApiBearerAuth()
@Controller('admin/partners/:partnerId/contribution-rules')
export class PartnerContributionRuleController {
  constructor(private readonly rules: PartnerContributionRuleService) {}

  /** Everything ever agreed, oldest first. The audit answer to "since when". */
  @Get()
  @RequirePermissions(PermissionName.CONTRIBUTION_RULE_PROPOSE)
  async history(@UuidParam('partnerId') partnerId: string) {
    return this.rules.history(partnerId);
  }

  @Get('current')
  @RequirePermissions(PermissionName.CONTRIBUTION_RULE_PROPOSE)
  async current(@UuidParam('partnerId') partnerId: string) {
    return this.rules.liveRule(partnerId);
  }

  @Get('pending')
  @RequirePermissions(PermissionName.CONTRIBUTION_RULE_APPROVE)
  async pending(@UuidParam('partnerId') partnerId: string) {
    return this.rules.pendingProposals(partnerId);
  }

  @Post()
  @RequirePermissions(PermissionName.CONTRIBUTION_RULE_PROPOSE)
  async propose(
    @CurrentUser() actor: RequestUser,
    @UuidParam('partnerId') partnerId: string,
    @Body() dto: ProposeContributionRuleDto,
  ) {
    return this.rules.propose({
      partnerId,
      actorId: actor.id,
      kind: dto.kind,
      percentBps: dto.percentBps,
      fixedPerUnit: dto.fixedPerUnit,
      unit: dto.unit,
      note: dto.note,
    });
  }

  /** The act that changes what a purchase costs. Never the proposer. */
  @Post(':ruleId/approve')
  @RequirePermissions(PermissionName.CONTRIBUTION_RULE_APPROVE)
  async approve(
    @CurrentUser() actor: RequestUser,
    @UuidParam('ruleId') ruleId: string,
    @Body() dto: DecideContributionRuleDto,
  ) {
    return this.rules.approve(ruleId, { actorId: actor.id, note: dto.note });
  }

  @Post(':ruleId/reject')
  @RequirePermissions(PermissionName.CONTRIBUTION_RULE_APPROVE)
  async reject(
    @CurrentUser() actor: RequestUser,
    @UuidParam('ruleId') ruleId: string,
    @Body() dto: RejectContributionRuleDto,
  ) {
    return this.rules.reject(ruleId, { actorId: actor.id, reason: dto.reason });
  }
}

/**
 * What a partner may see of their own terms: everything, and nothing they
 * can change.
 *
 * Reading is not a courtesy — a partner disputing a settlement needs to be
 * able to see the rate it was calculated at and since when. Activating terms
 * is not theirs: they are the counterparty, and a counterparty who can
 * approve their own rate is a counterparty who sets it.
 */
@ApiTags('contribution-rules')
@ApiBearerAuth()
@Controller('partner/contribution-rules')
export class PartnerOwnContributionRuleController {
  constructor(private readonly rules: PartnerContributionRuleService) {}

  @Get(':partnerId')
  async mine(@CurrentUser() actor: RequestUser, @UuidParam('partnerId') partnerId: string) {
    assertPartnerScope(actor, partnerId);
    // Proposals are deliberately excluded: an unapproved proposal is an
    // internal conversation, and showing a partner a rate somebody is
    // considering would be showing them a rate that may never exist.
    const history = await this.rules.history(partnerId);
    return history.filter((rule) => rule.status !== 'PROPOSED' && rule.status !== 'REJECTED');
  }
}
