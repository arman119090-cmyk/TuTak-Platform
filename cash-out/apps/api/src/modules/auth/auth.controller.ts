import { Body, Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import {
  refreshSchema,
  requestOtpSchema,
  verifyOtpSchema,
  type RefreshDto,
  type RequestOtpDto,
  type VerifyOtpDto,
} from '@cashout/contracts';
import { zodBody } from '../../common/zod.pipe';
import { AuthService } from './auth.service';
import { CurrentUser } from './auth.decorators';
import { Public } from './auth.guard';

@Controller('v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('otp/request')
  @HttpCode(200)
  async requestOtp(@Body(zodBody(requestOtpSchema)) dto: RequestOtpDto) {
    const issued = await this.auth.requestOtp(dto);
    return {
      challengeId: issued.challengeId,
      expiresAt: issued.expiresAt.toISOString(),
      resendAfterSeconds: issued.resendAfterSeconds,
      codeLength: issued.codeLength,
    };
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(200)
  async verifyOtp(@Body(zodBody(verifyOtpSchema)) dto: VerifyOtpDto) {
    return this.auth.verifyOtp(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body(zodBody(refreshSchema)) dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken, dto.deviceId);
  }

  @Post('sign-out')
  @HttpCode(204)
  async signOut(@CurrentUser() user: { sessionId: string }) {
    await this.auth.signOut(user.sessionId);
  }

  @Delete('sessions')
  @HttpCode(204)
  async signOutEverywhere(@CurrentUser() user: { userId: string }) {
    await this.auth.signOutEverywhere(user.userId);
  }

  @Get('sessions')
  async sessions(@CurrentUser() user: { userId: string; sessionId: string }) {
    return { items: await this.auth.listSessions(user.userId, user.sessionId) };
  }
}
