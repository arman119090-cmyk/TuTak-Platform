import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Patch, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/request-user.type';
import { AccountDeletionService } from './account-deletion.service';
import { UsersService } from './users.service';
import { DeleteAccountDto } from './dto/delete-account.dto';
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
