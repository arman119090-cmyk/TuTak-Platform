import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';
import { ConsoleSmsGateway, SmsGatewayPort } from './sms-gateway.port';
import { DriverAuthGuard } from './auth.guard';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    OtpService,
    TokenService,
    DriverAuthGuard,
    ConsoleSmsGateway,
    { provide: SmsGatewayPort, useExisting: ConsoleSmsGateway },
  ],
  exports: [AuthService, TokenService, OtpService, DriverAuthGuard, ConsoleSmsGateway],
})
export class AuthModule {}
