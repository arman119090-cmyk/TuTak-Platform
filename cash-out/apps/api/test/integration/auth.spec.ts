import { createHarness, Harness, resetDatabase, seedPricing } from '../harness';

describe('driver authentication', () => {
  let harness: Harness;
  const phone = '+37411777001';
  const deviceId = 'device-aaaaaaaa';

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
    harness.sms.lastCodes.clear();
    await seedPricing(harness.prisma);
  });

  async function signIn(withPhone = phone, withDevice = deviceId) {
    const challenge = await harness.auth.requestOtp({
      phone: withPhone,
      deviceId: withDevice,
      locale: 'hy',
    });
    const code = harness.sms.lastCodes.get(withPhone)!;
    return harness.auth.verifyOtp({ challengeId: challenge.challengeId, code, deviceId: withDevice });
  }

  describe('one-time codes', () => {
    it('never stores the code itself', async () => {
      const challenge = await harness.auth.requestOtp({ phone, deviceId, locale: 'hy' });
      const code = harness.sms.lastCodes.get(phone)!;
      const row = await harness.prisma.otpChallenge.findUniqueOrThrow({
        where: { id: challenge.challengeId },
      });

      expect(code).toMatch(/^\d{6}$/);
      expect(row.codeHash).not.toContain(code);
      expect(row.codeHash.startsWith('s1:')).toBe(true);
    });

    it('signs a new driver in and creates their account', async () => {
      const tokens = await signIn();
      expect(tokens.isNewUser).toBe(true);
      expect(tokens.accessToken).toBeTruthy();

      const user = await harness.prisma.user.findUniqueOrThrow({ where: { phone } });
      const driver = await harness.prisma.driver.findUniqueOrThrow({ where: { userId: user.id } });
      expect(driver.verificationStatus).toBe('UNLINKED');
    });

    it('recognises a returning driver', async () => {
      await signIn();
      harness.clock.advanceSeconds(60);
      const second = await signIn();
      expect(second.isNewUser).toBe(false);
      expect(await harness.prisma.user.count()).toBe(1);
    });

    it('rejects a wrong code and counts the attempt', async () => {
      const challenge = await harness.auth.requestOtp({ phone, deviceId, locale: 'hy' });
      await expect(
        harness.auth.verifyOtp({ challengeId: challenge.challengeId, code: '000000', deviceId }),
      ).rejects.toMatchObject({ code: 'OTP_INVALID' });

      const row = await harness.prisma.otpChallenge.findUniqueOrThrow({
        where: { id: challenge.challengeId },
      });
      expect(row.attempts).toBe(1);
    });

    it('locks a challenge after too many attempts, even with the right code', async () => {
      const challenge = await harness.auth.requestOtp({ phone, deviceId, locale: 'hy' });
      const code = harness.sms.lastCodes.get(phone)!;

      for (let i = 0; i < 5; i += 1) {
        await expect(
          harness.auth.verifyOtp({ challengeId: challenge.challengeId, code: '000000', deviceId }),
        ).rejects.toBeDefined();
      }

      await expect(
        harness.auth.verifyOtp({ challengeId: challenge.challengeId, code, deviceId }),
      ).rejects.toMatchObject({ code: 'OTP_TOO_MANY_ATTEMPTS' });
    });

    it('refuses a code issued to a different device', async () => {
      const challenge = await harness.auth.requestOtp({ phone, deviceId, locale: 'hy' });
      const code = harness.sms.lastCodes.get(phone)!;

      await expect(
        harness.auth.verifyOtp({
          challengeId: challenge.challengeId,
          code,
          deviceId: 'device-bbbbbbbb',
        }),
      ).rejects.toMatchObject({ code: 'OTP_INVALID' });
    });

    it('refuses an expired code', async () => {
      const challenge = await harness.auth.requestOtp({ phone, deviceId, locale: 'hy' });
      const code = harness.sms.lastCodes.get(phone)!;
      harness.clock.advanceSeconds(301);

      await expect(
        harness.auth.verifyOtp({ challengeId: challenge.challengeId, code, deviceId }),
      ).rejects.toMatchObject({ code: 'OTP_EXPIRED' });
    });

    it('will not let one code be used twice', async () => {
      const challenge = await harness.auth.requestOtp({ phone, deviceId, locale: 'hy' });
      const code = harness.sms.lastCodes.get(phone)!;
      await harness.auth.verifyOtp({ challengeId: challenge.challengeId, code, deviceId });

      await expect(
        harness.auth.verifyOtp({ challengeId: challenge.challengeId, code, deviceId }),
      ).rejects.toMatchObject({ code: 'OTP_INVALID' });
    });

    it('enforces a cooldown between sends', async () => {
      await harness.auth.requestOtp({ phone, deviceId, locale: 'hy' });
      await expect(
        harness.auth.requestOtp({ phone, deviceId, locale: 'hy' }),
      ).rejects.toMatchObject({ code: 'OTP_REQUEST_TOO_SOON' });
    });

    it('caps the number of codes per phone per hour', async () => {
      for (let i = 0; i < 5; i += 1) {
        await harness.auth.requestOtp({ phone, deviceId, locale: 'hy' });
        harness.clock.advanceSeconds(16);
      }
      await expect(
        harness.auth.requestOtp({ phone, deviceId, locale: 'hy' }),
      ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    });
  });

  describe('sessions and tokens', () => {
    it('rotates the refresh token on every use', async () => {
      const first = await signIn();
      const second = await harness.auth.refresh(first.refreshToken, deviceId);

      expect(second.refreshToken).not.toBe(first.refreshToken);
      expect(second.accessToken).toBeTruthy();
    });

    it('revokes the whole family when an old refresh token reappears', async () => {
      const first = await signIn();
      const second = await harness.auth.refresh(first.refreshToken, deviceId);

      // The stolen copy is presented after the legitimate rotation.
      await expect(harness.auth.refresh(first.refreshToken, deviceId)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });

      // And the family that was rotated out of is dead too.
      await expect(harness.auth.refresh(second.refreshToken, deviceId)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });

      const live = await harness.prisma.session.count({ where: { revokedAt: null } });
      expect(live).toBe(0);
    });

    it('refuses a refresh token presented by a different device', async () => {
      const first = await signIn();
      await expect(
        harness.auth.refresh(first.refreshToken, 'device-cccccccc'),
      ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it('lists live sessions and can end all of them', async () => {
      await signIn();
      harness.clock.advanceSeconds(30);
      await signIn(phone, 'device-second-01');

      const user = await harness.prisma.user.findUniqueOrThrow({ where: { phone } });
      expect(await harness.auth.listSessions(user.id, 'none')).toHaveLength(2);

      await harness.auth.signOutEverywhere(user.id);
      expect(await harness.auth.listSessions(user.id, 'none')).toHaveLength(0);
    });
  });

  describe('linking to a Yandex profile', () => {
    it('links a driver whose phone and licence match exactly one profile', async () => {
      const { Money } = await import('@cashout/money');
      harness.yandex.seed({
        parkId: 'park-1',
        contractorProfileId: 'contractor-9001',
        phone,
        firstName: 'Tigran',
        lastName: 'Petrosyan',
        licenceNumber: 'AM7654321',
        balance: Money.fromMinor(1_000_000n, 'AMD'),
      });
      await signIn();
      const user = await harness.prisma.user.findUniqueOrThrow({ where: { phone } });

      const profile = await harness.drivers.link(user.id, {
        parkId: 'park-1',
        licenceLast4: '4321',
      });
      expect(profile.verificationStatus).toBe('VERIFIED');
      expect(profile.yandexContractorProfileId).toBe('contractor-9001');
    });

    it('refuses the wrong licence digits', async () => {
      const { Money } = await import('@cashout/money');
      harness.yandex.seed({
        parkId: 'park-1',
        contractorProfileId: 'contractor-9002',
        phone,
        firstName: 'Tigran',
        lastName: 'Petrosyan',
        licenceNumber: 'AM7654321',
        balance: Money.fromMinor(1_000_000n, 'AMD'),
      });
      await signIn();
      const user = await harness.prisma.user.findUniqueOrThrow({ where: { phone } });

      await expect(
        harness.drivers.link(user.id, { parkId: 'park-1', licenceLast4: '1111' }),
      ).rejects.toMatchObject({ code: 'PHONE_NOT_LINKED_TO_DRIVER' });
    });

    it('sends an ambiguous match to a human instead of guessing', async () => {
      const { Money } = await import('@cashout/money');
      for (const id of ['contractor-a', 'contractor-b']) {
        harness.yandex.seed({
          parkId: 'park-1',
          contractorProfileId: id,
          phone,
          firstName: 'Tigran',
          lastName: 'Petrosyan',
          licenceNumber: 'AM7654321',
          balance: Money.fromMinor(1_000_000n, 'AMD'),
        });
      }
      await signIn();
      const user = await harness.prisma.user.findUniqueOrThrow({ where: { phone } });

      await expect(
        harness.drivers.link(user.id, { parkId: 'park-1', licenceLast4: '4321' }),
      ).rejects.toMatchObject({ code: 'PHONE_NOT_LINKED_TO_DRIVER' });

      const driver = await harness.prisma.driver.findUniqueOrThrow({ where: { userId: user.id } });
      expect(driver.verificationStatus).toBe('PENDING');
    });

    it('refuses to link a Yandex profile that another account already owns', async () => {
      const { Money } = await import('@cashout/money');
      harness.yandex.seed({
        parkId: 'park-1',
        contractorProfileId: 'contractor-shared',
        phone,
        firstName: 'Tigran',
        lastName: 'Petrosyan',
        licenceNumber: 'AM7654321',
        balance: Money.fromMinor(1_000_000n, 'AMD'),
      });
      await signIn();
      const first = await harness.prisma.user.findUniqueOrThrow({ where: { phone } });
      await harness.drivers.link(first.id, { parkId: 'park-1', licenceLast4: '4321' });

      // The same Yandex profile now answers to a second phone number — the
      // situation a driver changing SIMs, or an attacker, would create.
      harness.yandex.seed({
        parkId: 'park-1',
        contractorProfileId: 'contractor-shared',
        phone: '+37411777002',
        firstName: 'Tigran',
        lastName: 'Petrosyan',
        licenceNumber: 'AM7654321',
        balance: Money.fromMinor(1_000_000n, 'AMD'),
      });

      harness.clock.advanceSeconds(60);
      await signIn('+37411777002', 'device-second-99');
      const second = await harness.prisma.user.findUniqueOrThrow({
        where: { phone: '+37411777002' },
      });

      await expect(
        harness.drivers.link(second.id, { parkId: 'park-1', licenceLast4: '4321' }),
      ).rejects.toMatchObject({ code: 'PHONE_NOT_LINKED_TO_DRIVER' });
    });
  });
});
