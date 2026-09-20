import { Inject, Injectable } from '@nestjs/common';
import type { AuthorizationPurpose, DriverSecurity } from '@prisma/client';
import { AuthorizationDto, AuthorizeDto, SecurityStatusDto } from '@cashout/contracts';
import { ENV, Env } from '../../config/env';
import { AppError } from '../../common/app-error';
import { Clock } from '../../common/clock';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AppLogger } from '../../common/logging/logger.service';
import { RateLimiter } from '../../common/rate-limit.service';
import { PrismaService, TransactionClient } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/** Wrong PINs before a lockout. */
const MAX_PIN_FAILURES = 5;
/** First lockout; each subsequent one doubles, up to a day. */
const BASE_LOCK_SECONDS = 15 * 60;
const MAX_LOCK_SECONDS = 24 * 3600;
/** How long a fresh authorization may be used. */
const AUTHORIZATION_TTL_SECONDS = 120;

export interface RequestDevice {
  readonly userId: string;
  readonly deviceId: string;
}

/**
 * Confirmation of money operations: the PIN, the biometric enrolment, and the
 * single-use authorizations that a withdrawal is created against.
 *
 * ## What "biometric" means here, honestly
 *
 * Cash Out never sees a fingerprint or a face. At enrolment the server issues
 * a random device secret and keeps only its hash, bound to the device row;
 * the phone stores the secret in its keystore behind the OS biometric check.
 * A biometric authorization is the phone presenting that secret, so the
 * server verifies possession of a device-bound secret — not a boolean the
 * client asserts. What this is *not* is a hardware-attested signature over a
 * server challenge: that needs a native key-pair module the current Expo
 * stack does not provide, and it is listed as such in docs/SECURITY.md.
 *
 * ## The PIN
 *
 * Six digits, scrypt-hashed, attempts counted before the comparison, and an
 * escalating lockout: 15 minutes, then 30, then an hour, up to a day. Every
 * set, change, failure-to-lockout and enrolment change is audited.
 */
@Injectable()
export class SecurityService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly clock: Clock,
    private readonly limiter: RateLimiter,
    private readonly audit: AuditService,
    private readonly logger: AppLogger,
  ) {}

  async status(driverId: string, device: RequestDevice): Promise<SecurityStatusDto> {
    const row = await this.prisma.driverSecurity.findUnique({ where: { driverId } });
    const deviceRow = await this.deviceRow(device);
    const locked =
      row?.pinLockedUntil && row.pinLockedUntil.getTime() > this.clock.nowMs()
        ? row.pinLockedUntil
        : null;
    return {
      pinSet: !!row?.pinHash,
      pinLockedUntil: locked?.toISOString() ?? null,
      biometricEnabled: !!row?.biometricEnabledAt,
      biometricEnabledOnThisDevice:
        !!row?.biometricEnabledAt && row.biometricDeviceRowId === deviceRow?.id,
    };
  }

  async setPin(driverId: string, pin: string): Promise<void> {
    const existing = await this.prisma.driverSecurity.findUnique({ where: { driverId } });
    if (existing?.pinHash) {
      throw new AppError('PIN_ALREADY_SET', 'Use the change-PIN flow');
    }
    assertNotTrivial(pin);
    const now = this.clock.now();
    await this.prisma.driverSecurity.upsert({
      where: { driverId },
      create: { driverId, pinHash: this.crypto.hashSecret(pin), pinSetAt: now },
      update: { pinHash: this.crypto.hashSecret(pin), pinSetAt: now, failedPinAttempts: 0 },
    });
    await this.audit.record({
      action: 'security.pin_set',
      subjectType: 'driver',
      subjectId: driverId,
      actorType: 'DRIVER',
    });
  }

  async changePin(driverId: string, currentPin: string, newPin: string): Promise<void> {
    assertNotTrivial(newPin);
    await this.verifyPin(driverId, currentPin);
    await this.prisma.driverSecurity.update({
      where: { driverId },
      data: { pinHash: this.crypto.hashSecret(newPin), pinChangedAt: this.clock.now() },
    });
    await this.audit.record({
      action: 'security.pin_changed',
      subjectType: 'driver',
      subjectId: driverId,
      actorType: 'DRIVER',
    });
  }

  /**
   * Enrols this device for biometric confirmation. Requires the PIN — the
   * thing being replaced must approve its replacement — and returns the device
   * secret exactly once. Enrolling a second device replaces the first.
   */
  async enableBiometric(
    driverId: string,
    pin: string,
    device: RequestDevice,
  ): Promise<{ deviceSecret: string }> {
    await this.verifyPin(driverId, pin);
    const deviceRow = await this.requireDeviceRow(device);
    const secret = this.crypto.generateToken(32);
    await this.prisma.driverSecurity.update({
      where: { driverId },
      data: {
        biometricEnabledAt: this.clock.now(),
        biometricDeviceRowId: deviceRow.id,
        biometricSecretHash: this.crypto.hashToken(secret),
      },
    });
    await this.audit.record({
      action: 'security.biometric_enabled',
      subjectType: 'driver',
      subjectId: driverId,
      actorType: 'DRIVER',
      after: { deviceId: device.deviceId },
    });
    return { deviceSecret: secret };
  }

  async disableBiometric(driverId: string): Promise<void> {
    const row = await this.prisma.driverSecurity.findUnique({ where: { driverId } });
    if (!row?.biometricEnabledAt) return;
    await this.prisma.driverSecurity.update({
      where: { driverId },
      data: { biometricEnabledAt: null, biometricDeviceRowId: null, biometricSecretHash: null },
    });
    await this.audit.record({
      action: 'security.biometric_disabled',
      subjectType: 'driver',
      subjectId: driverId,
      actorType: 'DRIVER',
    });
  }

  /**
   * Turns a PIN or a device secret into a single-use authorization token,
   * bound to the driver, the device and (when given) the quote.
   */
  async authorize(
    driverId: string,
    device: RequestDevice,
    dto: AuthorizeDto,
  ): Promise<AuthorizationDto> {
    await this.limiter.enforce(`authorize:driver:${driverId}`, 20, 600);
    const deviceRow = await this.requireDeviceRow(device);

    if (dto.method === 'PIN') {
      await this.verifyPin(driverId, dto.pin);
    } else {
      await this.verifyDeviceSecret(driverId, deviceRow.id, dto.deviceSecret);
    }

    if (dto.quoteId) {
      const quote = await this.prisma.quote.findUnique({ where: { id: dto.quoteId } });
      if (!quote || quote.driverId !== driverId) {
        throw new AppError('NOT_FOUND', 'Unknown quote');
      }
    }

    const token = this.crypto.generateToken(32);
    const expiresAt = this.clock.plusSeconds(AUTHORIZATION_TTL_SECONDS);
    await this.prisma.withdrawalAuthorization.create({
      data: {
        driverId,
        deviceRowId: deviceRow.id,
        method: dto.method,
        purpose: dto.purpose,
        quoteId: dto.quoteId ?? null,
        tokenHash: this.crypto.hashToken(token),
        createdAt: this.clock.now(),
        expiresAt,
      },
    });
    await this.audit.record({
      action: 'withdrawal.authorized',
      subjectType: 'driver',
      subjectId: driverId,
      actorType: 'DRIVER',
      after: { method: dto.method, purpose: dto.purpose, quoteId: dto.quoteId ?? null },
    });

    return {
      authorizationToken: token,
      method: dto.method,
      purpose: dto.purpose,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Spends an authorization. Called inside the withdrawal's own transaction so
   * that a withdrawal cannot exist without a consumed authorization, nor an
   * authorization be consumed without its withdrawal.
   */
  async consume(
    tx: TransactionClient,
    input: {
      driverId: string;
      token: string;
      quoteId: string;
      purpose: AuthorizationPurpose;
      withdrawalId?: string;
    },
  ): Promise<{ method: 'PIN' | 'BIOMETRIC' }> {
    const row = await tx.withdrawalAuthorization.findUnique({
      where: { tokenHash: this.crypto.hashToken(input.token) },
    });
    if (!row || row.driverId !== input.driverId) {
      throw new AppError('AUTHORIZATION_INVALID', 'Unknown authorization');
    }
    if (row.purpose !== input.purpose) {
      throw new AppError('AUTHORIZATION_INVALID', 'Authorization was given for something else');
    }
    if (row.quoteId && row.quoteId !== input.quoteId) {
      throw new AppError('AUTHORIZATION_INVALID', 'Authorization was given for another quote');
    }
    if (row.expiresAt.getTime() <= this.clock.nowMs()) {
      throw new AppError('AUTHORIZATION_INVALID', 'Authorization expired');
    }
    // Conditional update: two concurrent confirmations with one token cannot
    // both pass, whatever they read a moment ago.
    const consumed = await tx.withdrawalAuthorization.updateMany({
      where: { id: row.id, consumedAt: null },
      data: { consumedAt: this.clock.now(), consumedByWithdrawalId: input.withdrawalId ?? null },
    });
    if (consumed.count === 0) {
      throw new AppError('AUTHORIZATION_INVALID', 'Authorization already used');
    }
    return { method: row.method };
  }

  async bindConsumed(tx: TransactionClient, token: string, withdrawalId: string): Promise<void> {
    await tx.withdrawalAuthorization.updateMany({
      where: { tokenHash: this.crypto.hashToken(token) },
      data: { consumedByWithdrawalId: withdrawalId },
    });
  }

  // ------------------------------------------------------------------ internals

  private async verifyPin(driverId: string, pin: string): Promise<void> {
    const row = await this.prisma.driverSecurity.findUnique({ where: { driverId } });
    if (!row?.pinHash) throw new AppError('PIN_NOT_SET', 'No PIN has been set');

    if (row.pinLockedUntil && row.pinLockedUntil.getTime() > this.clock.nowMs()) {
      throw new AppError('PIN_LOCKED', 'Too many wrong PINs', {
        retryAfterSeconds: Math.ceil((row.pinLockedUntil.getTime() - this.clock.nowMs()) / 1000),
      });
    }

    // Count first, compare second: a crash between the two must not hand out
    // a free guess.
    const bumped = await this.prisma.driverSecurity.update({
      where: { driverId },
      data: { failedPinAttempts: { increment: 1 } },
    });

    if (!this.crypto.verifySecret(pin, row.pinHash)) {
      if (bumped.failedPinAttempts >= MAX_PIN_FAILURES) {
        await this.lock(bumped);
        throw new AppError('PIN_LOCKED', 'Too many wrong PINs', {
          retryAfterSeconds: lockSeconds(bumped.pinLockCount),
        });
      }
      await this.audit.record({
        action: 'security.pin_failed',
        subjectType: 'driver',
        subjectId: driverId,
        actorType: 'DRIVER',
        after: { attempts: bumped.failedPinAttempts },
      });
      throw new AppError('PIN_INVALID', 'That PIN is not right', {
        attemptsRemaining: MAX_PIN_FAILURES - bumped.failedPinAttempts,
      });
    }

    await this.prisma.driverSecurity.update({
      where: { driverId },
      data: { failedPinAttempts: 0, pinLockedUntil: null },
    });
  }

  private async lock(row: DriverSecurity): Promise<void> {
    const seconds = lockSeconds(row.pinLockCount);
    await this.prisma.driverSecurity.update({
      where: { driverId: row.driverId },
      data: {
        failedPinAttempts: 0,
        pinLockedUntil: this.clock.plusSeconds(seconds),
        pinLockCount: { increment: 1 },
      },
    });
    this.logger.warning('PIN locked after repeated failures', {
      driverId: row.driverId,
      seconds,
    });
    await this.audit.record({
      action: 'security.pin_locked',
      subjectType: 'driver',
      subjectId: row.driverId,
      actorType: 'SYSTEM',
      after: { seconds, lockCount: row.pinLockCount + 1 },
    });
  }

  private async verifyDeviceSecret(
    driverId: string,
    deviceRowId: string,
    secret: string,
  ): Promise<void> {
    const row = await this.prisma.driverSecurity.findUnique({ where: { driverId } });
    if (!row?.biometricEnabledAt || !row.biometricSecretHash) {
      throw new AppError('BIOMETRIC_NOT_ENROLLED', 'Biometrics are not enabled');
    }
    if (row.biometricDeviceRowId !== deviceRowId) {
      throw new AppError('BIOMETRIC_NOT_ENROLLED', 'Biometrics are enrolled on another device');
    }
    const expected = Buffer.from(row.biometricSecretHash);
    const actual = Buffer.from(this.crypto.hashToken(secret));
    if (expected.length !== actual.length || !expected.equals(actual)) {
      await this.audit.record({
        action: 'security.biometric_failed',
        subjectType: 'driver',
        subjectId: driverId,
        actorType: 'DRIVER',
      });
      throw new AppError('AUTHORIZATION_INVALID', 'Device secret does not match');
    }
  }

  private deviceRow(device: RequestDevice) {
    return this.prisma.device.findUnique({
      where: { userId_deviceId: { userId: device.userId, deviceId: device.deviceId } },
      select: { id: true, blocked: true },
    });
  }

  private async requireDeviceRow(device: RequestDevice) {
    const row = await this.deviceRow(device);
    if (!row || row.blocked) {
      throw new AppError('UNAUTHENTICATED', 'Unknown or blocked device');
    }
    return row;
  }
}

function lockSeconds(lockCount: number): number {
  return Math.min(MAX_LOCK_SECONDS, BASE_LOCK_SECONDS * 2 ** lockCount);
}

/** 000000, 123456 and their like are not PINs. */
function assertNotTrivial(pin: string): void {
  const allSame = /^(\d)\1{5}$/.test(pin);
  const ascending = '0123456789'.includes(pin);
  const descending = '9876543210'.includes(pin);
  if (allSame || ascending || descending) {
    throw new AppError('VALIDATION_FAILED', 'Choose a less obvious PIN');
  }
}
