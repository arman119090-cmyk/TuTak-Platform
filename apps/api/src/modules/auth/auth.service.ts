import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { AuditAction, DevicePlatform } from '@prisma/client';
import * as argon2 from 'argon2';
import { AppConfig } from '../../config/configuration';
import { generateOpaqueToken, sha256Hex } from '../../common/utils/crypto';
import { parseDurationMs } from '../../common/utils/duration';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAccessPayload } from './strategies/jwt.strategy';

export interface RequestMeta {
  ipAddress?: string;
  userAgent?: string;
}

export interface UserRegisteredEvent {
  userId: string;
  locale: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly auditService: AuditService,
    private readonly events: EventEmitter2,
  ) {}

  async register(dto: RegisterDto, meta: RequestMeta) {
    const existing = await this.usersService.findByPhone(dto.phone);
    if (existing) {
      throw new ForbiddenException('An account with this phone number already exists');
    }

    const passwordHash = await argon2.hash(dto.password);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await this.usersService.createCustomer(
        {
          phone: dto.phone,
          email: dto.email,
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName,
          locale: dto.locale ?? 'hy',
        },
        tx,
      );

      await tx.referralCode.create({
        data: { userId: created.id, code: this.generateReferralCode(created.id) },
      });

      if (dto.referralCode) {
        const referrer = await tx.referralCode.findUnique({
          where: { code: dto.referralCode },
        });
        if (referrer && referrer.userId !== created.id) {
          await tx.referralInvite.create({
            data: { referrerUserId: referrer.userId, refereeUserId: created.id },
          });
        }
      }

      await tx.device.create({
        data: {
          userId: created.id,
          deviceId: dto.deviceId,
          deviceName: dto.deviceName,
          platform: DevicePlatform.WEB,
        },
      });

      return created;
    });

    await this.auditService.record({
      actorUserId: user.id,
      action: AuditAction.USER_LOGIN,
      entityType: 'User',
      entityId: user.id,
      metadata: { via: 'register' },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    this.events.emit('auth.user.registered', {
      userId: user.id,
      locale: user.locale,
    } satisfies UserRegisteredEvent);

    const tokens = await this.issueTokenPair(user.id, user.phone, dto.deviceId, meta);
    const claims = await this.usersService.buildRequestUserClaims(user.id);
    return { user: { ...user, ...claims }, tokens };
  }

  async login(dto: LoginDto, meta: RequestMeta) {
    const user = await this.usersService.findByPhone(dto.phone);
    if (!user) {
      throw new UnauthorizedException('Incorrect phone number or password');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ForbiddenException(
        `Account temporarily locked until ${user.lockedUntil.toISOString()}`,
      );
    }

    const passwordValid = await argon2.verify(user.passwordHash, dto.password);
    if (!passwordValid) {
      await this.usersService.registerFailedLogin(user.id);
      await this.auditService.record({
        actorUserId: user.id,
        action: AuditAction.USER_LOGIN_FAILED,
        entityType: 'User',
        entityId: user.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      throw new UnauthorizedException('Incorrect phone number or password');
    }

    if (!user.isActive) {
      throw new ForbiddenException('This account has been deactivated');
    }

    await this.usersService.resetFailedLogins(user.id);
    await this.prisma.device.upsert({
      where: { userId_deviceId: { userId: user.id, deviceId: dto.deviceId } },
      update: { deviceName: dto.deviceName, lastSeenAt: new Date() },
      create: {
        userId: user.id,
        deviceId: dto.deviceId,
        deviceName: dto.deviceName,
        platform: DevicePlatform.WEB,
      },
    });

    await this.auditService.record({
      actorUserId: user.id,
      action: AuditAction.USER_LOGIN,
      entityType: 'User',
      entityId: user.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    const tokens = await this.issueTokenPair(user.id, user.phone, dto.deviceId, meta);
    const claims = await this.usersService.buildRequestUserClaims(user.id);
    return { user: { ...user, ...claims }, tokens };
  }

  async refresh(refreshToken: string, deviceId: string, meta: RequestMeta) {
    const tokenHash = sha256Hex(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date() || stored.deviceId !== deviceId) {
      throw new UnauthorizedException('Refresh token is invalid or expired');
    }

    const user = await this.usersService.findById(stored.userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Account is no longer active');
    }

    // Rotation: revoke the presented token, issue a fresh pair.
    const tokens = await this.prisma.$transaction(async (tx) => {
      await tx.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date() },
      });
      return this.issueTokenPair(user.id, user.phone, deviceId, meta, tx);
    });

    await this.auditService.record({
      actorUserId: user.id,
      action: AuditAction.TOKEN_REFRESHED,
      entityType: 'RefreshToken',
      entityId: stored.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { tokens };
  }

  async logout(userId: string, deviceId: string, meta: RequestMeta) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, deviceId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.auditService.record({
      actorUserId: userId,
      action: AuditAction.USER_LOGOUT,
      entityType: 'User',
      entityId: userId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return { success: true };
  }

  private async issueTokenPair(
    userId: string,
    phone: string,
    deviceId: string,
    meta: RequestMeta,
    tx?: import('@prisma/client').Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma;
    const accessExpiresIn = this.config.get('jwt.accessExpiresIn', { infer: true });
    const refreshExpiresIn = this.config.get('jwt.refreshExpiresIn', { infer: true });

    const payload: JwtAccessPayload = { sub: userId, phone, deviceId };
    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.config.get('jwt.accessSecret', { infer: true }),
      expiresIn: accessExpiresIn as unknown as number,
    });

    const refreshTokenRaw = generateOpaqueToken();
    const refreshTokenExpiresAt = new Date(Date.now() + parseDurationMs(refreshExpiresIn));

    await client.refreshToken.create({
      data: {
        userId,
        tokenHash: sha256Hex(refreshTokenRaw),
        deviceId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        expiresAt: refreshTokenExpiresAt,
      },
    });

    return {
      accessToken,
      refreshToken: refreshTokenRaw,
      accessTokenExpiresAt: new Date(Date.now() + parseDurationMs(accessExpiresIn)).toISOString(),
      refreshTokenExpiresAt: refreshTokenExpiresAt.toISOString(),
    };
  }

  private generateReferralCode(userId: string): string {
    return `TT-${userId.slice(0, 8).toUpperCase()}`;
  }
}
