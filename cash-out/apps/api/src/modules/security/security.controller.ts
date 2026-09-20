import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  authorizeSchema,
  changePinSchema,
  enableBiometricSchema,
  setPinSchema,
  type AuthorizeDto,
  type ChangePinDto,
  type EnableBiometricDto,
  type SetPinDto,
} from '@cashout/contracts';
import { zodBody } from '../../common/zod.pipe';
import { CurrentDriverId, CurrentUser } from '../auth/auth.decorators';
import { SecurityService } from './security.service';

type Requester = { userId: string; deviceId: string };

@Controller('v1/security')
export class SecurityController {
  constructor(private readonly security: SecurityService) {}

  @Get()
  async status(@CurrentDriverId() driverId: string, @CurrentUser() user: Requester) {
    return this.security.status(driverId, user);
  }

  @Post('pin')
  @HttpCode(204)
  async setPin(@CurrentDriverId() driverId: string, @Body(zodBody(setPinSchema)) dto: SetPinDto) {
    await this.security.setPin(driverId, dto.pin);
  }

  @Post('pin/change')
  @HttpCode(204)
  async changePin(
    @CurrentDriverId() driverId: string,
    @Body(zodBody(changePinSchema)) dto: ChangePinDto,
  ) {
    await this.security.changePin(driverId, dto.currentPin, dto.newPin);
  }

  /** Returns the device secret once; the phone keeps it behind the OS biometric check. */
  @Post('biometric/enable')
  async enableBiometric(
    @CurrentDriverId() driverId: string,
    @CurrentUser() user: Requester,
    @Body(zodBody(enableBiometricSchema)) dto: EnableBiometricDto,
  ) {
    return this.security.enableBiometric(driverId, dto.pin, user);
  }

  @Post('biometric/disable')
  @HttpCode(204)
  async disableBiometric(@CurrentDriverId() driverId: string) {
    await this.security.disableBiometric(driverId);
  }

  /** A single-use authorization for a money operation. */
  @Post('authorize')
  async authorize(
    @CurrentDriverId() driverId: string,
    @CurrentUser() user: Requester,
    @Body(zodBody(authorizeSchema)) dto: AuthorizeDto,
  ) {
    return this.security.authorize(driverId, user, dto);
  }
}
