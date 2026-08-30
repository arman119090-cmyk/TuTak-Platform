import type { PrismaClient } from '@prisma/client';
import {
  BOOTSTRAP_ADMIN_PHONE,
  MIN_PASSWORD_LENGTH,
  StagingAdminResetRefused,
  resetStagingAdminPassword,
} from './reset-staging-admin-password';

jest.mock('argon2', () => ({
  hash: jest.fn().mockResolvedValue('argon2-hash-of-the-new-password'),
}));

/**
 * The forbidden-delegate proxy is the actual test of "no business data is
 * touched": rather than asserting that a list of tables was left alone —
 * which only ever covers the tables somebody remembered to list — anything
 * outside the two allowed delegates throws, so a future edit that reaches
 * for `partner`, `wallet`, `purchaseIntent` or a table that does not exist
 * yet fails this suite by construction.
 */
describe('resetStagingAdminPassword', () => {
  const userFindUnique = jest.fn();
  const userUpdate = jest.fn().mockResolvedValue({});
  const refreshTokenUpdateMany = jest.fn().mockResolvedValue({ count: 3 });

  const allowedDelegates = {
    user: { findUnique: userFindUnique, update: userUpdate },
    refreshToken: { updateMany: refreshTokenUpdateMany },
  };

  const guard = (target: object): PrismaClient =>
    new Proxy(target, {
      get(t, property, receiver) {
        if (property === 'then') return undefined;
        if (Reflect.has(t, property)) return Reflect.get(t, property, receiver);
        throw new Error(`reset touched forbidden Prisma delegate: ${String(property)}`);
      },
    }) as unknown as PrismaClient;

  const prisma = guard({
    ...allowedDelegates,
    $transaction: (fn: (tx: PrismaClient) => Promise<unknown>) => fn(guard(allowedDelegates)),
  });

  const stagingEnv = {
    NODE_ENV: 'staging',
    RESET_STAGING_ADMIN_PASSWORD: 'true',
    SEED_ADMIN_PASSWORD: 'a-fresh-temporary-password',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    userFindUnique.mockResolvedValue({ id: 'bootstrap-admin-id' });
  });

  describe('refuses to run', () => {
    it.each(['production', 'development', 'test', undefined])(
      'when the flag is set but NODE_ENV is %s',
      async (nodeEnv) => {
        await expect(
          resetStagingAdminPassword(prisma, { ...stagingEnv, NODE_ENV: nodeEnv }),
        ).rejects.toBeInstanceOf(StagingAdminResetRefused);

        expect(userFindUnique).not.toHaveBeenCalled();
        expect(userUpdate).not.toHaveBeenCalled();
        expect(refreshTokenUpdateMany).not.toHaveBeenCalled();
      },
    );

    it('when SEED_ADMIN_PASSWORD is missing', async () => {
      await expect(
        resetStagingAdminPassword(prisma, { ...stagingEnv, SEED_ADMIN_PASSWORD: undefined }),
      ).rejects.toBeInstanceOf(StagingAdminResetRefused);
      expect(userUpdate).not.toHaveBeenCalled();
    });

    it('when SEED_ADMIN_PASSWORD is shorter than the minimum', async () => {
      const tooShort = 'x'.repeat(MIN_PASSWORD_LENGTH - 1);
      await expect(
        resetStagingAdminPassword(prisma, { ...stagingEnv, SEED_ADMIN_PASSWORD: tooShort }),
      ).rejects.toBeInstanceOf(StagingAdminResetRefused);
      expect(userUpdate).not.toHaveBeenCalled();
    });

    it('when the bootstrap administrator does not exist', async () => {
      userFindUnique.mockResolvedValue(null);
      await expect(resetStagingAdminPassword(prisma, stagingEnv)).rejects.toBeInstanceOf(
        StagingAdminResetRefused,
      );
      expect(userUpdate).not.toHaveBeenCalled();
      expect(refreshTokenUpdateMany).not.toHaveBeenCalled();
    });
  });

  describe('does nothing without the flag', () => {
    it.each([undefined, 'false', 'TRUE', '1', 'yes'])('flag = %s', async (flag) => {
      await expect(
        resetStagingAdminPassword(prisma, { ...stagingEnv, RESET_STAGING_ADMIN_PASSWORD: flag }),
      ).resolves.toEqual({ status: 'skipped' });

      expect(userFindUnique).not.toHaveBeenCalled();
      expect(userUpdate).not.toHaveBeenCalled();
      expect(refreshTokenUpdateMany).not.toHaveBeenCalled();
    });
  });

  describe('on staging with the flag set', () => {
    it('looks up only the bootstrap administrator, by phone', async () => {
      await resetStagingAdminPassword(prisma, stagingEnv);

      expect(userFindUnique).toHaveBeenCalledTimes(1);
      expect(userFindUnique.mock.calls[0]![0].where).toEqual({ phone: BOOTSTRAP_ADMIN_PHONE });
      expect(userUpdate).toHaveBeenCalledTimes(1);
      expect(userUpdate.mock.calls[0]![0].where).toEqual({ id: 'bootstrap-admin-id' });
    });

    it('writes the new hash, forces rotation and clears the lockout — and nothing else', async () => {
      await resetStagingAdminPassword(prisma, stagingEnv);

      const data = userUpdate.mock.calls[0]![0].data;
      expect(data).toEqual({
        passwordHash: 'argon2-hash-of-the-new-password',
        mustChangePassword: true,
        failedLoginCount: 0,
        lockedUntil: null,
      });
      // The plaintext must never reach the database row either.
      expect(data.passwordHash).not.toBe(stagingEnv.SEED_ADMIN_PASSWORD);
    });

    it('revokes the administrator’s live refresh tokens', async () => {
      const result = await resetStagingAdminPassword(prisma, stagingEnv);

      expect(refreshTokenUpdateMany).toHaveBeenCalledTimes(1);
      const call = refreshTokenUpdateMany.mock.calls[0]![0];
      expect(call.where).toEqual({ userId: 'bootstrap-admin-id', revokedAt: null });
      expect(call.data.revokedAt).toBeInstanceOf(Date);
      expect(result).toEqual({
        status: 'reset',
        userId: 'bootstrap-admin-id',
        revokedRefreshTokens: 3,
      });
    });

    it('touches no table other than users and refresh_tokens', async () => {
      // The proxy throws on any other delegate, so reaching partner, wallet,
      // referralCode, purchaseIntent, payment, settlement, payout, bonusLot
      // or anything else would fail here.
      await expect(resetStagingAdminPassword(prisma, stagingEnv)).resolves.toMatchObject({
        status: 'reset',
      });
    });
  });
});
