import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthOtpPurpose, PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { AuthService } from '../src/modules/auth/auth.service';
import { AuthOtpService } from '../src/modules/auth/auth-otp.service';
import { SMS_PROVIDER, SmsProvider } from '../src/infrastructure/sms/sms-provider.interface';
import { sha256Hex } from '../src/common/utils/crypto';
import { createCustomer } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Item 3: phone -> SMS OTP -> account/login, no password.
 *
 * Neither `PhoneVerificationToken` nor `PasswordResetToken` fits this —
 * both require a User row that does not exist yet for a first-time
 * registrant — so `AuthOtpToken` is phone-keyed instead, exactly like this
 * suite's counterparts (`phone-verification.int-spec.ts`,
 * `password.int-spec.ts`) test their own challenge tables.
 */
describe('OTP-first auth (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let authService: AuthService;
  let otpService: AuthOtpService;
  let sms: SmsProvider;
  let config: ConfigService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    authService = harness.app.get(AuthService);
    otpService = harness.app.get(AuthOtpService);
    sms = harness.app.get<SmsProvider>(SMS_PROVIDER);
    config = harness.app.get(ConfigService);
  });

  /**
   * Turns production mode on for one test, the way a real deployment's env
   * would — same idiom as `demo-session.int-spec.ts`'s `withDemoMode`.
   * `demoMode` defaults to off, matching a real production deployment;
   * pass `true` to prove the explicit demo-mode escape hatch still works.
   */
  const withProductionMode = (demoMode = false) =>
    jest.spyOn(config, 'get').mockImplementation(((key: string, ...rest: unknown[]) => {
      if (key === 'nodeEnv') return 'production';
      if (key === 'demoMode') return demoMode;
      return (ConfigService.prototype.get as any).call(config, key, ...rest);
    }) as never);

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    jest.restoreAllMocks();
  });

  const randomPhone = () => `+3746${Math.floor(Math.random() * 90_000_000 + 10_000_000)}`;

  /** Captures the code from the outbound SMS body rather than the DB, which stores only its hash. */
  const captureCode = (): (() => string) => {
    const spy = jest.spyOn(sms, 'send');
    return () => {
      const call = spy.mock.calls.at(-1);
      const match = call?.[0]?.body.match(/(\d{6})/);
      if (!match?.[1]) throw new Error('no code found in SMS body');
      return match[1];
    };
  };

  // ── Registration ──────────────────────────────────────────────────────

  describe('registration', () => {
    it('creates a verified, passwordless account end to end', async () => {
      const phone = randomPhone();
      const lastCode = captureCode();
      await authService.requestRegistrationOtp({ phone });

      const result = await authService.verifyRegistrationOtp(
        { phone, code: lastCode(), deviceId: 'device-1' },
        {},
      );

      expect(result.user.phone).toBe(phone);
      expect(result.user.isPhoneVerified).toBe(true);
      expect(result.tokens.accessToken).toBeTruthy();

      const row = await prisma.user.findUniqueOrThrow({ where: { phone } });
      expect(row.isPhoneVerified).toBe(true);
      expect(row.passwordHash).not.toBe('');
    });

    it('fills in a placeholder name when none is given, and honours one when given', async () => {
      const phone1 = randomPhone();
      const lastCode1 = captureCode();
      await authService.requestRegistrationOtp({ phone: phone1 });
      const r1 = await authService.verifyRegistrationOtp(
        { phone: phone1, code: lastCode1(), deviceId: 'device-1' },
        {},
      );
      expect(r1.user.firstName).toBeTruthy();
      expect(r1.user.lastName).toBeTruthy();

      const phone2 = randomPhone();
      const lastCode2 = captureCode();
      await authService.requestRegistrationOtp({ phone: phone2 });
      const r2 = await authService.verifyRegistrationOtp(
        { phone: phone2, code: lastCode2(), firstName: 'Ani', lastName: 'Petrosyan', deviceId: 'device-2' },
        {},
      );
      expect(r2.user.firstName).toBe('Ani');
      expect(r2.user.lastName).toBe('Petrosyan');
    });

    it('makes the account passwordless: a random-guess password login fails cleanly, not with a crash', async () => {
      const phone = randomPhone();
      const lastCode = captureCode();
      await authService.requestRegistrationOtp({ phone });
      await authService.verifyRegistrationOtp({ phone, code: lastCode(), deviceId: 'device-1' }, {});

      await expect(
        authService.login({ phone, password: 'whatever-someone-typed', deviceId: 'device-1' }, {}),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('captures referral attribution exactly once, at registration', async () => {
      const referrer = await createCustomer(prisma);
      const code = await prisma.referralCode.create({
        data: { userId: referrer.user.id, code: `TT-${referrer.user.id.slice(0, 8).toUpperCase()}` },
      });

      const phone = randomPhone();
      const lastCode = captureCode();
      await authService.requestRegistrationOtp({ phone });
      const result = await authService.verifyRegistrationOtp(
        { phone, code: lastCode(), referralCode: code.code, deviceId: 'device-1' },
        {},
      );

      const invite = await prisma.referralInvite.findUnique({
        where: { refereeUserId: result.user.id },
      });
      expect(invite?.referrerUserId).toBe(referrer.user.id);

      // Immutable: nothing about the flow accepts a referral code again.
      expect(await prisma.referralInvite.count({ where: { refereeUserId: result.user.id } })).toBe(1);
    });

    it('reports success for an already-registered number, but issues no code for it', async () => {
      // Was a 403 naming the reason, which made this unauthenticated endpoint
      // an account-existence oracle for any number an attacker cared to try.
      // The refusal now happens at verify time instead, where a code the
      // caller never received is what stops them.
      const { user } = await createCustomer(prisma);
      const sendSpy = jest.spyOn(sms, 'send');

      await expect(authService.requestRegistrationOtp({ phone: user.phone })).resolves.toEqual({
        success: true,
      });

      expect(sendSpy).not.toHaveBeenCalled();
      expect(await prisma.authOtpToken.count({ where: { phone: user.phone } })).toBe(0);
    });

    it('answers a taken number and a free number identically', async () => {
      const { user } = await createCustomer(prisma);
      const free = randomPhone();

      const taken = await authService.requestRegistrationOtp({ phone: user.phone });
      const untaken = await authService.requestRegistrationOtp({ phone: free });

      expect(taken).toEqual(untaken);
    });

    it('still refuses at verify time when the number was taken in the meantime', async () => {
      const phone = randomPhone();
      const lastCode = captureCode();
      await authService.requestRegistrationOtp({ phone });
      const code = lastCode();

      await createCustomer(prisma, { phone });

      await expect(
        authService.verifyRegistrationOtp({ phone, code, deviceId: 'device-1' }, {}),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses a wrong code and burns the challenge after five tries', async () => {
      const phone = randomPhone();
      const lastCode = captureCode();
      await authService.requestRegistrationOtp({ phone });
      const code = lastCode();

      for (let i = 0; i < 5; i += 1) {
        await expect(
          authService.verifyRegistrationOtp({ phone, code: '000000', deviceId: 'd' }, {}),
        ).rejects.toThrow(UnauthorizedException);
      }
      await expect(
        authService.verifyRegistrationOtp({ phone, code, deviceId: 'd' }, {}),
      ).rejects.toThrow(UnauthorizedException);
      expect(await prisma.user.findUnique({ where: { phone } })).toBeNull();
    });

    it('refuses an expired code', async () => {
      const phone = randomPhone();
      const lastCode = captureCode();
      await authService.requestRegistrationOtp({ phone });
      const code = lastCode();
      await prisma.authOtpToken.updateMany({
        where: { phone },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await expect(
        authService.verifyRegistrationOtp({ phone, code, deviceId: 'd' }, {}),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('cannot be replayed', async () => {
      const phone = randomPhone();
      const lastCode = captureCode();
      await authService.requestRegistrationOtp({ phone });
      const code = lastCode();
      await authService.verifyRegistrationOtp({ phone, code, deviceId: 'd1' }, {});

      await expect(
        authService.verifyRegistrationOtp({ phone, code, deviceId: 'd2' }, {}),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('issues no more than five codes an hour for one number', async () => {
      // Asserted as an effect rather than as a thrown error. The endpoint
      // reports success either way now, because a "too many codes" rejection
      // is itself an oracle: it only ever fires for a number that has been
      // sent codes, i.e. a registered-adjacent one. The ceiling still holds —
      // the sixth request simply produces no challenge and no SMS.
      const phone = randomPhone();
      for (let i = 0; i < 5; i += 1) await authService.requestRegistrationOtp({ phone });

      const sendSpy = jest.spyOn(sms, 'send');
      await expect(authService.requestRegistrationOtp({ phone })).resolves.toEqual({ success: true });

      expect(sendSpy).not.toHaveBeenCalled();
      expect(await prisma.authOtpToken.count({ where: { phone } })).toBe(5);
    });

    it('still enforces the per-phone ceiling as an error on the service itself', async () => {
      // The rule the endpoint now hides is unchanged underneath, where
      // nothing about enumeration applies.
      const phone = randomPhone();
      for (let i = 0; i < 5; i += 1) {
        await otpService.requestCode(phone, AuthOtpPurpose.REGISTER);
      }
      await expect(otpService.requestCode(phone, AuthOtpPurpose.REGISTER)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── Login ──────────────────────────────────────────────────────────────

  describe('login', () => {
    it('logs an existing customer in end to end', async () => {
      const { user } = await createCustomer(prisma);
      const lastCode = captureCode();
      await authService.requestLoginOtp({ phone: user.phone });

      const result = await authService.verifyLoginOtp(
        { phone: user.phone, code: lastCode(), deviceId: 'device-1' },
        {},
      );
      expect(result.user.id).toBe(user.id);
      expect(result.tokens.accessToken).toBeTruthy();
    });

    it('always reports success, whether or not the number is registered', async () => {
      await expect(authService.requestLoginOtp({ phone: randomPhone() })).resolves.toEqual({
        success: true,
      });
      const { user } = await createCustomer(prisma);
      await expect(authService.requestLoginOtp({ phone: user.phone })).resolves.toEqual({
        success: true,
      });
    });

    it('never issues a challenge for an unregistered number', async () => {
      const phone = randomPhone();
      await authService.requestLoginOtp({ phone });
      expect(await prisma.authOtpToken.count({ where: { phone } })).toBe(0);
    });

    it('refuses a code for a locked account', async () => {
      const { user } = await createCustomer(prisma);
      await prisma.user.update({
        where: { id: user.id },
        data: { lockedUntil: new Date(Date.now() + 60_000) },
      });
      const lastCode = captureCode();
      await authService.requestLoginOtp({ phone: user.phone });

      await expect(
        authService.verifyLoginOtp({ phone: user.phone, code: lastCode(), deviceId: 'd' }, {}),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('refuses a code for a deactivated account', async () => {
      const { user } = await createCustomer(prisma, { isActive: false });
      // Issue the challenge directly — requestLoginOtp itself would silently
      // skip an inactive account, which is a separate assertion below.
      await prisma.authOtpToken.create({
        data: {
          phone: user.phone,
          purpose: 'LOGIN',
          codeHash: sha256Hex('123456'),
          expiresAt: new Date(Date.now() + 60_000),
        },
      });

      await expect(
        authService.verifyLoginOtp({ phone: user.phone, code: '123456', deviceId: 'd' }, {}),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('does not request a code at all for a deactivated account', async () => {
      const { user } = await createCustomer(prisma, { isActive: false });
      await authService.requestLoginOtp({ phone: user.phone });
      expect(await prisma.authOtpToken.count({ where: { phone: user.phone } })).toBe(0);
    });

    it('cannot be replayed', async () => {
      const { user } = await createCustomer(prisma);
      const lastCode = captureCode();
      await authService.requestLoginOtp({ phone: user.phone });
      const code = lastCode();
      await authService.verifyLoginOtp({ phone: user.phone, code, deviceId: 'd1' }, {});

      await expect(
        authService.verifyLoginOtp({ phone: user.phone, code, deviceId: 'd2' }, {}),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── Backward compatibility ───────────────────────────────────────────────

  describe('backward compatibility', () => {
    it('leaves password registration and login untouched outside production', async () => {
      const phone = randomPhone();
      const registered = await authService.register(
        {
          phone,
          password: 'a-real-password-123',
          firstName: 'Test',
          lastName: 'User',
          deviceId: 'device-1',
        },
        {},
      );
      expect(registered.user.phone).toBe(phone);

      const loggedIn = await authService.login(
        { phone, password: 'a-real-password-123', deviceId: 'device-1' },
        {},
      );
      expect(loggedIn.user.id).toBe(registered.user.id);
    });

    /**
     * Final financial blocker (2026-08-18): OTP registration
     * (`requestRegistrationOtp`/`verifyRegistrationOtp` above) is the only
     * normal public customer signup path — it requires a verified code
     * before the account exists at all. This password-only route stood up
     * a fully functional, spend-capable account with zero proof of phone
     * ownership at any point. The mobile app stopped linking to it
     * (commit c3156a8), but that only closed the UI path — the HTTP route
     * itself stayed reachable by any client that called it directly. Same
     * guard idiom as `PaymentsModule`'s PSP requirement
     * (`production-boot.int-spec.ts`): refuse in production unless
     * `demoMode` explicitly allows it.
     */
    it('refuses password registration in production', async () => {
      withProductionMode();
      await expect(
        authService.register(
          {
            phone: randomPhone(),
            password: 'a-real-password-123',
            firstName: 'Test',
            lastName: 'User',
            deviceId: 'device-1',
          },
          {},
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('still allows password registration in production when demo mode explicitly permits it', async () => {
      withProductionMode(true);
      const phone = randomPhone();
      const registered = await authService.register(
        {
          phone,
          password: 'a-real-password-123',
          firstName: 'Test',
          lastName: 'User',
          deviceId: 'device-1',
        },
        {},
      );
      expect(registered.user.phone).toBe(phone);
    });

    it('leaves OTP registration itself untouched in production — the canonical path never needed the guard', async () => {
      withProductionMode();
      const phone = randomPhone();
      const lastCode = captureCode();
      await authService.requestRegistrationOtp({ phone });
      const registered = await authService.verifyRegistrationOtp(
        { phone, code: lastCode(), deviceId: 'device-otp-prod' },
        {},
      );
      expect(registered.user.phone).toBe(phone);
    });

    it('the OTP-account passwordHash is a real argon2 hash, not the raw account-deletion sentinel', async () => {
      const phone = randomPhone();
      const lastCode = captureCode();
      await authService.requestRegistrationOtp({ phone });
      await authService.verifyRegistrationOtp({ phone, code: lastCode(), deviceId: 'd' }, {});

      const row = await prisma.user.findUniqueOrThrow({ where: { phone } });
      expect(row.passwordHash.startsWith('$argon2')).toBe(true);
      await expect(argon2.verify(row.passwordHash, 'anything')).resolves.toBe(false);
    });
  });
});
