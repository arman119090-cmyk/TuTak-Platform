import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AppConfig } from '../../config/configuration';
import { AuditModule } from '../audit/audit.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { DemoSessionService } from './demo-session.service';
import { AuthService } from './auth.service';
import { AuthOtpService } from './auth-otp.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { PasswordService } from './password.service';
import { PhoneVerificationService } from './phone-verification.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { SecurityModule } from '../security/security.module';
import { ReferralModule } from '../referral/referral.module';

@Module({
  imports: [
    PassportModule,
    UsersModule,
    AuditModule,
    NotificationsModule,
    SecurityModule,
    ReferralModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        secret: config.get('jwt.accessSecret', { infer: true }),
        signOptions: { expiresIn: config.get('jwt.accessExpiresIn', { infer: true }) },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    DemoSessionService,
    AuthService,
    AuthOtpService,
    JwtStrategy,
    PasswordService,
    PhoneVerificationService,
  ],
  exports: [AuthService, PasswordService, PhoneVerificationService],
})
export class AuthModule {}
