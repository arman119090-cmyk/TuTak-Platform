import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { PermissionName } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { assertPlatformAdmin } from '../../common/auth/partner-scope';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { UuidParam } from '../../common/decorators/uuid-param.decorator';
import { MAX_UPLOAD_BYTES } from '../../infrastructure/media/media-image.service';
import { RequestUser } from '../auth/types/request-user.type';
import { actorFrom, uploadPipe, type UploadedImage } from '../media/partner-media.controller';
import { CreatePromoDto } from './dto/create-promo.dto';
import { PromoLocaleQueryDto } from './dto/promo-locale.query.dto';
import { UpdatePromoDto } from './dto/update-promo.dto';
import { PromosService, type PartnerPromoAdminDto } from './promos.service';

/**
 * Management of Home "Partner Spotlight" placements.
 *
 * Every route is `assertPlatformAdmin` — the role, not the permission.
 * `PARTNER_MANAGE` is held by PARTNER_OWNER too, and a partner owner writing
 * their own card onto every customer's Home screen is precisely the thing
 * this being admin-only exists to prevent.
 */
@ApiTags('admin/promos')
@ApiBearerAuth()
@Controller('admin/promos')
export class AdminPromosController {
  constructor(private readonly promos: PromosService) {}

  @Get()
  @RequirePermissions(PermissionName.PARTNER_MANAGE)
  list(
    @CurrentUser() user: RequestUser,
    @Query() query: PromoLocaleQueryDto,
  ): Promise<PartnerPromoAdminDto[]> {
    assertPlatformAdmin(user, 'Managing partner promos');
    return this.promos.list(query.locale);
  }

  @Post()
  @RequirePermissions(PermissionName.PARTNER_MANAGE)
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreatePromoDto,
    @Req() req: Request,
  ): Promise<PartnerPromoAdminDto> {
    assertPlatformAdmin(user, 'Managing partner promos');
    return this.promos.create(dto, actorFrom(user, req));
  }

  @Patch(':id')
  @RequirePermissions(PermissionName.PARTNER_MANAGE)
  update(
    @CurrentUser() user: RequestUser,
    @UuidParam('id') id: string,
    @Body() dto: UpdatePromoDto,
    @Req() req: Request,
  ): Promise<PartnerPromoAdminDto> {
    assertPlatformAdmin(user, 'Managing partner promos');
    return this.promos.update(id, dto, actorFrom(user, req));
  }

  /** Same throttle and limits as a partner cover — it is the same pipeline. */
  @Put(':id/artwork')
  @RequirePermissions(PermissionName.PARTNER_MANAGE)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  setArtwork(
    @CurrentUser() user: RequestUser,
    @UuidParam('id') id: string,
    @UploadedFile(uploadPipe()) file: UploadedImage,
    @Req() req: Request,
  ): Promise<PartnerPromoAdminDto> {
    assertPlatformAdmin(user, 'Managing partner promos');
    return this.promos.setArtwork(id, file.buffer, actorFrom(user, req));
  }
}
