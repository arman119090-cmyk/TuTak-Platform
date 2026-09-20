import {
  authorizeWithPin,
  createHarness,
  Harness,
  requestWithdrawal,
  resetDatabase,
  seedDriver,
  SeededDriver,
  seedPricing,
  TEST_PIN,
} from '../harness';

/**
 * PIN, biometric enrolment, and the single-use authorization every withdrawal
 * is created against.
 */
describe('withdrawal authorization', () => {
  let harness: Harness;
  let driver: SeededDriver;
  const device = () => ({ userId: driver.userId, deviceId: driver.deviceId });

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase(harness.prisma);
    await harness.rateLimiter.resetAll();
    harness.yandex.reset();
    harness.provider.reset();
    await seedPricing(harness.prisma);
    driver = await seedDriver(harness, { balance: 5_000_000n });
  });

  async function quote(amountMinor = 1_000_000n) {
    return harness.quotes.create(driver.driverId, {
      payoutMethodId: driver.payoutMethodId,
      amount: { minor: amountMinor.toString(), currency: 'AMD' },
      all: false,
    });
  }

  describe('the PIN', () => {
    it('is stored as a slow hash, never as digits', async () => {
      const row = await harness.prisma.driverSecurity.findUniqueOrThrow({
        where: { driverId: driver.driverId },
      });
      expect(row.pinHash).not.toContain(TEST_PIN);
      expect(row.pinHash?.startsWith('s1:')).toBe(true);
      expect((await harness.security.status(driver.driverId, device())).pinSet).toBe(true);
    });

    it('cannot be set twice, and refuses obvious sequences', async () => {
      await expect(harness.security.setPin(driver.driverId, '111111')).rejects.toMatchObject({
        code: 'PIN_ALREADY_SET',
      });
      await expect(
        harness.security.changePin(driver.driverId, TEST_PIN, '123456'),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      await expect(
        harness.security.changePin(driver.driverId, TEST_PIN, '777777'),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('authorizes with the right PIN and refuses the wrong one, counting attempts', async () => {
      const q = await quote();
      const ok = await harness.security.authorize(driver.driverId, device(), {
        method: 'PIN',
        pin: TEST_PIN,
        purpose: 'WITHDRAWAL',
        quoteId: q.quoteId,
      });
      expect(ok.authorizationToken.length).toBeGreaterThanOrEqual(32);
      expect(ok.method).toBe('PIN');

      await expect(
        harness.security.authorize(driver.driverId, device(), {
          method: 'PIN',
          pin: '000001',
          purpose: 'WITHDRAWAL',
        }),
      ).rejects.toMatchObject({ code: 'PIN_INVALID', details: { attemptsRemaining: 4 } });

      const audit = await harness.prisma.auditLog.findMany({
        where: { action: { in: ['withdrawal.authorized', 'security.pin_failed'] } },
      });
      expect(audit.map((row) => row.action).sort()).toEqual([
        'security.pin_failed',
        'withdrawal.authorized',
      ]);
    });

    it('locks after five wrong PINs, for longer each time, and unlocks with time', async () => {
      for (let i = 0; i < 4; i += 1) {
        await expect(
          harness.security.authorize(driver.driverId, device(), {
            method: 'PIN',
            pin: '000001',
            purpose: 'WITHDRAWAL',
          }),
        ).rejects.toMatchObject({ code: 'PIN_INVALID' });
      }
      await expect(
        harness.security.authorize(driver.driverId, device(), {
          method: 'PIN',
          pin: '000001',
          purpose: 'WITHDRAWAL',
        }),
      ).rejects.toMatchObject({ code: 'PIN_LOCKED', details: { retryAfterSeconds: 900 } });

      // Even the right PIN is refused while locked.
      await expect(
        harness.security.authorize(driver.driverId, device(), {
          method: 'PIN',
          pin: TEST_PIN,
          purpose: 'WITHDRAWAL',
        }),
      ).rejects.toMatchObject({ code: 'PIN_LOCKED' });
      expect(
        (await harness.security.status(driver.driverId, device())).pinLockedUntil,
      ).not.toBeNull();

      harness.clock.advanceSeconds(901);
      await expect(
        harness.security.authorize(driver.driverId, device(), {
          method: 'PIN',
          pin: TEST_PIN,
          purpose: 'WITHDRAWAL',
        }),
      ).resolves.toMatchObject({ method: 'PIN' });

      // A second lockout lasts twice as long.
      for (let i = 0; i < 5; i += 1) {
        await harness.security
          .authorize(driver.driverId, device(), {
            method: 'PIN',
            pin: '000001',
            purpose: 'WITHDRAWAL',
          })
          .catch(() => undefined);
      }
      await expect(
        harness.security.authorize(driver.driverId, device(), {
          method: 'PIN',
          pin: TEST_PIN,
          purpose: 'WITHDRAWAL',
        }),
      ).rejects.toMatchObject({ code: 'PIN_LOCKED', details: { retryAfterSeconds: 1800 } });

      const locks = await harness.prisma.auditLog.count({
        where: { action: 'security.pin_locked' },
      });
      expect(locks).toBe(2);
    });

    it('changes the PIN only with the current one', async () => {
      await expect(
        harness.security.changePin(driver.driverId, '999000', '246810'),
      ).rejects.toMatchObject({ code: 'PIN_INVALID' });
      await harness.security.changePin(driver.driverId, TEST_PIN, '246810');
      await expect(
        harness.security.authorize(driver.driverId, device(), {
          method: 'PIN',
          pin: '246810',
          purpose: 'WITHDRAWAL',
        }),
      ).resolves.toMatchObject({ method: 'PIN' });
    });
  });

  describe('biometrics', () => {
    it('enrols a device with the PIN, returns the secret once, and authorizes with it', async () => {
      const { deviceSecret } = await harness.security.enableBiometric(
        driver.driverId,
        TEST_PIN,
        device(),
      );
      const row = await harness.prisma.driverSecurity.findUniqueOrThrow({
        where: { driverId: driver.driverId },
      });
      expect(row.biometricSecretHash).not.toContain(deviceSecret);
      expect(
        (await harness.security.status(driver.driverId, device())).biometricEnabledOnThisDevice,
      ).toBe(true);

      const result = await harness.security.authorize(driver.driverId, device(), {
        method: 'BIOMETRIC',
        deviceSecret,
        purpose: 'WITHDRAWAL',
      });
      expect(result.method).toBe('BIOMETRIC');
    });

    it('refuses a wrong secret, another device, and a driver who never enrolled', async () => {
      await expect(
        harness.security.authorize(driver.driverId, device(), {
          method: 'BIOMETRIC',
          deviceSecret: 'x'.repeat(43),
          purpose: 'WITHDRAWAL',
        }),
      ).rejects.toMatchObject({ code: 'BIOMETRIC_NOT_ENROLLED' });

      const { deviceSecret } = await harness.security.enableBiometric(
        driver.driverId,
        TEST_PIN,
        device(),
      );
      await expect(
        harness.security.authorize(driver.driverId, device(), {
          method: 'BIOMETRIC',
          deviceSecret: 'x'.repeat(43),
          purpose: 'WITHDRAWAL',
        }),
      ).rejects.toMatchObject({ code: 'AUTHORIZATION_INVALID' });

      // The secret is bound to the device it was issued to.
      await harness.prisma.device.create({
        data: { userId: driver.userId, deviceId: 'device-second-phone' },
      });
      await expect(
        harness.security.authorize(
          driver.driverId,
          { userId: driver.userId, deviceId: 'device-second-phone' },
          { method: 'BIOMETRIC', deviceSecret, purpose: 'WITHDRAWAL' },
        ),
      ).rejects.toMatchObject({ code: 'BIOMETRIC_NOT_ENROLLED' });
    });

    it('falls back to the PIN after biometrics are disabled', async () => {
      const { deviceSecret } = await harness.security.enableBiometric(
        driver.driverId,
        TEST_PIN,
        device(),
      );
      await harness.security.disableBiometric(driver.driverId);
      await expect(
        harness.security.authorize(driver.driverId, device(), {
          method: 'BIOMETRIC',
          deviceSecret,
          purpose: 'WITHDRAWAL',
        }),
      ).rejects.toMatchObject({ code: 'BIOMETRIC_NOT_ENROLLED' });
      await expect(
        harness.security.authorize(driver.driverId, device(), {
          method: 'PIN',
          pin: TEST_PIN,
          purpose: 'WITHDRAWAL',
        }),
      ).resolves.toMatchObject({ method: 'PIN' });
    });
  });

  describe('confirming a withdrawal', () => {
    it('refuses a confirmation with no valid authorization', async () => {
      const q = await quote();
      await expect(
        harness.withdrawals.confirm(driver.driverId, {
          quoteId: q.quoteId,
          signature: q.signature,
          idempotencyKey: 'no-authorization-key-0001',
          authorizationToken: 'not-a-real-token-at-all-0000',
        }),
      ).rejects.toMatchObject({ code: 'AUTHORIZATION_INVALID' });
      expect(await harness.prisma.withdrawal.count()).toBe(0);
    });

    it('spends the authorization exactly once', async () => {
      const q = await quote();
      const token = await authorizeWithPin(harness, driver, q.quoteId);
      const created = await harness.withdrawals.confirm(driver.driverId, {
        quoteId: q.quoteId,
        signature: q.signature,
        idempotencyKey: 'spend-authorization-key-1',
        authorizationToken: token,
      });
      const row = await harness.prisma.withdrawalAuthorization.findFirstOrThrow({
        where: { driverId: driver.driverId },
      });
      expect(row.consumedAt).not.toBeNull();
      expect(row.consumedByWithdrawalId).toBe(created.id);

      await harness.prisma.withdrawal.updateMany({ data: { state: 'COMPLETED' } });
      const q2 = await quote();
      await expect(
        harness.withdrawals.confirm(driver.driverId, {
          quoteId: q2.quoteId,
          signature: q2.signature,
          idempotencyKey: 'reuse-authorization-key-1',
          authorizationToken: token,
        }),
      ).rejects.toMatchObject({ code: 'AUTHORIZATION_INVALID' });
    });

    it('refuses an authorization given for another quote, or expired', async () => {
      const q1 = await quote(1_000_000n);
      const q2 = await quote(2_000_000n);
      const forQ1 = await authorizeWithPin(harness, driver, q1.quoteId);
      await expect(
        harness.withdrawals.confirm(driver.driverId, {
          quoteId: q2.quoteId,
          signature: q2.signature,
          idempotencyKey: 'wrong-quote-authorization1',
          authorizationToken: forQ1,
        }),
      ).rejects.toMatchObject({ code: 'AUTHORIZATION_INVALID' });

      harness.clock.advanceSeconds(121);
      const q3 = await quote();
      // Token issued before the clock moved: expired now.
      await expect(
        harness.withdrawals.confirm(driver.driverId, {
          quoteId: q3.quoteId,
          signature: q3.signature,
          idempotencyKey: 'expired-authorization-key',
          authorizationToken: forQ1,
        }),
      ).rejects.toMatchObject({ code: 'AUTHORIZATION_INVALID' });
    });

    it('records which method authorized the withdrawal', async () => {
      const created = await requestWithdrawal(harness, driver, 1_000_000n);
      const event = await harness.prisma.withdrawalEvent.findFirstOrThrow({
        where: { withdrawalId: created.id, toState: 'CREATED' },
      });
      expect(event.note).toContain('(PIN)');
      const audit = await harness.prisma.auditLog.findFirstOrThrow({
        where: { action: 'withdrawal.created', subjectId: created.id },
      });
      expect((audit.after as { authorization?: string }).authorization).toBe('PIN');
    });
  });
});
