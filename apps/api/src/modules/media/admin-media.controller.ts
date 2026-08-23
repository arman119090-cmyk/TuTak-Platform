import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionName } from '@prisma/client';
import type { MediaAssetDto } from './media.contracts';
import { assertPlatformAdmin } from '../../common/auth/partner-scope';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../auth/types/request-user.type';
import { MediaViewService } from './media-view.service';
import { MediaService } from './media.service';

export interface PendingMediaRowDto extends MediaAssetDto {
  partnerDisplayName: string | null;
}

/**
 * The platform-wide approval queue — the other half of spec §1's two-party
 * rule. Without a place to see what is waiting, "an administrator must
 * confirm it" is a rule that quietly means "nothing ever gets published".
 *
 * Oldest first: a partner waiting three days to have their logo go live should
 * not be overtaken by one who submitted this morning.
 */
@ApiTags('admin/media')
@ApiBearerAuth()
@Controller('admin/media')
export class AdminMediaController {
  constructor(
    private readonly media: MediaService,
    private readonly view: MediaViewService,
  ) {}

  @Get('pending')
  @RequirePermissions(PermissionName.PARTNER_MANAGE)
  async pending(@CurrentUser() user: RequestUser): Promise<PendingMediaRowDto[]> {
    assertPlatformAdmin(user, 'Reviewing partner brand media');
    const rows = await this.media.listPendingReview();
    return rows.map((row) => ({
      ...this.view.assetDto(row, user.id),
      partnerDisplayName: row.partner?.displayName ?? null,
    }));
  }
}
