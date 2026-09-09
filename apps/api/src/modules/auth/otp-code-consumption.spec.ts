import { AuthOtpPurpose } from '@prisma/client';
import { AuthOtpService } from './auth-otp.service';
import { OtpIpRateLimitService } from './otp-ip-rate-limit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SmsProvider } from '../../infrastructure/sms/sms-provider.interface';
import { sha256Hex } from '../../common/utils/crypto';

/**
 * Unit tests with a stubbed database. **Not integration tests.**
 *
 * Prisma is a double here: these check what `consumeCode` decides given a row,
 * not that the rows are written or read correctly. That needs Postgres and the
 * integration suite, which does not run in this environment.
 *
 * What they do pin is the property the verify step exists to hold: a wrong
 * code, an expired code and a code already spent are **one answer**, not
 * three. Anything that told them apart would say whether a code had been
 * issued for a number, which is the same oracle the request step was hardened
 * against.
 */
describe('consuming an OTP (unit, stubbed database)', () => {
  const PHONE = '+37400000000';
  const CODE = '123456';

  type Row = {
    id: string;
    codeHash: string;
    attempts: number;
  } | null;

  const build = (options: { challenge: Row; attemptsInWindow?: number; consumed?: number }) => {
    const update = jest.fn().mockResolvedValue({});
    const updateMany = jest.fn().mockResolvedValue({ count: options.consumed ?? 1 });
    const prisma = {
      authOtpToken: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { attempts: options.attemptsInWindow ?? 0 } }),
        findFirst: jest.fn().mockResolvedValue(options.challenge),
        update,
        updateMany,
      },
    } as unknown as PrismaService;
    const ipRateLimit = {
      consume: jest.fn().mockResolvedValue(undefined),
    } as unknown as OtpIpRateLimitService;
    const service = new AuthOtpService(prisma, ipRateLimit, {
      name: 'stub',
      send: jest.fn(),
    } as unknown as SmsProvider);
    return { service, update, updateMany };
  };

  const live = { id: 't1', codeHash: sha256Hex(CODE), attempts: 0 };

  it('accepts the right code and spends it', async () => {
    const { service, updateMany } = build({ challenge: live });

    await expect(service.consumeCode(PHONE, AuthOtpPurpose.LOGIN, CODE)).resolves.toBeUndefined();
    // Spent conditionally on still being unconsumed: two requests racing the
    // same code must not both pass.
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ consumedAt: null }) }),
    );
  });

  /**
   * The three failures that must be indistinguishable. `findFirst` filters on
   * `consumedAt: null` and `expiresAt > now`, so an expired code and one
   * already spent both arrive here as "no live challenge" — and a wrong code
   * arrives as a hash mismatch. One message, one status, for all three.
   */
  it.each([
    ['a wrong code', { challenge: { ...live, codeHash: sha256Hex('000000') } }],
    ['an expired code', { challenge: null }],
    ['a code already used', { challenge: null }],
    ['a code spent by a racing request', { challenge: live, consumed: 0 }],
  ])('refuses %s with exactly the same answer', async (_case, options) => {
    const { service } = build(options as { challenge: Row; consumed?: number });

    await expect(service.consumeCode(PHONE, AuthOtpPurpose.LOGIN, CODE)).rejects.toThrow(
      'Code is invalid or has expired',
    );
  });

  it('counts a wrong attempt against the challenge', async () => {
    const { service, update } = build({ challenge: { ...live, codeHash: sha256Hex('000000') } });

    await expect(service.consumeCode(PHONE, AuthOtpPurpose.LOGIN, CODE)).rejects.toThrow();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ attempts: 1 }) }),
    );
  });

  it('burns the challenge once the attempts run out, rather than letting it be guessed', async () => {
    const { service, update } = build({ challenge: { ...live, codeHash: sha256Hex('000000'), attempts: 4 } });

    await expect(service.consumeCode(PHONE, AuthOtpPurpose.LOGIN, CODE)).rejects.toThrow();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ attempts: 5, consumedAt: expect.any(Date) }),
      }),
    );
  });

  it('refuses once the hourly attempt budget for the number is spent', async () => {
    const { service } = build({ challenge: live, attemptsInWindow: 15 });

    // The right code, and still refused: the ceiling is on the number, not on
    // this challenge — and the refusal reads the same as a wrong code.
    await expect(service.consumeCode(PHONE, AuthOtpPurpose.LOGIN, CODE)).rejects.toThrow(
      'Code is invalid or has expired',
    );
  });

  it('charges the per-address verify budget before looking anything up', async () => {
    const consume = jest.fn().mockRejectedValue(new Error('Too many requests'));
    const prisma = {
      authOtpToken: { aggregate: jest.fn(), findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    } as unknown as PrismaService;
    const service = new AuthOtpService(prisma, { consume } as unknown as OtpIpRateLimitService, {
      name: 'stub',
      send: jest.fn(),
    } as unknown as SmsProvider);

    await expect(service.consumeCode(PHONE, AuthOtpPurpose.LOGIN, CODE, '1.2.3.4')).rejects.toThrow(
      'Too many requests',
    );
    expect(prisma.authOtpToken.findFirst).not.toHaveBeenCalled();
  });
});
