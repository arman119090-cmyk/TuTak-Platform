import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { AuthTokens } from '@cashout/contracts';
import { ENV, Env } from '../../config/env';
import { AppError } from '../../common/app-error';
import { Clock } from '../../common/clock';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AppLogger } from '../../common/logging/logger.service';
import { PrismaService } from '../../prisma/prisma.service';

export interface AccessTokenClaims {
  readonly sub: string;
  readonly sid: string;
  readonly did: string;
  readonly typ: 'access';
}

export interface IssueTokensInput {
  readonly userId: string;
  readonly deviceRowId: string;
  readonly deviceId: string;
  readonly familyId?: string;
  readonly ip?: string;
  readonly userAgent?: string;
}

/**
 * Access and refresh tokens.
 *
 * Access tokens are short-lived JWTs; refresh tokens are opaque random values,
 * stored only as a hash, and **rotated on every use**. Rotation is what makes
 * theft detectable: if an old refresh token is presented after it was already
 * exchanged, either the client or an attacker has a stale copy, and the only
 * safe response is to revoke the entire family and make everyone sign in again.
 */
@Injectable()
export class TokenService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly clock: Clock,
    private readonly logger: AppLogger,
  ) {}

  async issue(input: IssueTokensInput): Promise<AuthTokens & { sessionId: string }> {
    const familyId = input.familyId ?? randomUUID();
    const refreshToken = this.crypto.generateToken(32);

    const session = await this.prisma.session.create({
      data: {
        userId: input.userId,
        deviceRowId: input.deviceRowId,
        refreshTokenHash: this.crypto.hashToken(refreshToken),
        familyId,
        expiresAt: this.clock.plusSeconds(this.env.REFRESH_TTL_SECONDS),
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
      select: { id: true },
    });

    const accessToken = await this.jwt.signAsync(
      { sub: input.userId, sid: session.id, did: input.deviceId, typ: 'access' },
      { secret: this.env.JWT_ACCESS_SECRET, expiresIn: this.env.JWT_ACCESS_TTL_SECONDS },
    );

    return {
      accessToken,
      expiresIn: this.env.JWT_ACCESS_TTL_SECONDS,
      refreshToken,
      refreshExpiresIn: this.env.REFRESH_TTL_SECONDS,
      sessionId: session.id,
    };
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    let claims: AccessTokenClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessTokenClaims>(token, {
        secret: this.env.JWT_ACCESS_SECRET,
      });
    } catch (error) {
      const expired = error instanceof Error && error.name === 'TokenExpiredError';
      throw new AppError(expired ? 'TOKEN_EXPIRED' : 'UNAUTHENTICATED', 'Invalid access token');
    }
    if (claims.typ !== 'access') {
      throw new AppError('UNAUTHENTICATED', 'Wrong token type');
    }

    // A revoked session must stop working immediately, not when the JWT
    // happens to expire. "Sign out on my lost phone" has to mean something.
    const session = await this.prisma.session.findUnique({
      where: { id: claims.sid },
      select: { revokedAt: true, expiresAt: true, userId: true },
    });
    if (!session || session.revokedAt || session.expiresAt.getTime() <= this.clock.nowMs()) {
      throw new AppError('UNAUTHENTICATED', 'Session is no longer valid');
    }
    if (session.userId !== claims.sub) {
      throw new AppError('UNAUTHENTICATED', 'Session does not belong to this user');
    }

    return claims;
  }

  async refresh(refreshToken: string, deviceId: string): Promise<AuthTokens> {
    const hash = this.crypto.hashToken(refreshToken);
    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: hash },
      include: { device: true },
    });

    if (!session) {
      throw new AppError('UNAUTHENTICATED', 'Unknown refresh token');
    }

    if (session.revokedAt) {
      // Reuse of a rotated token: assume compromise and kill the family.
      await this.revokeFamily(session.familyId, 'refresh_token_reuse');
      this.logger.warning('Refresh token reuse detected; family revoked', {
        familyId: session.familyId,
        userId: session.userId,
      });
      throw new AppError('UNAUTHENTICATED', 'Session revoked');
    }

    if (session.expiresAt.getTime() <= this.clock.nowMs()) {
      throw new AppError('TOKEN_EXPIRED', 'Refresh token expired');
    }

    if (session.device.deviceId !== deviceId) {
      await this.revokeFamily(session.familyId, 'device_mismatch');
      throw new AppError('UNAUTHENTICATED', 'Refresh token does not belong to this device');
    }

    await this.prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: this.clock.now(), revokedReason: 'rotated', lastSeenAt: this.clock.now() },
    });

    const issued = await this.issue({
      userId: session.userId,
      deviceRowId: session.deviceRowId,
      deviceId,
      familyId: session.familyId,
      ip: session.ip ?? undefined,
      userAgent: session.userAgent ?? undefined,
    });

    return {
      accessToken: issued.accessToken,
      expiresIn: issued.expiresIn,
      refreshToken: issued.refreshToken,
      refreshExpiresIn: issued.refreshExpiresIn,
    };
  }

  async revokeSession(sessionId: string, reason: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: this.clock.now(), revokedReason: reason },
    });
  }

  async revokeFamily(familyId: string, reason: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: this.clock.now(), revokedReason: reason },
    });
  }

  async revokeAllForUser(userId: string, reason: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: this.clock.now(), revokedReason: reason },
    });
  }

  async touch(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId },
      data: { lastSeenAt: this.clock.now() },
    });
  }
}
