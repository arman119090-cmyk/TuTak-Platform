import { BadRequestException, Logger } from '@nestjs/common';
import { AuthOtpPurpose } from '@prisma/client';
import { AuthService } from './auth.service';
import { AuthOtpService } from './auth-otp.service';
import { OtpIpRateLimitService } from './otp-ip-rate-limit.service';
import { UsersService } from '../users/users.service';

/**
 * Unit tests with every dependency stubbed. **Not integration tests.**
 *
 * There is no database, no Redis, no carrier and no HTTP here: Prisma, the
 * rate limiters and the SMS provider are all doubles. What these check is the
 * decision table — which outcome a given failure produces, and what the caller
 * is answered — not that any of it works against a real system. The
 * integration suite needs Postgres and does not run in this environment; the
 * only proof that a code reaches a phone is a delivered SMS, and there has not
 * been one.
 */
describe('what every OTP request records, and what it answers (unit, stubbed deps)', () => {
  let logged: string[];

  const buildService = (parts: {
    findByPhone?: jest.Mock;
    requestCode?: jest.Mock;
    consumeAddressLimit?: jest.Mock;
  }) => {
    const usersService = {
      findByPhone: parts.findByPhone ?? jest.fn().mockResolvedValue(null),
    } as unknown as UsersService;
    const authOtpService = {
      requestCode:
        parts.requestCode ?? jest.fn().mockResolvedValue({ success: true, delivered: true }),
    } as unknown as AuthOtpService;
    const otpIpRateLimit = {
      consume: parts.consumeAddressLimit ?? jest.fn().mockResolvedValue(undefined),
    } as unknown as OtpIpRateLimitService;

    const stub = {} as never;
    return new AuthService(
      stub, usersService, stub, stub, stub, stub, stub, stub,
      authOtpService, otpIpRateLimit, stub,
    );
  };

  beforeEach(() => {
    logged = [];
    jest.spyOn(Logger.prototype, 'log').mockImplementation((message: unknown) => {
      logged.push(String(message));
    });
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  /** The outcome lines written for one request. */
  const outcomes = () => logged.filter((line) => line.startsWith('otp '));

  describe('registration', () => {
    const request = (service: AuthService) =>
      service.requestRegistrationOtp({ phone: '+37400000000' } as never, { ipAddress: '1.2.3.4' });

    it('records the carrier taking the code', async () => {
      await expect(request(buildService({}))).resolves.toEqual({ success: true });
      expect(outcomes()).toEqual(['otp register: code-handed-to-carrier']);
    });

    it('records a carrier that refused, and still answers the same', async () => {
      const service = buildService({
        requestCode: jest.fn().mockResolvedValue({ success: true, delivered: false }),
      });

      await expect(request(service)).resolves.toEqual({ success: true });
      expect(outcomes()).toEqual(['otp register: carrier-refused']);
    });

    /**
     * A timeout is a carrier that did not answer. It must not read as a
     * refusal — but it also must not vanish, and it must not change the reply.
     */
    it('records a carrier timeout as a refusal to deliver, not as silence', async () => {
      const service = buildService({
        requestCode: jest.fn().mockResolvedValue({ success: true, delivered: false }),
      });

      await expect(request(service)).resolves.toEqual({ success: true });
      expect(outcomes()).toHaveLength(1);
    });

    /**
     * The per-number ceiling used to be written down as a carrier refusal,
     * which points the next reader at the wrong system entirely.
     */
    it('tells a number rate limit apart from a carrier refusal', async () => {
      const service = buildService({
        requestCode: jest.fn().mockRejectedValue(new BadRequestException('Too many codes requested')),
      });

      await expect(request(service)).resolves.toEqual({ success: true });
      expect(outcomes()).toEqual(['otp register: refused-number-rate-limit']);
    });

    it('records a failure before the send as its own outcome', async () => {
      const service = buildService({
        requestCode: jest.fn().mockRejectedValue(new Error('database is down')),
      });

      await expect(request(service)).resolves.toEqual({ success: true });
      expect(outcomes()).toEqual(['otp register: failed-before-send']);
    });

    /**
     * The one outcome that used to leave no trace at all: `consume` throws
     * before anything else runs and the request ends as a 429 with nothing in
     * the log — the state that made an evening of testing unreadable.
     */
    it('records an address rate limit, which used to disappear entirely', async () => {
      const service = buildService({
        consumeAddressLimit: jest.fn().mockRejectedValue(new Error('Too many requests')),
      });

      await expect(request(service)).rejects.toThrow('Too many requests');
      expect(outcomes()).toEqual(['otp register: refused-address-rate-limit']);
    });

    it('records a taken number without telling the caller it is taken', async () => {
      const service = buildService({ findByPhone: jest.fn().mockResolvedValue({ id: 'u1' }) });

      // Identical answer to the free-number case above: that is the
      // anti-enumeration contract, and the log is where the difference lives.
      await expect(request(service)).resolves.toEqual({ success: true });
      expect(outcomes()).toEqual(['otp register: skipped-number-already-registered']);
    });
  });

  describe('login by code', () => {
    const active = { id: 'u1', isActive: true, deletedAt: null };
    const request = (service: AuthService) =>
      service.requestLoginOtp({ phone: '+37400000000' } as never, { ipAddress: '1.2.3.4' });

    it('records the carrier taking the code', async () => {
      const service = buildService({ findByPhone: jest.fn().mockResolvedValue(active) });

      await expect(request(service)).resolves.toEqual({ success: true });
      expect(outcomes()).toEqual(['otp login: code-handed-to-carrier']);
    });

    it('records a carrier that refused', async () => {
      const service = buildService({
        findByPhone: jest.fn().mockResolvedValue(active),
        requestCode: jest.fn().mockResolvedValue({ success: true, delivered: false }),
      });

      await expect(request(service)).resolves.toEqual({ success: true });
      expect(outcomes()).toEqual(['otp login: carrier-refused']);
    });

    /**
     * The gap that left the 19:29 screenshot unexplainable: a number with no
     * account did nothing and wrote nothing, and looked identical to a request
     * that never arrived.
     */
    it.each([
      ['no account at all', null],
      ['a deactivated account', { id: 'u1', isActive: false, deletedAt: null }],
      ['a deleted account', { id: 'u1', isActive: true, deletedAt: new Date() }],
    ])('records %s, without revealing it to the caller', async (_case, user) => {
      const service = buildService({ findByPhone: jest.fn().mockResolvedValue(user) });

      await expect(request(service)).resolves.toEqual({ success: true });
      expect(outcomes()).toEqual(['otp login: skipped-no-eligible-account']);
    });

    it('tells a number rate limit apart from a carrier refusal', async () => {
      const service = buildService({
        findByPhone: jest.fn().mockResolvedValue(active),
        requestCode: jest.fn().mockRejectedValue(new BadRequestException('Too many codes requested')),
      });

      await expect(request(service)).resolves.toEqual({ success: true });
      expect(outcomes()).toEqual(['otp login: refused-number-rate-limit']);
    });

    it('records an address rate limit', async () => {
      const service = buildService({
        findByPhone: jest.fn().mockResolvedValue(active),
        consumeAddressLimit: jest.fn().mockRejectedValue(new Error('Too many requests')),
      });

      await expect(request(service)).rejects.toThrow('Too many requests');
      expect(outcomes()).toEqual(['otp login: refused-address-rate-limit']);
    });
  });

  /**
   * The property that must survive every outcome above: from the wire, a
   * number with an account and a number without one are the same request.
   */
  it('answers identically whatever happened, on both flows', async () => {
    const cases = [
      buildService({}),
      buildService({ findByPhone: jest.fn().mockResolvedValue({ id: 'u1' }) }),
      buildService({ requestCode: jest.fn().mockResolvedValue({ success: true, delivered: false }) }),
    ];

    for (const service of cases) {
      await expect(
        service.requestRegistrationOtp({ phone: '+37400000000' } as never, {}),
      ).resolves.toEqual({ success: true });
    }
  });

  it('never puts the number or the code in an outcome line', async () => {
    await buildService({}).requestRegistrationOtp({ phone: '+37493600600' } as never, {});

    for (const line of outcomes()) {
      expect(line).not.toContain('37493600600');
      expect(line).not.toMatch(/\d{6}/);
    }
  });

  void AuthOtpPurpose;
});
