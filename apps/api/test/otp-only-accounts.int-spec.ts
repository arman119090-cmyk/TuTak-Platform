import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { AuthService } from '../src/modules/auth/auth.service';
import { PasswordService } from '../src/modules/auth/password.service';
import { UsersService } from '../src/modules/users/users.service';
import { SMS_PROVIDER, SmsProvider } from '../src/infrastructure/sms/sms-provider.interface';
import {
  countAccountsEverRegisteredByOtp,
  findAccountsWithUnknownPassword,
} from '../src/modules/users/otp-only-accounts';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * The accounts the old flow left behind, and the promise made about them.
 *
 * Registration used to create the account with `argon2.hash(randomBytes(32))`.
 * Whoever registered that way holds an account whose password they have never
 * seen, and the deliberate decision was to change **nothing** about their rows:
 * no migration, no `mustChangePassword`, no forced anything. That is only a
 * defensible decision while three things are true, and this suite is what makes
 * them true rather than believed:
 *
 *  1. they can still get in — SMS sign-in works for them;
 *  2. they can give themselves a password without knowing the old one, through
 *     the password-reset flow that already exists;
 *  3. they can be named exactly, so the decision can be revisited with a
 *     number rather than a guess — and the criterion clears itself once
 *     somebody has set a password.
 *
 * Take any one away and "leave them alone" stops being a strategy and becomes
 * an oversight.
 */
describe('Accounts left by the OTP-only flow (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let auth: AuthService;
  let passwords: PasswordService;
  let users: UsersService;
  let sms: SmsProvider;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    auth = harness.app.get(AuthService);
    passwords = harness.app.get(PasswordService);
    users = harness.app.get(UsersService);
    sms = harness.app.get<SmsProvider>(SMS_PROVIDER);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    jest.restoreAllMocks();
  });

  const randomPhone = () => `+3746${Math.floor(Math.random() * 90_000_000 + 10_000_000)}`;

  /** Captures the code from the outbound SMS; the database stores only its hash. */
  const captureCode = (): (() => string) => {
    const spy = jest.spyOn(sms, 'send');
    return () => {
      const match = (spy.mock.calls.at(-1)?.[0]?.body ?? '').match(/(\d{6})/);
      if (!match?.[1]) throw new Error('no code found in SMS body');
      return match[1];
    };
  };

  /**
   * An account exactly as the old code left it: a hash of 32 random bytes, no
   * `passwordChangedAt`, and the audit row the old path wrote.
   *
   * Built by hand rather than by calling the old code, because the old code is
   * gone — which is the point. This is the shape that exists in the production
   * database and nowhere in the source any more.
   */
  const legacyAccount = async (phone = randomPhone()) => {
    const user = await users.createCustomer({
      phone,
      passwordHash: await argon2.hash(randomBytes(32).toString('hex')),
      firstName: 'Customer',
      lastName: phone,
      locale: 'hy',
      isPhoneVerified: true,
      // No `passwordChangedAt` — exactly what `createCustomer` did before.
    });
    await prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        action: 'USER_LOGIN',
        entityType: 'User',
        entityId: user.id,
        metadata: { via: 'register_otp' },
      },
    });
    return user;
  };

  describe('they are not locked out', () => {
    it('can still sign in by SMS, which is what makes "change nothing" safe', async () => {
      const user = await legacyAccount();
      const lastCode = captureCode();

      await auth.requestLoginOtp({ phone: user.phone });
      const result = await auth.verifyLoginOtp(
        { phone: user.phone, code: lastCode(), deviceId: 'legacy-device' },
        {},
      );

      expect(result.tokens.accessToken).toBeTruthy();
      expect(result.user.id).toBe(user.id);
    });

    it('can set a password without knowing the random one, and then use it', async () => {
      const user = await legacyAccount();
      const lastCode = captureCode();

      // The existing reset flow, unchanged: ownership of the number is proved
      // by a fresh code, which is the only thing that may authorise this.
      await passwords.requestReset(user.phone, {});
      await passwords.confirmReset(user.phone, lastCode(), 'chosen-at-last-1', {});

      const signedIn = await auth.login(
        { phone: user.phone, password: 'chosen-at-last-1', deviceId: 'legacy-device' },
        {},
      );
      expect(signedIn.tokens.accessToken).toBeTruthy();
    });

    it('is not carrying mustChangePassword, so nothing closes the app around them', async () => {
      const user = await legacyAccount();
      const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      // `ChangePasswordDto` requires the current password, which they do not
      // have — so setting this flag would leave them able to reach only a page
      // they cannot complete. No migration sets it, and this says so.
      expect(row.mustChangePassword).toBe(false);
    });
  });

  describe('they can be named exactly', () => {
    it('finds the legacy account', async () => {
      const user = await legacyAccount();
      const found = await findAccountsWithUnknownPassword(prisma);
      expect(found.map((u) => u.id)).toEqual([user.id]);
    });

    it('does not name an account registered the new way', async () => {
      const phone = randomPhone();
      const lastCode = captureCode();
      await auth.requestRegistrationOtp({ phone });
      await auth.verifyRegistrationOtp(
        { phone, code: lastCode(), deviceId: 'd', password: 'chosen-by-the-customer-1' },
        {},
      );

      // It carries the same `via: 'register_otp'` audit marker — the flow is
      // still OTP-first. Only the second half of the criterion separates them,
      // which is exactly why the criterion has two halves.
      expect(await countAccountsEverRegisteredByOtp(prisma)).toBe(1);
      expect(await findAccountsWithUnknownPassword(prisma)).toEqual([]);
    });

    it('stops naming a legacy account once its owner has set a password', async () => {
      const user = await legacyAccount();
      expect(await findAccountsWithUnknownPassword(prisma)).toHaveLength(1);

      const lastCode = captureCode();
      await passwords.requestReset(user.phone, {});
      await passwords.confirmReset(user.phone, lastCode(), 'chosen-at-last-1', {});

      // Self-clearing: the set shrinks as people fix themselves, with nobody
      // running anything. The account is still counted as having started that
      // way, which is a different question.
      expect(await findAccountsWithUnknownPassword(prisma)).toEqual([]);
      expect(await countAccountsEverRegisteredByOtp(prisma)).toBe(1);
    });

    it('does not name a password-registered account at all', async () => {
      // No `via: 'register_otp'` row, so the first half excludes it — even
      // though `passwordChangedAt` is null here too, which is the case the
      // second half alone would get wrong.
      const phone = randomPhone();
      await users.createCustomer({
        phone,
        passwordHash: await argon2.hash('a-real-password-123'),
        firstName: 'Test',
        lastName: 'User',
        locale: 'hy',
      });

      expect(await findAccountsWithUnknownPassword(prisma)).toEqual([]);
      expect(await countAccountsEverRegisteredByOtp(prisma)).toBe(0);
    });

    it('does not name a deleted account, which has no access to lose', async () => {
      const user = await legacyAccount();
      await prisma.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });
      expect(await findAccountsWithUnknownPassword(prisma)).toEqual([]);
    });
  });
});
