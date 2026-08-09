import { Body, Controller, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { AllowsPendingPasswordChange } from '../../common/decorators/allow-pending-password-change.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from './types/request-user.type';
import { DemoSessionService } from './demo-session.service';
import { DemoSessionDto } from './dto/demo-session.dto';
import { AuthService, RequestMeta } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import {
  ChangePasswordDto,
  ConfirmPasswordResetDto,
  ConfirmPhoneDto,
  RequestPasswordResetDto,
} from './dto/password.dto';
import { PasswordService } from './password.service';
import { PhoneVerificationService } from './phone-verification.service';
import { clearRefreshCookie, readRefreshToken, setRefreshCookie } from './refresh-cookie';

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
    private readonly phoneVerification: PhoneVerificationService,
    private readonly demoSessionService: DemoSessionService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.register(dto, extractMeta(req));
    setRefreshCookie(
      res,
      result.tokens.refreshToken,
      new Date(result.tokens.refreshTokenExpiresAt),
    );
    return result;
  }

  @Public()
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto, extractMeta(req));
    setRefreshCookie(
      res,
      result.tokens.refreshToken,
      new Date(result.tokens.refreshTokenExpiresAt),
    );
    return result;
  }

  /**
   * Signs in as the seeded demonstration customer.
   *
   * Present only when `DEMO_MODE=true`; a deployment without it answers 404,
   * so a production API does not advertise a route it would refuse. See
   * `DemoSessionService` for why this grants nothing that typing the seeded
   * credentials into the form above would not.
   *
   * The same throttle as `login`, because it *is* a login.
   */
  @Public()
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @Post('demo-session')
  async demoSession(
    @Body() dto: DemoSessionDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.demoSessionService.createSession(dto.deviceId, extractMeta(req));
    setRefreshCookie(
      res,
      result.tokens.refreshToken,
      new Date(result.tokens.refreshTokenExpiresAt),
    );
    return result;
  }

  /**
   * Takes the refresh token from the httpOnly cookie when there is one, and
   * from the body otherwise, so native clients are unaffected.
   */
  @Public()
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Post('refresh')
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const presented = readRefreshToken(req, dto.refreshToken);
    if (!presented) {
      throw new UnauthorizedException('Refresh token is invalid or expired');
    }

    const result = await this.authService.refresh(presented, dto.deviceId, extractMeta(req));
    setRefreshCookie(
      res,
      result.tokens.refreshToken,
      new Date(result.tokens.refreshTokenExpiresAt),
    );
    return result;
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

  /**
   * Phone ownership. Not required to register — a failed SMS at signup would
   * strand a customer with no account — but required before an account can
   * earn anything, which is the only direction free accounts are profitable in.
   */
  @ApiBearerAuth()
  @Throttle({ default: { limit: 5, ttl: 300_000 } })
  @Post('verify-phone/request')
  requestPhoneVerification(@CurrentUser() user: RequestUser) {
    return this.phoneVerification.request(user.id);
  }

  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 300_000 } })
  @Post('verify-phone/confirm')
  confirmPhoneVerification(@CurrentUser() user: RequestUser, @Body() dto: ConfirmPhoneDto) {
    return this.phoneVerification.confirm(user.id, dto.code);
  }

  @ApiBearerAuth()
  @AllowsPendingPasswordChange()
  @Post('logout')
  logout(
    @CurrentUser() user: RequestUser,
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    clearRefreshCookie(res);
    return this.authService.logout(user.id, dto.deviceId, extractMeta(req));
  }
}
