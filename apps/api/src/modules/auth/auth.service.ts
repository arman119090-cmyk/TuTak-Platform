import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import {
  AuditAction,
  DevicePlatform,
  FraudSignalSeverity,
  FraudSignalType,
  User,
} from '@prisma/client';
import * as argon2 from 'argon2';
import { AppConfig } from '../../config/configuration';
import { generateOpaqueToken, sha256Hex } from '../../common/utils/crypto';
import { parseDurationMs } from '../../common/utils/duration';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UsersService } from '../users/users.service';
import { FraudDetectionService } from '../security/fraud-detection.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAccessPayload } from './strategies/jwt.strategy';
import { RequestUser } from './types/request-user.type';

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
    private readonly fraudDetection: FraudDetectionService,
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
    return { user: this.toAuthenticatedUser(user, claims), tokens };
  }

  /**
   * Every rejection here returns the same error.
   *
   * Distinct messages for "no such account", "locked until 14:32" and "wrong
   * password" told an attacker which numbers are registered, and the lock
   * message gave a precise timetable. Combined with a lockout that any
   * stranger could trigger, that was an enumeration oracle bolted to a
   * denial-of-service (docs/AUDIT_2026-08-B.md §H10).
   */
  async login(dto: LoginDto, meta: RequestMeta) {
    const rejected = new UnauthorizedException('Incorrect phone number or password');

    const user = await this.usersService.findByPhone(dto.phone);
    if (!user) {
      // Spend comparable time on an unknown number so response timing does not
      // become the oracle the message no longer is.
      await argon2.hash(dto.password).catch(() => undefined);
      throw rejected;
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.auditService.record({
        actorUserId: user.id,
        action: AuditAction.USER_LOGIN_FAILED,
        entityType: 'User',
        entityId: user.id,
        metadata: { reason: 'locked' },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      throw rejected;
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
      throw rejected;
    }

    if (!user.isActive || user.deletedAt) {
      throw rejected;
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
    return { user: this.toAuthenticatedUser(user, claims), tokens };
  }

  /**
   * Rotates a refresh token.
   *
   * The rotation is a conditional update, not a read followed by a write. Two
   * requests presenting the same token both used to pass the `revokedAt`
   * check and both received a valid new pair, silently duplicating a session
   * (§H1).
   *
   * Presenting a token that has already been rotated is the signature of a
   * stolen token being replayed, so the whole device's token family is
   * revoked and a fraud signal is raised rather than the request simply
   * failing.
   */
  async refresh(refreshToken: string, deviceId: string, meta: RequestMeta) {
    const invalid = new UnauthorizedException('Refresh token is invalid or expired');
    const tokenHash = sha256Hex(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!stored || stored.deviceId !== deviceId) {
      throw invalid;
    }
    if (stored.revokedAt) {
      await this.handleReuse(stored.userId, stored.deviceId, stored.id, meta);
      throw invalid;
    }
    if (stored.expiresAt < new Date()) {
      throw invalid;
    }

    // Account state is checked exactly as it is on every authenticated
    // request; refresh used to check only isActive, so a locked or
    // soft-deleted account could still mint fresh tokens (§M10).
    const user = await this.usersService.findById(stored.userId);
    if (!user) throw invalid;
    await this.usersService.buildRequestUserClaims(user.id);

    const tokens = await this.prisma.$transaction(async (tx) => {
      // Whoever flips revokedAt first owns the rotation; the loser gets
      // nothing rather than a second live session.
      const claimed = await tx.refreshToken.updateMany({
        where: { id: stored.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (claimed.count === 0) throw invalid;

      return this.issueTokenPair(user.id, user.phone, deviceId, meta, tx, stored.id);
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

  /** Strips internal-only fields (passwordHash, lockout counters, ...) before returning to the client. */
  private toAuthenticatedUser(user: User, claims: Omit<RequestUser, 'deviceId'>) {
    return {
      id: user.id,
      phone: user.phone,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      locale: user.locale,
      isPhoneVerified: user.isPhoneVerified,
      roles: claims.roles,
      permissions: claims.permissions,
      partnerScopes: claims.partnerScopes,
    };
  }

  /**
   * A revoked token was presented again: either a replay of one the legitimate
   * client already rotated, or the legitimate client using one an attacker
   * rotated first. Neither is distinguishable from the other, and both mean a
   * token escaped, so every live token for that device dies.
   */
  private async handleReuse(
    userId: string,
    deviceId: string,
    tokenId: string,
    meta: RequestMeta,
  ) {
    const revoked = await this.prisma.refreshToken.updateMany({
      where: { userId, deviceId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    this.logger.warn(
      `Refresh token reuse detected for user ${userId} device ${deviceId}; revoked ${revoked.count} token(s)`,
    );

    await this.fraudDetection
      .raise({
        userId,
        type: FraudSignalType.DEVICE_MISMATCH,
        severity: FraudSignalSeverity.HIGH,
        metadata: { reason: 'refresh_token_reuse', deviceId, tokenId },
      })
      .catch((e) => this.logger.error('Failed to raise token-reuse signal', e));

    await this.auditService.record({
      actorUserId: userId,
      action: AuditAction.TOKEN_REVOKED,
      entityType: 'RefreshToken',
      entityId: tokenId,
      metadata: { reason: 'reuse_detected', revoked: revoked.count },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }

  private async issueTokenPair(
    userId: string,
    phone: string,
    deviceId: string,
    meta: RequestMeta,
    tx?: import('@prisma/client').Prisma.TransactionClient,
    replacesTokenId?: string,
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

    const created = await client.refreshToken.create({
      data: {
        userId,
        tokenHash: sha256Hex(refreshTokenRaw),
        deviceId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        expiresAt: refreshTokenExpiresAt,
      },
    });

    // Chains the family together so a replay can be traced to the token it
    // superseded. The column existed but was never written.
    if (replacesTokenId) {
      await client.refreshToken.update({
        where: { id: replacesTokenId },
        data: { replacedByTokenId: created.id },
      });
    }

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
