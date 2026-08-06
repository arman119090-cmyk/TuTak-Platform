import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { PasswordService } from '../src/modules/auth/password.service';
import { UsersService } from '../src/modules/users/users.service';
import { sha256Hex } from '../src/common/utils/crypto';
import { createCustomer } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Regression suite for docs/AUDIT_2026-08-B.md §C2 and §C3.
 *
 * There was no way to change a password. A customer who forgot theirs lost
 * their balance permanently, and the seeded super-admin credential — committed
 * to the repository — could never be rotated through the product.
 */
describe('Password lifecycle (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let users: UsersService;

  const CURRENT = 'current-password-1';
  const NEXT = 'a-brand-new-password-2';

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    passwords = harness.app.get(PasswordService);
    users = harness.app.get(UsersService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  const meta = { ipAddress: '127.0.0.1', userAgent: 'jest' };

  /** A customer with a known password and some live sessions. */
  const withPassword = async (password = CURRENT, sessions = 2) => {
    const { user, wallet } = await createCustomer(prisma);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await argon2.hash(password) },
    });
    for (let i = 0; i < sessions; i += 1) {
      await prisma.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: `hash-${user.id}-${i}`,
          deviceId: `device-${i}`,
          expiresAt: new Date(Date.now() + 30 * 86_400_000),
        },
      });
    }
    return { user, wallet };
  };

  const liveSessions = (userId: string) =>
    prisma.refreshToken.count({ where: { userId, revokedAt: null } });

  const verify = async (userId: string, password: string) => {
    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return argon2.verify(row.passwordHash, password);
  };

  // ── Change ─────────────────────────────────────────────────────────────

  describe('change', () => {
    it('replaces the password when the current one is supplied', async () => {
      const { user } = await withPassword();

      await passwords.change(user.id, CURRENT, NEXT, meta);

      expect(await verify(user.id, NEXT)).toBe(true);
      expect(await verify(user.id, CURRENT)).toBe(false);
    });

    it('refuses without the current password', async () => {
      const { user } = await withPassword();

      // A stolen access token alone must not be enough to lock the owner out
      // of their own account.
      await expect(passwords.change(user.id, 'wrong-password', NEXT, meta)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(await verify(user.id, CURRENT)).toBe(true);
    });

    it('refuses to set the same password again', async () => {
      const { user } = await withPassword();
      await expect(passwords.change(user.id, CURRENT, CURRENT, meta)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('revokes every session, so a suspected compromise really ends', async () => {
      const { user } = await withPassword(CURRENT, 3);
      expect(await liveSessions(user.id)).toBe(3);

      await passwords.change(user.id, CURRENT, NEXT, meta);

      expect(await liveSessions(user.id)).toBe(0);
    });
  });

  // ── Reset ──────────────────────────────────────────────────────────────

  describe('reset', () => {
    /** Reads the delivered code out of the notification the request produced. */
    const deliveredCode = async (userId: string) => {
      const note = await prisma.notification.findFirstOrThrow({
        where: { userId, titleKey: 'notifications.passwordResetTitle' },
        orderBy: { createdAt: 'desc' },
      });
      return (note.params as { code: string }).code;
    };

    it('lets a locked-out customer back in', async () => {
      const { user } = await withPassword();

      await passwords.requestReset(user.phone, meta);
      const code = await deliveredCode(user.id);
      await passwords.confirmReset(user.phone, code, NEXT, meta);

      expect(await verify(user.id, NEXT)).toBe(true);
      expect(await liveSessions(user.id)).toBe(0);
    });

    it('stores only the hash of the code', async () => {
      const { user } = await withPassword();
      await passwords.requestReset(user.phone, meta);
      const code = await deliveredCode(user.id);

      // A database dump must not hand over a working reset for every open
      // request, on the same reasoning as refresh tokens.
      const row = await prisma.passwordResetToken.findFirstOrThrow({
        where: { userId: user.id },
      });
      expect(row.codeHash).not.toBe(code);
      expect(row.codeHash).toBe(sha256Hex(code));
    });

    it('reports success for an unknown number, revealing nothing', async () => {
      // Saying "no such account" turns this into an enumeration oracle.
      await expect(passwords.requestReset('+37499999999', meta)).resolves.toEqual({
        success: true,
      });
      expect(await prisma.passwordResetToken.count()).toBe(0);
    });

    it('refuses a wrong code and burns the challenge after five tries', async () => {
      const { user } = await withPassword();
      await passwords.requestReset(user.phone, meta);
      const code = await deliveredCode(user.id);

      for (let i = 0; i < 5; i += 1) {
        await expect(
          passwords.confirmReset(user.phone, '000000', NEXT, meta),
        ).rejects.toThrow(UnauthorizedException);
      }

      // Even the correct code is worthless now — guessing must be expensive.
      await expect(passwords.confirmReset(user.phone, code, NEXT, meta)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(await verify(user.id, CURRENT)).toBe(true);
    });

    it('refuses an expired code', async () => {
      const { user } = await withPassword();
      await passwords.requestReset(user.phone, meta);
      const code = await deliveredCode(user.id);
      await prisma.passwordResetToken.updateMany({
        where: { userId: user.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await expect(passwords.confirmReset(user.phone, code, NEXT, meta)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('consumes the code, so it cannot be replayed', async () => {
      const { user } = await withPassword();
      await passwords.requestReset(user.phone, meta);
      const code = await deliveredCode(user.id);
      await passwords.confirmReset(user.phone, code, NEXT, meta);

      await expect(
        passwords.confirmReset(user.phone, code, 'third-password-3', meta),
      ).rejects.toThrow(UnauthorizedException);
      expect(await verify(user.id, NEXT)).toBe(true);
    });

    it('invalidates an earlier code when a new one is requested', async () => {
      const { user } = await withPassword();
      await passwords.requestReset(user.phone, meta);
      const first = await deliveredCode(user.id);
      await passwords.requestReset(user.phone, meta);

      // Leaving old codes live multiplies the guessing surface for free.
      await expect(passwords.confirmReset(user.phone, first, NEXT, meta)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('clears a lockout, since a reset is the legitimate way out of one', async () => {
      const { user } = await withPassword();
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 5, lockedUntil: new Date(Date.now() + 900_000) },
      });

      await passwords.requestReset(user.phone, meta);
      await passwords.confirmReset(user.phone, await deliveredCode(user.id), NEXT, meta);

      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.failedLoginCount).toBe(0);
      expect(after.lockedUntil).toBeNull();
    });

    it('refuses a reset for a deactivated account', async () => {
      const { user } = await withPassword();
      await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });

      await passwords.requestReset(user.phone, meta);
      expect(await prisma.passwordResetToken.count({ where: { userId: user.id } })).toBe(0);
    });
  });

  // ── Forced rotation (§C2) ──────────────────────────────────────────────

  describe('forced rotation', () => {
    it('surfaces the flag in the request claims so the guard can act on it', async () => {
      const { user } = await withPassword();
      await prisma.user.update({
        where: { id: user.id },
        data: { mustChangePassword: true },
      });

      const claims = await users.buildRequestUserClaims(user.id);
      expect(claims.mustChangePassword).toBe(true);
    });

    it('clears the flag once the password is changed', async () => {
      const { user } = await withPassword();
      await prisma.user.update({ where: { id: user.id }, data: { mustChangePassword: true } });

      await passwords.change(user.id, CURRENT, NEXT, meta);

      const claims = await users.buildRequestUserClaims(user.id);
      expect(claims.mustChangePassword).toBe(false);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordChangedAt,
      ).not.toBeNull();
    });

    it('clears the flag through a reset too', async () => {
      const { user } = await withPassword();
      await prisma.user.update({ where: { id: user.id }, data: { mustChangePassword: true } });

      await passwords.requestReset(user.phone, meta);
      const note = await prisma.notification.findFirstOrThrow({
        where: { userId: user.id, titleKey: 'notifications.passwordResetTitle' },
      });
      await passwords.confirmReset(
        user.phone,
        (note.params as { code: string }).code,
        NEXT,
        meta,
      );

      expect((await users.buildRequestUserClaims(user.id)).mustChangePassword).toBe(false);
    });
  });
});
