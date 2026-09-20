import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';
import { ConsoleSmsGateway, SmsGatewayPort } from './sms-gateway.port';
import { DriverAuthGuard } from './auth.guard';
import { ENV, Env } from '../../config/env';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    OtpService,
    TokenService,
    DriverAuthGuard,
    ConsoleSmsGateway,
    {
      provide: SmsGatewayPort,
      inject: [ENV, ConsoleSmsGateway],
      useFactory: (env: Env, console: ConsoleSmsGateway) => {
        if (env.SMS_MODE === 'live') {
          // No provider has been contracted. When one is, its adapter extends
          // SmsHttpGatewayBase and is returned here for its SMS_PROVIDER value.
          throw new Error(
            `SMS_MODE=live is set with SMS_PROVIDER=${env.SMS_PROVIDER ?? '(unset)'}, but no adapter ` +
              'exists for it. Implement SmsHttpGatewayBase for the provider (docs/LIVE_READINESS.md) ' +
              'and register it in auth.module.ts.',
          );
        }
        return console;
      },
    },
  ],
  exports: [
    AuthService,
    TokenService,
    OtpService,
    DriverAuthGuard,
    ConsoleSmsGateway,
    SmsGatewayPort,
  ],
})
export class AuthModule {}
