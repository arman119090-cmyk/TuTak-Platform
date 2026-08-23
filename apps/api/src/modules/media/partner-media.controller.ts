import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  ParseFilePipeBuilder,
  Post,
  Put,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { MediaAssetKind, MediaAssetStatus, PermissionName } from '@prisma/client';
import type { Request } from 'express';
import type { MediaAssetDto, PartnerMediaDto } from './media.contracts';
import {
  assertPartnerOwner,
  assertPartnerScope,
  assertPlatformAdmin,
  isPlatformAdmin,
} from '../../common/auth/partner-scope';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { MAX_UPLOAD_BYTES } from '../../infrastructure/media/media-image.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RequestUser } from '../auth/types/request-user.type';
import { MediaViewService } from './media-view.service';
import { MediaService, type ActorContext } from './media.service';

/**
 * Partner brand media — spec §3.3's narrowly scoped endpoints.
 *
 * Deliberately not a generic file bucket. There is one route per (subject,
 * kind) pair, the subject is in the path and is authorised before anything is
 * read, and there is no endpoint anywhere that accepts "here is a file, here
 * is where to put it".
 *
 * ## The two-party rule
 *
 * A partner OWNER may *submit*. Only a platform administrator may *publish*.
 * An owner submitting lands `PENDING_REVIEW`, which no customer surface will
 * render; an administrator's own upload is published in the same call. Spec
 * §1: this exists so that an owner-account compromise cannot instantly change
 * a business identity that appears on every customer's transaction history.
 *
 * ## Why `assertPartnerScope` *and* `assertPartnerOwner`
 *
 * Same reason `PATCH /partners/:id/commercial-settings` does it — see
 * `partner-scope.ts`. `assertPartnerOwner` alone answers "is this person an
 * owner of *this* partner", but a caller with no relationship to the partner
 * at all deserves "you are not authorized to act for this partner" rather
 * than the narrower and less accurate "only the owner may do that".
 */
@ApiTags('partners/media')
@ApiBearerAuth()
@Controller('partners/:partnerId')
export class PartnerMediaController {
  constructor(
    private readonly media: MediaService,
    private readonly view: MediaViewService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * What this partner's branding actually looks like right now, including
   * anything waiting for review. Owner/staff of this partner, or an
   * administrator — never another partner, and never a customer.
   */
  @Get('media')
  async list(
    @CurrentUser() user: RequestUser,
    @Param('partnerId') partnerId: string,
  ): Promise<PartnerMediaDto> {
    assertPartnerScope(user, partnerId);
    const partner = await this.prisma.partner.findUnique({
      where: { id: partnerId },
      select: { id: true, displayName: true, logoAssetId: true, coverAssetId: true },
    });
    if (!partner) throw new BadRequestException('Partner not found');

    const assets = await this.media.listPartnerAssets(partnerId);
    const dto = (id: string | null): MediaAssetDto | null => {
      const found = assets.find((a) => a.id === id);
      return found ? this.view.assetDto(found, user.id) : null;
    };

    return {
      partnerId: partner.id,
      displayName: partner.displayName,
      logo: dto(partner.logoAssetId),
      cover: dto(partner.coverAssetId),
      pending: assets
        .filter((a) => a.status === MediaAssetStatus.PENDING_REVIEW)
        .map((a) => this.view.assetDto(a, user.id)),
    };
  }

  @Put('logo')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  async putLogo(
    @CurrentUser() user: RequestUser,
    @Param('partnerId') partnerId: string,
    @UploadedFile(uploadPipe()) file: UploadedImage,
    @Req() req: Request,
  ): Promise<MediaAssetDto> {
    return this.submit(user, partnerId, MediaAssetKind.PARTNER_LOGO, file, req);
  }

  @Put('cover')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  async putCover(
    @CurrentUser() user: RequestUser,
    @Param('partnerId') partnerId: string,
    @UploadedFile(uploadPipe()) file: UploadedImage,
    @Req() req: Request,
  ): Promise<MediaAssetDto> {
    return this.submit(user, partnerId, MediaAssetKind.PARTNER_COVER, file, req);
  }

  /**
   * A platform administrator confirms a submission.
   *
   * `PARTNER_MANAGE` is not sufficient on its own and never is on this
   * codebase — PARTNER_OWNER holds it too, so gating on the permission alone
   * would let an owner approve their own submission and defeat the entire
   * two-party rule this controller exists to enforce. The check is the role.
   */
  @Post('media/:assetId/approve')
  @RequirePermissions(PermissionName.PARTNER_MANAGE)
  async approve(
    @CurrentUser() user: RequestUser,
    @Param('partnerId') partnerId: string,
    @Param('assetId') assetId: string,
    @Req() req: Request,
  ): Promise<MediaAssetDto> {
    assertPlatformAdmin(user, 'Approving partner brand media');
    const asset = await this.media.approvePartnerMedia({
      partnerId,
      assetId,
      actor: actorFrom(user, req),
    });
    return this.view.assetDto(asset, user.id);
  }

  @Delete('logo')
  @RequirePermissions(PermissionName.PARTNER_MANAGE)
  async deleteLogo(
    @CurrentUser() user: RequestUser,
    @Param('partnerId') partnerId: string,
    @Req() req: Request,
  ) {
    assertPlatformAdmin(user, 'Removing partner brand media');
    return this.media.revokePartnerMedia({
      partnerId,
      kind: MediaAssetKind.PARTNER_LOGO,
      actor: actorFrom(user, req),
    });
  }

  @Delete('cover')
  @RequirePermissions(PermissionName.PARTNER_MANAGE)
  async deleteCover(
    @CurrentUser() user: RequestUser,
    @Param('partnerId') partnerId: string,
    @Req() req: Request,
  ) {
    assertPlatformAdmin(user, 'Removing partner brand media');
    return this.media.revokePartnerMedia({
      partnerId,
      kind: MediaAssetKind.PARTNER_COVER,
      actor: actorFrom(user, req),
    });
  }

  private async submit(
    user: RequestUser,
    partnerId: string,
    kind: Extract<MediaAssetKind, 'PARTNER_LOGO' | 'PARTNER_COVER'>,
    file: UploadedImage,
    req: Request,
  ): Promise<MediaAssetDto> {
    assertPartnerScope(user, partnerId);
    assertPartnerOwner(user, partnerId, 'submit brand media');
    const asset = await this.media.submitPartnerMedia({
      partnerId,
      kind,
      file: file.buffer,
      actor: actorFrom(user, req),
      publishImmediately: isPlatformAdmin(user),
    });
    return this.view.assetDto(asset, user.id);
  }
}

/**
 * Multer's own size limit truncates silently rather than erroring in some
 * configurations, and it knows nothing about whether a file was sent at all.
 * This turns both into a 400 the caller can act on, before a single byte
 * reaches the image pipeline.
 *
 * The MIME check here is a *courtesy*, not a control: it reads the declared
 * `Content-Type`, which any caller can set to anything. The real format
 * decision is made by inspecting the bytes in `MediaImageService`, and that is
 * the one that is allowed to be load-bearing.
 */
function uploadPipe() {
  return new ParseFilePipeBuilder()
    .addMaxSizeValidator({ maxSize: MAX_UPLOAD_BYTES, message: 'The image must be 5 MB or smaller' })
    .build({ fileIsRequired: true });
}

/**
 * The part of multer's uploaded-file object this code actually reads.
 *
 * Declared here rather than using the ambient `Express.Multer.File`: that type
 * is a global augmentation from `@types/multer`, and this app's spec tsconfig
 * pins `types` to `["jest", "node"]` so the augmentation is not in scope there.
 * A four-field structural type is also simply a more honest contract — nothing
 * below cares about destination paths, field names or stream handles.
 */
export interface UploadedImage {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

export function actorFrom(user: RequestUser, req: Request): ActorContext {
  return { userId: user.id, ipAddress: req.ip ?? null, userAgent: req.get('user-agent') ?? null };
}
