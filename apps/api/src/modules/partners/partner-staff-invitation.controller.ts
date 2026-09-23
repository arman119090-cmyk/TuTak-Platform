import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuditAction } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UuidParam } from '../../common/decorators/uuid-param.decorator';
import { assertPartnerOwner, assertPartnerScope } from '../../common/auth/partner-scope';
import { RequestUser } from '../auth/types/request-user.type';
import { AuditService } from '../audit/audit.service';
import {
  AcceptPartnerStaffInvitationDto,
  InvitePartnerStaffDto,
} from './dto/invite-partner-staff.dto';
import { PartnerStaffInvitationService } from './partner-staff-invitation.service';

/**
 * Inviting people to work at a partner.
 *
 * Owner-only throughout: this is the route that hands out access to a
 * business's money, and a manager who could invite could invite themselves a
 * second role. Every action is written to the audit log with the invitation's
 * id and never its token.
 */
@ApiTags('partner-staff-invitations')
@ApiBearerAuth()
@Controller('partners/:id/invitations')
export class PartnerStaffInvitationController {
  constructor(
    private readonly invitations: PartnerStaffInvitationService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@CurrentUser() user: RequestUser, @UuidParam('id') partnerId: string) {
    assertPartnerScope(user, partnerId);
    assertPartnerOwner(user, partnerId, 'see staff invitations');
    return this.invitations.list(partnerId);
  }

  @Post()
  async invite(
    @CurrentUser() user: RequestUser,
    @UuidParam('id') partnerId: string,
    @Body() dto: InvitePartnerStaffDto,
  ) {
    assertPartnerScope(user, partnerId);
    assertPartnerOwner(user, partnerId, 'invite staff');
    const invitation = await this.invitations.invite({
      partnerId,
      phone: dto.phone,
      role: dto.role,
      branchIds: dto.branchIds ?? [],
      createdByUserId: user.id,
    });
    await this.audit.record({
      actorUserId: user.id,
      action: AuditAction.PARTNER_UPDATED,
      entityType: 'PartnerStaffInvitation',
      entityId: invitation.id,
      // The role and the branches, because those are what an auditor needs to
      // see. Not the phone, and never the token.
      metadata: { partnerId, op: 'invite', role: invitation.role, branches: invitation.branchIds.length },
    });
    return invitation;
  }

  @Post(':invitationId/resend')
  async resend(
    @CurrentUser() user: RequestUser,
    @UuidParam('id') partnerId: string,
    @UuidParam('invitationId') invitationId: string,
  ) {
    assertPartnerScope(user, partnerId);
    assertPartnerOwner(user, partnerId, 'resend a staff invitation');
    const replacement = await this.invitations.resend(partnerId, invitationId, user.id);
    await this.audit.record({
      actorUserId: user.id,
      action: AuditAction.PARTNER_UPDATED,
      entityType: 'PartnerStaffInvitation',
      entityId: replacement.id,
      metadata: { partnerId, op: 'resend', replaced: invitationId },
    });
    return replacement;
  }

  @Post(':invitationId/revoke')
  async revoke(
    @CurrentUser() user: RequestUser,
    @UuidParam('id') partnerId: string,
    @UuidParam('invitationId') invitationId: string,
  ) {
    assertPartnerScope(user, partnerId);
    assertPartnerOwner(user, partnerId, 'revoke a staff invitation');
    const revoked = await this.invitations.revoke(partnerId, invitationId, user.id);
    await this.audit.record({
      actorUserId: user.id,
      action: AuditAction.PARTNER_UPDATED,
      entityType: 'PartnerStaffInvitation',
      entityId: invitationId,
      metadata: { partnerId, op: 'revoke' },
    });
    return revoked;
  }
}

/**
 * The other end: the invited person accepting.
 *
 * Not under `partners/:id`, because the caller does not know which partner
 * invited them until the token is resolved — and letting them name one would
 * be letting them choose.
 *
 * Authenticated, because the acceptance has to be tied to a person who has
 * proved they hold the invited phone number. The ordinary OTP login does
 * that proving; this route only insists the two numbers match.
 */
@ApiTags('partner-staff-invitations')
@ApiBearerAuth()
@Controller('partner-invitations')
export class PartnerStaffInvitationAcceptController {
  constructor(
    private readonly invitations: PartnerStaffInvitationService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The rate limit here is a second fence, not the first.
   *
   * Behind a shared proxy the per-address limiter stands down deliberately
   * (`client-ip-throttler.guard.ts` explains why locking everybody out is
   * worse than not limiting). What actually bounds guessing is the token's
   * 256 bits and the per-invitation attempt ceiling, neither of which depends
   * on telling callers apart.
   */
  @Post('accept')
  @Throttle({ default: { limit: 10, ttl: 300_000 } })
  async accept(
    @CurrentUser() user: RequestUser,
    @Body() dto: AcceptPartnerStaffInvitationDto,
  ) {
    const granted = await this.invitations.accept({
      token: dto.token,
      acceptorUserId: user.id,
      acceptorPhone: user.phone,
    });
    await this.audit.record({
      actorUserId: user.id,
      action: AuditAction.PARTNER_UPDATED,
      entityType: 'PartnerStaffInvitation',
      entityId: granted.partnerId,
      metadata: { op: 'accept', role: granted.role, branches: granted.branchIds.length },
    });
    return granted;
  }
}
