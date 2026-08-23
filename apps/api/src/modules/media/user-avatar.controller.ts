import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Patch,
  Put,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { MediaImageDto } from './media.contracts';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MAX_UPLOAD_BYTES } from '../../infrastructure/media/media-image.service';
import { RequestUser } from '../auth/types/request-user.type';
import { UpdateAvatarConsentDto } from './dto/update-avatar-consent.dto';
import { MediaViewService } from './media-view.service';
import { MediaService } from './media.service';
import { actorFrom, type UploadedImage } from './partner-media.controller';

/**
 * A customer's own avatar — spec §3.3's first three endpoints.
 *
 * There is no `:userId` anywhere in this controller and there will not be one.
 * The subject is always `me`, taken from the access token, so there is no
 * parameter to tamper with and no authorisation check to forget: the only
 * avatar reachable through these routes is the caller's. An administrator has
 * no route to set somebody's photograph for them, because nothing about
 * running this platform requires that ability, and the ability to do it is the
 * ability to abuse it.
 */
@ApiTags('users/avatar')
@ApiBearerAuth()
@Controller('users/me')
export class UserAvatarController {
  constructor(
    private readonly media: MediaService,
    private readonly view: MediaViewService,
  ) {}

  /**
   * Upload or replace my avatar.
   *
   * Returns only once the derived asset is stored and committed — spec §4:
   * the Profile screen "must not falsely show success until the server has
   * stored the derived asset". Nothing here is queued or optimistic; if this
   * responds 200, the image exists and the URL in the response resolves.
   */
  @Put('avatar')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  async upload(
    @CurrentUser() user: RequestUser,
    @UploadedFile() file: UploadedImage | undefined,
    @Req() req: Request,
  ): Promise<MediaImageDto> {
    if (!file?.buffer?.length) {
      // `ParseFilePipe` would say "Validation failed", which tells a customer
      // nothing. The upload boundary is one of the few places where the error
      // text is the whole user experience.
      const { BadRequestException } = await import('@nestjs/common');
      throw new BadRequestException('No image was uploaded');
    }
    const asset = await this.media.setUserAvatar({
      userId: user.id,
      file: file.buffer,
      actor: actorFrom(user, req),
    });
    return this.view.signedImage(asset, user.id)!;
  }

  /** Remove my avatar. Idempotent — removing nothing is a success. */
  @Delete('avatar')
  @HttpCode(HttpStatus.OK)
  async remove(@CurrentUser() user: RequestUser, @Req() req: Request) {
    return this.media.removeUserAvatar({ userId: user.id, actor: actorFrom(user, req) });
  }

  /**
   * Turn Level-1 referral-list visibility on or off.
   *
   * Separate from the upload on purpose. Uploading a picture of yourself for
   * your own profile and agreeing to be shown in somebody else's list are two
   * different decisions, and bundling them would make the second one something
   * that happened to the customer rather than something they chose.
   */
  @Patch('avatar-consent')
  async consent(
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateAvatarConsentDto,
    @Req() req: Request,
  ) {
    return this.media.setAvatarConsent({
      userId: user.id,
      consent: dto.showAvatarInReferralList,
      actor: actorFrom(user, req),
    });
  }
}
