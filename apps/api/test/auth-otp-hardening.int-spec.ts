import { Logger } from '@nestjs/common';
import { AuthOtpPurpose, PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { AuthService } from '../src/modules/auth/auth.service';
import { AuthOtpService } from '../src/modules/auth/auth-otp.service';
import {
  MAX_OTP_ISSUANCE_PER_IP_PER_HOUR,
  MAX_OTP_VERIFICATION_PER_IP_PER_HOUR,
} from '../src/modules/auth/otp-ip-rate-limit.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { REDIS_CLIENT } from '../src/infrastructure/redis/redis-client.token';
import { selectSmsTransport } from '../src/infrastructure/sms/sms-transport';
import { SMS_PROVIDER, SmsProvider } from '../src/infrastructure/sms/sms-provider.interface';
import { createCustomer } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * OTP hardening: where a live code is allowed to exist, and what it costs to
 * guess one.
 *
 * The confirmed leak this suite pins down: a LOGIN code was copied into a
 * `Notification` with the code in `params`, which
 * `NotificationsService.send` persists — so every issued code sat in the
 * database in plaintext and came back, still valid, from
 * `GET /notifications/me`. Anyone holding an access token for the account
 * could read the second factor that was supposed to protect it.
 *
 * The other half is rate limiting. The per-phone ceilings bound what can be
 * done to one number and nothing more; an attacker walking a list of numbers
 * gets a fresh budget with every one. `OtpIpRateLimitService` is the ceiling
 * that follows the caller instead of the target.
 */
describe('OTP hardening: no plaintext code at rest, and per-IP abuse limits (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let authService: AuthService;
  let otpService: AuthOtpService;
  let notifications: NotificationsService;
  let redis: Redis;
  let sms: SmsProvider;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    authService = harness.app.get(AuthService);
    otpService = harness.app.get(AuthOtpService);
    notifications = harness.app.get(NotificationsService);
    redis = harness.app.get<Redis>(REDIS_CLIENT);
    sms = harness.app.get<SmsProvider>(SMS_PROVIDER);
  });

  afterAll(async () => {
    await harness.close();
  });

  /** The per-IP buckets outlive a table truncation — they live in Redis. */
  const clearIpBuckets = async () => {
    const keys = await redis.keys('otp:ip:*');
    if (keys.length) await redis.del(...keys);
  };

  beforeEach(async () => {
    await truncateAll(prisma);
    await clearIpBuckets();
    jest.restoreAllMocks();
  });

  const randomPhone = () => `+3746${Math.floor(Math.random() * 90_000_000 + 10_000_000)}`;

  const captureCode = (): (() => string) => {
    const spy = jest.spyOn(sms, 'send');
    return () => {
      const call = spy.mock.calls.at(-1);
      const match = call?.[0]?.body.match(/(\d{6})/);
      if (!match?.[1]) throw new Error('no code found in SMS body');
      return match[1];
    };
  };

  // ── The code must not survive anywhere but the SMS ────────────────────

  describe('a live code is never persisted or returned', () => {
    it('writes no notification at all for a login code', async () => {
      const { user } = await createCustomer(prisma);
      await authService.requestLoginOtp({ phone: user.phone });

      expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(0);
    });

    it('leaves the code out of every persisted notification row', async () => {
      const { user } = await createCustomer(prisma);
      const lastCode = captureCode();
      await authService.requestLoginOtp({ phone: user.phone });
      const code = lastCode();

      const rows = await prisma.notification.findMany();
      expect(JSON.stringify(rows)).not.toContain(code);
    });

    it('never returns the code from /notifications/me', async () => {
      const { user } = await createCustomer(prisma);
      const lastCode = captureCode();
      await authService.requestLoginOtp({ phone: user.phone });
      const code = lastCode();

      const inbox = await notifications.listMine(user.id, { limit: 50 } as never);

      expect(JSON.stringify(inbox)).not.toContain(code);
    });

    it('stores only a hash of the code, never the code', async () => {
      const phone = randomPhone();
      const lastCode = captureCode();
      await authService.requestRegistrationOtp({ phone });
      const code = lastCode();

      const tokens = await prisma.authOtpToken.findMany({ where: { phone } });
      expect(tokens).toHaveLength(1);
      expect(JSON.stringify(tokens)).not.toContain(code);
      expect(tokens[0]!.codeHash).not.toContain(code);
    });

    it('keeps the code out of the request-OTP API response', async () => {
      const phone = randomPhone();
      const lastCode = captureCode();
      const response = await authService.requestRegistrationOtp({ phone });
      const code = lastCode();

      expect(JSON.stringify(response)).not.toContain(code);
      expect(response).toEqual({ success: true });
    });

    it('keeps the code out of the error raised when a wrong one is submitted', async () => {
      const phone = randomPhone();
      const lastCode = captureCode();
      await authService.requestRegistrationOtp({ phone });
      const code = lastCode();

      const err = await otpService
        .consumeCode(phone, AuthOtpPurpose.REGISTER, '000000')
        .catch((e: Error) => e);

      expect(err).toBeInstanceOf(Error);
      expect(JSON.stringify(err, Object.getOwnPropertyNames(err))).not.toContain(code);
    });

    it('never writes the code to the application log', async () => {
      // The SMS transport is stubbed out rather than spied through, because
      // the console provider these tests run against prints the message body
      // on purpose — that is what it is for on a developer's machine. What
      // this asserts is the rest of the application: no service, guard or
      // error handler on the issuing path puts the code in the log.
      const smsSpy = jest.spyOn(sms, 'send').mockResolvedValue({ providerMessageId: null });
      const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((level) =>
        jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
      );

      const { user } = await createCustomer(prisma);
      await authService.requestLoginOtp({ phone: user.phone });

      const code = smsSpy.mock.calls.at(-1)?.[0]?.body.match(/(\d{6})/)?.[1];
      expect(code).toBeTruthy();

      const logged = spies.flatMap((s) => s.mock.calls).map(String).join(' | ');
      expect(logged).not.toContain(code!);
    });

    it('never selects a code-logging transport for a public deployment', () => {
      // The console transport is what used to put live codes in a hosted
      // log, and DEMO_MODE was the configuration that reached it in
      // production. Asserted against the factory rather than a running app
      // so every combination can be checked, including the one that used to
      // be the hole.
      const build = (appEnv: 'development' | 'staging' | 'production', demoMode: boolean) =>
        selectSmsTransport({
          appEnv,
          demoMode,
          driver: 'http',
          endpoint: '',
          authScheme: 'basic',
          username: '',
          token: '',
          sender: 'TuTak',
          encoding: 'form',
          viva: {
            clientId: '',
            clientSecret: '',
            templateName: '',
            sendUtf: true,
            numberFormat: '',
            tokenPlacement: 'bearer',
          },
        });

      expect(build('staging', false).name).toContain('unavailable');
      expect(build('staging', true).name).toContain('unavailable');
      expect(build('production', true).name).toContain('unavailable');
      expect(() => build('production', false)).toThrow(/SMS_ENDPOINT must be configured/);

      // Only a developer's machine gets the transport that prints the body.
      expect(build('development', false).name).toContain('console');
    });
  });

  // ── Challenge lifecycle rules that must survive this change ───────────

  describe('challenge lifecycle', () => {
    it('rejects a code that has expired', async () => {
      const phone = randomPhone();
      const lastCode = captureCode();
      await authService.requestRegistrationOtp({ phone });
      const code = lastCode();

      await prisma.authOtpToken.updateMany({
        where: { phone },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await expect(otpService.consumeCode(phone, AuthOtpPurpose.REGISTER, code)).rejects.toThrow();
    });

    it('rejects the previous code once a new one is issued', async () => {
      const phone = randomPhone();
      const lastCode = captureCode();
      await authService.requestRegistrationOtp({ phone });
      const first = lastCode();
      await authService.requestRegistrationOtp({ phone });
      const second = lastCode();

      expect(first).not.toBe(second);
      await expect(otpService.consumeCode(phone, AuthOtpPurpose.REGISTER, first)).rejects.toThrow();
      await expect(otpService.consumeCode(phone, AuthOtpPurpose.REGISTER, second)).resolves.toBeUndefined();
    });

    it('rejects the sixth attempt on one challenge', async () => {
      const phone = randomPhone();
      const lastCode = captureCode();
      await authService.requestRegistrationOtp({ phone });
      const code = lastCode();

      for (let i = 0; i < 5; i += 1) {
        await expect(otpService.consumeCode(phone, AuthOtpPurpose.REGISTER, '000000')).rejects.toThrow();
      }
      // Burnt: even the right code no longer works.
      await expect(otpService.consumeCode(phone, AuthOtpPurpose.REGISTER, code)).rejects.toThrow();
    });

    it('rejects a second use of a consumed code', async () => {
      const phone = randomPhone();
      const lastCode = captureCode();
      await authService.requestRegistrationOtp({ phone });
      const code = lastCode();

      await expect(otpService.consumeCode(phone, AuthOtpPurpose.REGISTER, code)).resolves.toBeUndefined();
      await expect(otpService.consumeCode(phone, AuthOtpPurpose.REGISTER, code)).rejects.toThrow();
    });

    it('lets exactly one of two concurrent consumers through', async () => {
      const phone = randomPhone();
      const lastCode = captureCode();
      await authService.requestRegistrationOtp({ phone });
      const code = lastCode();

      const results = await Promise.allSettled([
        otpService.consumeCode(phone, AuthOtpPurpose.REGISTER, code),
        otpService.consumeCode(phone, AuthOtpPurpose.REGISTER, code),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    });

    it('will not let a REGISTER code be spent as a LOGIN code, or the reverse', async () => {
      const registerPhone = randomPhone();
      const lastCode = captureCode();
      await authService.requestRegistrationOtp({ phone: registerPhone });
      const registerCode = lastCode();
      await expect(
        otpService.consumeCode(registerPhone, AuthOtpPurpose.LOGIN, registerCode),
      ).rejects.toThrow();

      const { user } = await createCustomer(prisma);
      await authService.requestLoginOtp({ phone: user.phone });
      const loginCode = lastCode();
      await expect(
        otpService.consumeCode(user.phone, AuthOtpPurpose.REGISTER, loginCode),
      ).rejects.toThrow();
    });

    it('still caps issuance per phone at five an hour', async () => {
      const phone = randomPhone();
      for (let i = 0; i < 5; i += 1) {
        await expect(otpService.requestCode(phone, AuthOtpPurpose.REGISTER)).resolves.toEqual({
          success: true,
        });
      }
      await expect(otpService.requestCode(phone, AuthOtpPurpose.REGISTER)).rejects.toThrow();
    });
  });

  // ── The ceiling that follows the caller, not the target ───────────────

  describe('per-IP abuse limits', () => {
    const attacker = '203.0.113.9';

    it('stops issuance spread across many different phone numbers from one address', async () => {
      // Every number is fresh, so the per-phone ceiling never fires once —
      // this is exactly the walk it could not see.
      let blockedAt: number | null = null;

      for (let i = 0; i < MAX_OTP_ISSUANCE_PER_IP_PER_HOUR + 5; i += 1) {
        try {
          await authService.requestRegistrationOtp(
            { phone: randomPhone() },
            { ipAddress: attacker },
          );
        } catch {
          blockedAt = i;
          break;
        }
      }

      expect(blockedAt).toBe(MAX_OTP_ISSUANCE_PER_IP_PER_HOUR);
    });

    it('stops guessing spread across many different phone numbers from one address', async () => {
      let blockedAt: number | null = null;

      for (let i = 0; i < MAX_OTP_VERIFICATION_PER_IP_PER_HOUR + 5; i += 1) {
        const err = await otpService
          .consumeCode(randomPhone(), AuthOtpPurpose.LOGIN, '000000', attacker)
          .catch((e: Error) => e);
        if ((err as Error).message.includes('Too many codes')) {
          blockedAt = i;
          break;
        }
      }

      expect(blockedAt).toBe(MAX_OTP_VERIFICATION_PER_IP_PER_HOUR);
    });

    it('budgets issuance and verification separately', async () => {
      // Spending the whole verification budget must not close the door on
      // somebody at the same address who simply wants a code.
      for (let i = 0; i < MAX_OTP_VERIFICATION_PER_IP_PER_HOUR; i += 1) {
        await otpService.consumeCode(randomPhone(), AuthOtpPurpose.LOGIN, '000000', attacker).catch(() => undefined);
      }
      await expect(
        otpService.consumeCode(randomPhone(), AuthOtpPurpose.LOGIN, '000000', attacker),
      ).rejects.toThrow(/Too many codes/);

      await expect(
        authService.requestRegistrationOtp({ phone: randomPhone() }, { ipAddress: attacker }),
      ).resolves.toEqual({ success: true });
    });

    it('does not let one address exhaust anybody else, and leaves shared addresses room', async () => {
      const neighbour = '198.51.100.4';

      for (let i = 0; i < MAX_OTP_ISSUANCE_PER_IP_PER_HOUR; i += 1) {
        await authService.requestRegistrationOtp({ phone: randomPhone() }, { ipAddress: attacker });
      }
      await expect(
        authService.requestRegistrationOtp({ phone: randomPhone() }, { ipAddress: attacker }),
      ).rejects.toThrow();

      // A different address is untouched...
      await expect(
        authService.requestRegistrationOtp({ phone: randomPhone() }, { ipAddress: neighbour }),
      ).resolves.toEqual({ success: true });

      // ...and the ceiling is high enough that a dozen people sharing one
      // carrier-NAT address in the same hour are nowhere near it.
      for (let i = 0; i < 12; i += 1) {
        await expect(
          authService.requestRegistrationOtp({ phone: randomPhone() }, { ipAddress: neighbour }),
        ).resolves.toEqual({ success: true });
      }
    });

    it('charges the per-IP budget whether or not the number is registered', async () => {
      // Otherwise the limit itself becomes the enumeration oracle the 403
      // removal closed: a taken number would cost nothing, a free one would.
      const { user } = await createCustomer(prisma);

      for (let i = 0; i < MAX_OTP_ISSUANCE_PER_IP_PER_HOUR; i += 1) {
        await authService.requestRegistrationOtp({ phone: user.phone }, { ipAddress: attacker });
      }

      await expect(
        authService.requestRegistrationOtp({ phone: user.phone }, { ipAddress: attacker }),
      ).rejects.toThrow();
    });

    it('keeps serving requests when Redis cannot answer, rather than locking everyone out', async () => {
      jest.spyOn(redis, 'incr').mockRejectedValue(new Error('connection refused'));

      await expect(
        authService.requestRegistrationOtp({ phone: randomPhone() }, { ipAddress: attacker }),
      ).resolves.toEqual({ success: true });
    });
  });
});
