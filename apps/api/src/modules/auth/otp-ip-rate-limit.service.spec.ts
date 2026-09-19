import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import configuration, { positiveIntEnv } from '../../config/configuration';
import {
  MAX_OTP_ISSUANCE_PER_IP_PER_HOUR,
  MAX_OTP_VERIFICATION_PER_IP_PER_HOUR,
  OtpIpRateLimitService,
} from './otp-ip-rate-limit.service';

/**
 * The per-address OTP ceilings are overridable from the environment so a
 * launch venue behind one address can be let in without a deploy. This pins
 * three things: the defaults are the documented constants, an override is
 * honoured, and a malformed override falls back rather than disabling the
 * ceiling.
 */
describe('OtpIpRateLimitService limits', () => {
  function build(limits?: { issuancePerHour: number; verificationPerHour: number }) {
    let counter = 0;
    const redis = {
      incr: jest.fn(() => {
        counter += 1;
        return Promise.resolve(counter);
      }),
      expire: jest.fn(() => Promise.resolve(1)),
    } as unknown as Redis;
    const config = {
      get: (key: string) => {
        if (key === 'clientIp') return { strategy: 'xff-depth', depth: 1 };
        if (key === 'otpIpLimits') return limits;
        return undefined;
      },
    } as unknown as ConfigService<never, true>;
    return new OtpIpRateLimitService(redis, config as never);
  }

  async function blockedAt(service: OtpIpRateLimitService, action: 'issue' | 'verify') {
    for (let i = 1; i <= 1000; i += 1) {
      try {
        await service.consume('203.0.113.7', action);
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        return i - 1;
      }
    }
    return Infinity;
  }

  it('uses the documented defaults when nothing is configured', async () => {
    expect(await blockedAt(build(undefined), 'issue')).toBe(MAX_OTP_ISSUANCE_PER_IP_PER_HOUR);
    expect(await blockedAt(build(undefined), 'verify')).toBe(MAX_OTP_VERIFICATION_PER_IP_PER_HOUR);
  });

  it('honours configured ceilings', async () => {
    const limits = { issuancePerHour: 300, verificationPerHour: 7 };
    expect(await blockedAt(build(limits), 'issue')).toBe(300);
    expect(await blockedAt(build(limits), 'verify')).toBe(7);
  });

  it('falls back to the default for anything that is not a positive whole number', () => {
    expect(positiveIntEnv(undefined, 60)).toBe(60);
    expect(positiveIntEnv('', 60)).toBe(60);
    expect(positiveIntEnv('  ', 60)).toBe(60);
    expect(positiveIntEnv('0', 60)).toBe(60);
    expect(positiveIntEnv('-5', 60)).toBe(60);
    expect(positiveIntEnv('12.5', 60)).toBe(60);
    expect(positiveIntEnv('lots', 60)).toBe(60);
    expect(positiveIntEnv('300', 60)).toBe(300);
  });

  it('clamps an override to ten times the default — a venue setting, never an off switch', () => {
    const previous = { ...process.env };
    process.env.OTP_IP_ISSUANCE_PER_HOUR = '999999';
    process.env.OTP_IP_VERIFICATION_PER_HOUR = '0';
    try {
      const limits = configuration().otpIpLimits;
      expect(limits.issuancePerHour).toBe(600);
      expect(limits.verificationPerHour).toBe(120);
    } finally {
      process.env = previous;
    }
  });
});
