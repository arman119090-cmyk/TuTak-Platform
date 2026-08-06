import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { AllowsPendingPasswordChange } from '../../common/decorators/allow-pending-password-change.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from './types/request-user.type';
import { AuthService, RequestMeta } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import {
  ChangePasswordDto,
  ConfirmPasswordResetDto,
  RequestPasswordResetDto,
} from './dto/password.dto';
import { PasswordService } from './password.service';

function extractMeta(req: Request): RequestMeta {
  return {
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  };
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly passwordService: PasswordService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.authService.register(dto, extractMeta(req));
  }

  @Public()
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto, extractMeta(req));
  }

  @Public()
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Post('refresh')
  refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    return this.authService.refresh(dto.refreshToken, dto.deviceId, extractMeta(req));
  }

  /**
   * Authenticated rotation. Requires the current password so that a stolen
   * access token alone cannot lock the owner out of their own account.
   */
  @ApiBearerAuth()
  @AllowsPendingPasswordChange()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('change-password')
  changePassword(
    @CurrentUser() user: RequestUser,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
  ) {
    return this.passwordService.change(
      user.id,
      dto.currentPassword,
      dto.newPassword,
      extractMeta(req),
    );
  }

  /**
   * Always returns success, whether or not the number is registered — saying
   * otherwise would make this an account-enumeration oracle.
   */
  @Public()
  @Throttle({ default: { limit: 3, ttl: 300_000 } })
  @Post('password-reset/request')
  requestPasswordReset(@Body() dto: RequestPasswordResetDto, @Req() req: Request) {
    return this.passwordService.requestReset(dto.phone, extractMeta(req));
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 300_000 } })
  @Post('password-reset/confirm')
  confirmPasswordReset(@Body() dto: ConfirmPasswordResetDto, @Req() req: Request) {
    return this.passwordService.confirmReset(
      dto.phone,
      dto.code,
      dto.newPassword,
      extractMeta(req),
    );
  }

  @ApiBearerAuth()
  @AllowsPendingPasswordChange()
  @Post('logout')
  logout(
    @CurrentUser() user: RequestUser,
    @Body() dto: RefreshDto,
    @Req() req: Request,
  ) {
    return this.authService.logout(user.id, dto.deviceId, extractMeta(req));
  }
}
