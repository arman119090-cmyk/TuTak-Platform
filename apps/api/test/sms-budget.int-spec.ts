import { ServiceUnavailableException } from '@nestjs/common';
import { AuthOtpPurpose, PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../src/modules/auth/auth.service';
import { AuthOtpService } from '../src/modules/auth/auth-otp.service';
import { PhoneVerificationService } from '../src/modules/auth/phone-verification.service';
import { PasswordService } from '../src/modules/auth/password.service';
import { SmsBudgetService } from '../src/infrastructure/sms/sms-budget.service';
import { BudgetedSmsProvider } from '../src/infrastructure/sms/budgeted-sms.provider';
import { REDIS_CLIENT } from '../src/infrastructure/redis/redis-client.token';
import { SMS_PROVIDER, SmsProvider } from '../src/infrastructure/sms/sms-provider.interface';
import { createCustomer } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * The one limit that does not care who is asking.
 *
 * Every other ceiling is keyed to a phone number or a source address, so a
 * botnet spread widely enough stays under all of them at once while the
 * carrier bill grows with the size of the botnet. This is what bounds the
 * spend itself, and it is enforced in the SMS layer so that registration,
 * login, phone verification and password reset all draw on it without each
 * having to remember to.
 */
describe('Global SMS budget (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let redis: Redis;
  let authService: AuthService;
  let otpService: AuthOtpService;
  let sms: SmsProvider;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    redis = harness.app.get<Redis>(REDIS_CLIENT);
    authService = harness.app.get(AuthService);
    otpService = harness.app.get(AuthOtpService);
    sms = harness.app.get<SmsProvider>(SMS_PROVIDER);
  });

  afterAll(async () => {
    await harness.close();
  });

  const clearBudget = async () => {
    const keys = await redis.keys('sms:budget:*');
    if (keys.length) await redis.del(...keys);
  };

  beforeEach(async () => {
    await truncateAll(prisma);
    await clearBudget();
    jest.restoreAllMocks();
  });

  const randomPhone = () => `+3746${Math.floor(Math.random() * 90_000_000 + 10_000_000)}`;

  /** A budget with ceilings this test controls, over the real Redis. */
  const budgetWith = (perHour: number, perDay: number) =>
    new SmsBudgetService(redis, {
      get: () => ({ globalMaxPerHour: perHour, globalMaxPerDay: perDay }),
    } as unknown as ConfigService<never, true>);

  describe('ceilings', () => {
    it('allows exactly the hourly allowance and then refuses', async () => {
      const budget = budgetWith(3, 1000);

      await expect(budget.claim()).resolves.toBeUndefined();
      await expect(budget.claim()).resolves.toBeUndefined();
      await expect(budget.claim()).resolves.toBeUndefined();
      await expect(budget.claim()).rejects.toThrow(ServiceUnavailableException);
    });

    it('refuses on the daily ceiling even when the hour has room', async () => {
      const budget = budgetWith(1000, 2);

      await budget.claim();
      await budget.claim();
      await expect(budget.claim()).rejects.toThrow(ServiceUnavailableException);
    });

    it('says nothing specific about why, to the caller', async () => {
      const budget = budgetWith(0, 1000);
      const err = await budget.claim().catch((e: Error) => e);

      // A caller learns that delivery is unavailable, not that the platform
      // has an exhausted budget or what its size is.
      expect((err as Error).message).toBe(
        'Verification code delivery is temporarily unavailable. Please try again later.',
      );
    });

    it('counts atomically under concurrency, admitting no more than the ceiling', async () => {
      const budget = budgetWith(5, 1000);

      const results = await Promise.allSettled(
        Array.from({ length: 20 }, () => budget.claim()),
      );

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(15);
    });
  });

  describe('Redis failure', () => {
    it('fails closed: no send is allowed when the budget cannot be checked', async () => {
      // The opposite choice to the per-IP limiter, and deliberately so: there,
      // failing open costs a weaker rate limit; here it would remove the only
      // bound on what the carrier can bill.
      const budget = budgetWith(1000, 1000);
      jest.spyOn(redis, 'pipeline').mockImplementation(() => {
        throw new Error('connection refused');
      });

      await expect(budget.claim()).rejects.toThrow(ServiceUnavailableException);
    });

    it('does not send the message when the claim fails', async () => {
      const inner: SmsProvider = { name: 'fake', send: jest.fn() };
      const budget = budgetWith(0, 0);
      const provider = new BudgetedSmsProvider(inner, budget);

      await expect(provider.send({ to: '+37411111111', body: 'x' })).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(inner.send).not.toHaveBeenCalled();
    });
  });

  describe('coverage of every SMS-producing flow', () => {
    it('routes the wired provider through the budget', () => {
      // Not "auth remembers to check": the token every flow injects is
      // itself the budgeted one, so a flow added later is covered without
      // being told.
      expect(sms.name).toContain('budgeted:');
    });

    it.each([
      ['registration OTP', async () => authService.requestRegistrationOtp({ phone: randomPhone() })],
      [
        'login OTP',
        async () => {
          const { user } = await createCustomer(prisma);
          return authService.requestLoginOtp({ phone: user.phone });
        },
      ],
      [
        'auth OTP service directly',
        async () => otpService.requestCode(randomPhone(), AuthOtpPurpose.REGISTER),
      ],
    ])('draws %s from the same budget', async (_label, run) => {
      const before = await redis.get(`sms:budget:hour:${Math.floor(Date.now() / 3_600_000)}`);
      await run();
      const after = await redis.get(`sms:budget:hour:${Math.floor(Date.now() / 3_600_000)}`);

      expect(Number(after ?? 0)).toBeGreaterThan(Number(before ?? 0));
    });

    it('is the same provider instance phone verification and password reset hold', () => {
      // Asserted by identity rather than by behaviour: these two flows send
      // from services this suite does not otherwise drive, and what matters
      // is that they cannot be holding an unbudgeted transport.
      expect(harness.app.get(PhoneVerificationService)['sms']).toBe(sms);
      expect(harness.app.get(PasswordService)['sms']).toBe(sms);
    });
  });
});
