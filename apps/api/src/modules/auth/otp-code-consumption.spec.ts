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
    consumedAt?: Date | null;
  };

  /**
   * One row, modelled rather than mocked.
   *
   * The double used to answer every `update` with `{}` and every `updateMany`
   * with a fixed count. That is enough to record what was asked for and
   * nothing at all about what would happen — and the service reads the row it
   * gets back (`bumped.attempts`, `bumped.consumedAt`) to decide whether to
   * burn the challenge. Against `{}` both are `undefined`, the burn branch
   * never ran, and the test that exists to prove burning still passed by
   * inspecting the arguments of a call whose effect it never saw.
   *
   * So the stub keeps a row and applies writes to it: `{ increment: n }`
   * increments, a conditional `updateMany` respects its condition and reports
   * a truthful count. Assertions below are on the row's resulting state, not
   * on the shape of a Prisma argument — the service is free to express the
   * same write differently, and a test that pinned the spelling would have to
   * be edited every time it did, which is exactly what happened here.
   *
   * It is still not a database. Whether two of these racing each other
   * actually serialise is a question only PostgreSQL answers, and
   * `otp-consumption-races.int-spec.ts` asks it there.
   */
  const build = (options: {
    challenge: Row | null;
    attemptsInWindow?: number;
    /** Another request consumes the same challenge between our read and our write. */
    spentByAnotherRequest?: boolean;
  }) => {
    const row: Row | null = options.challenge
      ? { consumedAt: null, ...options.challenge }
      : null;

    const applyData = (target: Row, data: Record<string, unknown>) => {
      for (const [field, value] of Object.entries(data)) {
        if (field === 'attempts' && value && typeof value === 'object' && 'increment' in value) {
          target.attempts += (value as { increment: number }).increment;
        } else {
          (target as unknown as Record<string, unknown>)[field] = value;
        }
      }
    };

    // `Promise.resolve` rather than `async`: these hand back a promise
    // because Prisma does, and an `async` function with nothing to await is
    // a lint error that would have to be silenced rather than answered.
    const update = jest.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      if (!row || row.id !== where.id) return Promise.reject(new Error('record to update not found'));
      applyData(row, data);
      // Prisma returns the row as it stands after the write, which is the
      // whole reason the service can read the post-increment count.
      return Promise.resolve({ ...row });
    });

    const updateMany = jest.fn(
      ({ where, data }: { where: { id: string; consumedAt?: null }; data: Record<string, unknown> }) => {
        if (!row || row.id !== where.id) return Promise.resolve({ count: 0 });
        // The condition that makes the write a claim rather than an
        // overwrite: it matches nothing once somebody else has spent the row.
        if (where.consumedAt === null && row.consumedAt != null) return Promise.resolve({ count: 0 });
        applyData(row, data);
        return Promise.resolve({ count: 1 });
      },
    );

    const prisma = {
      authOtpToken: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { attempts: options.attemptsInWindow ?? 0 } }),
        findFirst: jest.fn(() => {
          if (!row) return Promise.resolve(null);
          const seen = { ...row };
          // The race, modelled where it really happens: this request read a
          // live challenge, and the other request spent it before this one
          // got to its own write.
          if (options.spentByAnotherRequest) row.consumedAt = new Date();
          return Promise.resolve(seen);
        }),
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
    return { service, update, updateMany, row };
  };

  const live = { id: 't1', codeHash: sha256Hex(CODE), attempts: 0 };

  it('accepts the right code and spends it', async () => {
    const { service, updateMany, row } = build({ challenge: live });

    await expect(service.consumeCode(PHONE, AuthOtpPurpose.LOGIN, CODE)).resolves.toBeUndefined();
    // Actually spent, not merely asked about.
    expect(row?.consumedAt).toBeInstanceOf(Date);
    // And spent conditionally on still being unconsumed: two requests racing
    // the same code must not both pass.
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
    ['a code spent by a racing request', { challenge: live, spentByAnotherRequest: true }],
  ])('refuses %s with exactly the same answer', async (_case, options) => {
    const { service } = build(options as { challenge: Row | null; spentByAnotherRequest?: boolean });

    await expect(service.consumeCode(PHONE, AuthOtpPurpose.LOGIN, CODE)).rejects.toThrow(
      'Code is invalid or has expired',
    );
  });

  it('counts a wrong attempt against the challenge', async () => {
    const { service, update, row } = build({ challenge: { ...live, codeHash: sha256Hex('000000') } });

    await expect(service.consumeCode(PHONE, AuthOtpPurpose.LOGIN, CODE)).rejects.toThrow();

    expect(row?.attempts).toBe(1);
    // Counted by the database, never by this process. `attempts + 1` computed
    // here would let N guesses arriving together all read the same number and
    // all write the same one, so N wrong guesses would cost one attempt and
    // the ceiling below could be walked past by firing them in parallel.
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { attempts: { increment: 1 } } }),
    );
  });

  it('leaves a challenge usable while attempts remain', async () => {
    const { service, row } = build({ challenge: { ...live, codeHash: sha256Hex('000000'), attempts: 3 } });

    await expect(service.consumeCode(PHONE, AuthOtpPurpose.LOGIN, CODE)).rejects.toThrow();

    // Fourth of five. Burning here would lock someone out of their own code
    // for one more typo than the limit allows.
    expect(row?.attempts).toBe(4);
    expect(row?.consumedAt).toBeNull();
  });

  it('burns the challenge once the attempts run out, rather than letting it be guessed', async () => {
    const { service, row } = build({ challenge: { ...live, codeHash: sha256Hex('000000'), attempts: 4 } });

    await expect(service.consumeCode(PHONE, AuthOtpPurpose.LOGIN, CODE)).rejects.toThrow();

    expect(row?.attempts).toBe(5);
    // The state that matters: the challenge is spent, so the sixth guess has
    // nothing left to guess at. `findFirst` filters on `consumedAt: null`.
    expect(row?.consumedAt).toBeInstanceOf(Date);
  });

  it('does not burn a challenge another request already spent', async () => {
    // The interleaving the conditional write exists for: this attempt crosses
    // the limit, but by the time it gets there the row is consumed. Writing
    // `consumedAt` again would move a timestamp that already means something.
    const { service, updateMany } = build({
      challenge: { ...live, codeHash: sha256Hex('000000'), attempts: 4, consumedAt: new Date() },
    });

    await expect(service.consumeCode(PHONE, AuthOtpPurpose.LOGIN, CODE)).rejects.toThrow();

    expect(updateMany).not.toHaveBeenCalled();
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
