import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Patch, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/request-user.type';
import { AccountDeletionService } from './account-deletion.service';
import { UsersService } from './users.service';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { UpdatePersonalizationConsentDto } from './dto/update-personalization-consent.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly accountDeletion: AccountDeletionService,
  ) {}

  @Get('me')
  async me(@CurrentUser() user: RequestUser) {
    return this.usersService.findSafeById(user.id);
  }

  @Patch('me')
  async updateMe(@CurrentUser() user: RequestUser, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(user.id, dto);
  }

  /**
   * Turn nearby-partner personalisation on or off. Separate from `PATCH
   * /users/me` for the same reason avatar consent has its own route: this is
   * a consent decision, not a profile edit, and bundling it into the general
   * update would make it something that happened to the customer rather
   * than something they chose.
   */
  @Patch('me/personalization-consent')
  async updatePersonalizationConsent(
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdatePersonalizationConsentDto,
    @Req() req: Request,
  ) {
    return this.usersService.setPersonalizationConsent(user.id, dto.personalizedRecommendationsEnabled, {
      userId: user.id,
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
  }

  /**
   * Delete this account.
   *
   * Required by both app stores, and the only route on the platform a
   * customer cannot undo by themselves — hence the password in the body. What
   * happens next, and why it happens in two stages, is written out in
   * `AccountDeletionService`.
   */
  @Delete('me')
  @HttpCode(HttpStatus.OK)
  async deleteMe(
    @CurrentUser() user: RequestUser,
    @Body() dto: DeleteAccountDto,
    @Req() req: Request,
  ) {
    return this.accountDeletion.requestDeletion(user.id, dto.password, {
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
  }
}
