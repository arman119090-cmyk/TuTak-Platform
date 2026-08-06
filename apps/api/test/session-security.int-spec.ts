import { UnauthorizedException } from '@nestjs/common';
import { FraudSignalType, PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { AuthService } from '../src/modules/auth/auth.service';
import { UsersService } from '../src/modules/users/users.service';
import { createCustomer } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Regression suite for docs/AUDIT_2026-08-B.md §H1 and §H10.
 *
 * §H1 — rotation was a read followed by a write, so two requests presenting
 * the same refresh token both succeeded and a session silently forked. There
 * was no reuse detection either: a stolen token replayed after the victim
 * rotated simply failed, and nothing noticed.
 *
 * §H10 — five failures locked an account for fifteen minutes without clearing
 * the counter, so one later mistake re-locked it instantly. The distinct error
 * messages also told an attacker which numbers exist.
 */
describe('Session security (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let auth: AuthService;
  let users: UsersService;

  const PASSWORD = 'a-known-password-1';
  const DEVICE = 'device-under-test';
  const meta = { ipAddress: '127.0.0.1', userAgent: 'jest' };

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    auth = harness.app.get(AuthService);
    users = harness.app.get(UsersService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  /** A customer who has logged in once and holds a live token pair. */
  const loggedIn = async () => {
    const { user } = await createCustomer(prisma);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await argon2.hash(PASSWORD) },
    });
    const session = await auth.login(
      { phone: user.phone, password: PASSWORD, deviceId: DEVICE },
      meta,
    );
    return { user, tokens: session.tokens };
  };

  const liveTokens = (userId: string) =>
    prisma.refreshToken.count({ where: { userId, revokedAt: null } });

  // ── §H1 rotation ───────────────────────────────────────────────────────

  describe('refresh rotation', () => {
    it('issues a new pair and revokes the old token', async () => {
      const { user, tokens } = await loggedIn();

      const rotated = await auth.refresh(tokens.refreshToken, DEVICE, meta);

      expect(rotated.tokens.refreshToken).not.toBe(tokens.refreshToken);
      expect(await liveTokens(user.id)).toBe(1);
    });

    it('records which token replaced which', async () => {
      const { user, tokens } = await loggedIn();
      await auth.refresh(tokens.refreshToken, DEVICE, meta);

      // replacedByTokenId existed in the schema but was never written, so a
      // replay could not be traced back to the token it superseded.
      const original = await prisma.refreshToken.findFirstOrThrow({
        where: { userId: user.id, revokedAt: { not: null } },
      });
      expect(original.replacedByTokenId).not.toBeNull();
    });

    it('lets exactly one of two concurrent rotations win', async () => {
      const { user, tokens } = await loggedIn();

      const results = await Promise.allSettled([
        auth.refresh(tokens.refreshToken, DEVICE, meta),
        auth.refresh(tokens.refreshToken, DEVICE, meta),
      ]);

      // Both used to succeed, duplicating the session.
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await liveTokens(user.id)).toBe(1);
    });

    it('kills the whole device family when a rotated token is replayed', async () => {
      const { user, tokens } = await loggedIn();
      await auth.refresh(tokens.refreshToken, DEVICE, meta);
      expect(await liveTokens(user.id)).toBe(1);

      // Replaying a token the legitimate client already rotated is the
      // signature of theft; failing quietly leaves the thief's copy alive.
      await expect(auth.refresh(tokens.refreshToken, DEVICE, meta)).rejects.toThrow(
        UnauthorizedException,
      );

      expect(await liveTokens(user.id)).toBe(0);
      const signals = await prisma.fraudSignal.findMany({ where: { userId: user.id } });
      expect(signals).toHaveLength(1);
      expect(signals[0]!.type).toBe(FraudSignalType.DEVICE_MISMATCH);
    });

    it('refuses a token presented from a different device', async () => {
      const { tokens } = await loggedIn();
      await expect(auth.refresh(tokens.refreshToken, 'some-other-device', meta)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('refuses an expired token', async () => {
      const { user, tokens } = await loggedIn();
      await prisma.refreshToken.updateMany({
        where: { userId: user.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await expect(auth.refresh(tokens.refreshToken, DEVICE, meta)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('refuses to refresh a locked account', async () => {
      const { user, tokens } = await loggedIn();
      await prisma.user.update({
        where: { id: user.id },
        data: { lockedUntil: new Date(Date.now() + 900_000) },
      });

      // refresh() used to check only isActive, so a locked account could keep
      // minting access tokens indefinitely (§M10).
      await expect(auth.refresh(tokens.refreshToken, DEVICE, meta)).rejects.toThrow();
    });

    it('refuses to refresh a soft-deleted account', async () => {
      const { user, tokens } = await loggedIn();
      await prisma.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });

      await expect(auth.refresh(tokens.refreshToken, DEVICE, meta)).rejects.toThrow();
    });
  });

  // ── §H10 lockout ───────────────────────────────────────────────────────

  describe('lockout', () => {
    it('clears the counter when it applies the lock', async () => {
      const { user } = await createCustomer(prisma);

      for (let i = 0; i < 5; i += 1) {
        await users.registerFailedLogin(user.id);
      }

      const locked = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(locked.lockedUntil).not.toBeNull();
      // Leaving the counter at 5 meant one mistake after the lock expired
      // re-locked instantly — an effectively permanent denial of service.
      expect(locked.failedLoginCount).toBe(0);
    });

    it('does not re-lock immediately after the window passes', async () => {
      const { user } = await createCustomer(prisma);
      for (let i = 0; i < 5; i += 1) await users.registerFailedLogin(user.id);
      await prisma.user.update({
        where: { id: user.id },
        data: { lockedUntil: new Date(Date.now() - 1000) },
      });

      await users.registerFailedLogin(user.id);

      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.failedLoginCount).toBe(1);
      expect(after.lockedUntil!.getTime()).toBeLessThan(Date.now());
    });

    it('returns one indistinguishable error for unknown, locked and wrong-password', async () => {
      const { user } = await createCustomer(prisma);
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await argon2.hash(PASSWORD) },
      });

      const unknown = await auth
        .login({ phone: '+37499999999', password: 'x-password', deviceId: DEVICE }, meta)
        .catch((e: Error) => e.message);
      const wrong = await auth
        .login({ phone: user.phone, password: 'wrong-password', deviceId: DEVICE }, meta)
        .catch((e: Error) => e.message);

      await prisma.user.update({
        where: { id: user.id },
        data: { lockedUntil: new Date(Date.now() + 900_000) },
      });
      const locked = await auth
        .login({ phone: user.phone, password: PASSWORD, deviceId: DEVICE }, meta)
        .catch((e: Error) => e.message);

      // Distinct messages told an attacker which numbers are registered, and
      // the lock message handed over a precise unlock timetable.
      expect(new Set([unknown, wrong, locked]).size).toBe(1);
    });

    it('does not reveal that an account is deactivated', async () => {
      const { user } = await createCustomer(prisma);
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await argon2.hash(PASSWORD), isActive: false },
      });

      const message = await auth
        .login({ phone: user.phone, password: PASSWORD, deviceId: DEVICE }, meta)
        .catch((e: Error) => e.message);
      expect(message).toBe('Incorrect phone number or password');
    });

    it('clears the counter on a successful login', async () => {
      const { user } = await createCustomer(prisma);
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await argon2.hash(PASSWORD), failedLoginCount: 3 },
      });

      await auth.login({ phone: user.phone, password: PASSWORD, deviceId: DEVICE }, meta);

      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).failedLoginCount,
      ).toBe(0);
    });
  });
});
