import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuditAction } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UuidParam } from '../../common/decorators/uuid-param.decorator';
import { assertPartnerOwner, assertPartnerScope } from '../../common/auth/partner-scope';
import { assertBranchScope } from '../../common/auth/branch-scope';
import { RequestUser } from '../auth/types/request-user.type';
import { AuditService } from '../audit/audit.service';
import { PartnerBranchQrService } from './partner-branch-qr.service';

/**
 * A branch's own scan-to-pay QR — issue/rotate/revoke are owner-only (the
 * same trust tier as creating the branch itself); viewing the current code
 * is open to anyone actually scoped to the branch, so a manager can pull it
 * up to print or display without needing the owner every time.
 */
@ApiTags('partner-branch-qr')
@ApiBearerAuth()
@Controller('partners/:id/branches/:branchId/qr')
export class PartnerBranchQrController {
  constructor(
    private readonly qrService: PartnerBranchQrService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async getActive(
    @CurrentUser() user: RequestUser,
    @UuidParam('id') partnerId: string,
    @UuidParam('branchId') branchId: string,
  ) {
    assertBranchScope(user, partnerId, branchId);
    return this.qrService.getActive(partnerId, branchId);
  }

  @Post()
  async issue(
    @CurrentUser() user: RequestUser,
    @UuidParam('id') partnerId: string,
    @UuidParam('branchId') branchId: string,
  ) {
    assertPartnerScope(user, partnerId);
    assertPartnerOwner(user, partnerId, 'issue a branch QR code');
    const qr = await this.qrService.issue(partnerId, branchId, user.id);
    await this.auditService.record({
      actorUserId: user.id,
      action: AuditAction.BRANCH_QR_ISSUED,
      entityType: 'PartnerBranchQrCode',
      entityId: qr.id,
      metadata: { partnerId, branchId },
    });
    return qr;
  }

  @Post('rotate')
  async rotate(
    @CurrentUser() user: RequestUser,
    @UuidParam('id') partnerId: string,
    @UuidParam('branchId') branchId: string,
  ) {
    assertPartnerScope(user, partnerId);
    assertPartnerOwner(user, partnerId, 'rotate a branch QR code');
    const qr = await this.qrService.rotate(partnerId, branchId, user.id);
    await this.auditService.record({
      actorUserId: user.id,
      action: AuditAction.BRANCH_QR_ISSUED,
      entityType: 'PartnerBranchQrCode',
      entityId: qr.id,
      metadata: { partnerId, branchId, op: 'rotate' },
    });
    return qr;
  }

  @Post('revoke')
  async revoke(
    @CurrentUser() user: RequestUser,
    @UuidParam('id') partnerId: string,
    @UuidParam('branchId') branchId: string,
  ) {
    assertPartnerScope(user, partnerId);
    assertPartnerOwner(user, partnerId, 'revoke a branch QR code');
    const qr = await this.qrService.revoke(partnerId, branchId, user.id);
    await this.auditService.record({
      actorUserId: user.id,
      action: AuditAction.BRANCH_QR_REVOKED,
      entityType: 'PartnerBranchQrCode',
      entityId: qr.id,
      metadata: { partnerId, branchId },
    });
    return qr;
  }
}

/**
 * Customer-facing resolution — a scan learns only `{partnerId,
 * partnerBranchId}` (plus display names), never an amount or rate. Any
 * authenticated user may resolve any token: the token itself is the only
 * secret, exactly like `QrCode.token`, and resolving it reveals nothing an
 * unauthenticated passerby couldn't already read off the branch's own
 * printed/displayed code.
 */
@ApiTags('partner-branch-qr')
@ApiBearerAuth()
@Controller('partner-branch-qr')
export class PartnerBranchQrResolveController {
  constructor(private readonly qrService: PartnerBranchQrService) {}

  @Get('resolve/:token')
  resolve(@Param('token') token: string) {
    return this.qrService.resolve(token);
  }
}
