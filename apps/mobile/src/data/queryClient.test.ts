import type { AuthTokensDto, AuthenticatedUserDto } from '@tutak/shared-types';
import { Role } from '@tutak/shared-types';
import { queryClient } from './queryClient';
import { useAuthStore } from './stores/authStore';

jest.mock('./storage/secureStorage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  deleteItem: jest.fn(async () => undefined),
}));

const userA: AuthenticatedUserDto = {
  id: 'user-a',
  phone: '+37400000001',
  email: null,
  firstName: 'Anna',
  lastName: 'A',
  roles: [Role.CUSTOMER],
  partnerScopes: {},
  locale: 'hy',
  isPhoneVerified: true,
  avatar: null,
  showAvatarInReferralList: false,
  personalizedRecommendationsEnabled: false,
};

const userB: AuthenticatedUserDto = { ...userA, id: 'user-b', firstName: 'Bagrat', lastName: 'B' };

const tokensFor = (who: string): AuthTokensDto => ({
  accessToken: `${who}-access`,
  refreshToken: `${who}-refresh`,
  accessTokenExpiresAt: '2026-01-01T00:00:00.000Z',
  refreshTokenExpiresAt: '2026-02-01T00:00:00.000Z',
});

/**
 * Every cached key here is user-specific and none of them says whose it is:
 * `['wallet']`, `['transactions']`, `['me']`, `['referrals']` are the same
 * strings for every customer who signs in on this device. The cache outlives
 * the session unless something empties it, and with `staleTime` a query does
 * not even refetch before rendering — so the next person to sign in on a
 * shared or handed-over phone opens the app to the previous person's balance
 * and purchase history, without either of them doing anything wrong.
 */
describe('mobile query cache is bound to the session', () => {
  const seedUserAsCache = () => {
    queryClient.setQueryData(['me'], { id: 'user-a', firstName: 'Anna' });
    queryClient.setQueryData(['wallet'], { availableBalance: 125_000 });
    queryClient.setQueryData(['transactions'], [{ id: 'txn-a-1', amount: 4200 }]);
    queryClient.setQueryData(['referrals'], [{ id: 'ref-a-1' }]);
    queryClient.setQueryData(['notifications'], [{ id: 'notif-a-1' }]);
  };

  const cachedKeys = () => queryClient.getQueryCache().getAll().map((query) => query.queryKey);

  beforeEach(async () => {
    queryClient.clear();
    await useAuthStore.getState().clear();
  });

  // Cached entries carry a garbage-collection timer each; left behind they
  // keep the worker alive past the run.
  afterAll(() => queryClient.clear());

  it('A signs in, loads data, signs out → nothing of A survives in the cache', async () => {
    await useAuthStore.getState().setSession(userA, tokensFor('a'));
    seedUserAsCache();
    expect(cachedKeys().length).toBeGreaterThan(0);

    await useAuthStore.getState().clear();

    expect(cachedKeys()).toEqual([]);
    expect(queryClient.getQueryData(['wallet'])).toBeUndefined();
    expect(queryClient.getQueryData(['transactions'])).toBeUndefined();
    expect(queryClient.getQueryData(['me'])).toBeUndefined();
  });

  it('A signs out, B signs in → B sees none of A’s data', async () => {
    await useAuthStore.getState().setSession(userA, tokensFor('a'));
    seedUserAsCache();

    await useAuthStore.getState().clear();
    await useAuthStore.getState().setSession(userB, tokensFor('b'));

    expect(cachedKeys()).toEqual([]);
    expect(queryClient.getQueryData(['me'])).toBeUndefined();
    expect(queryClient.getQueryData(['wallet'])).toBeUndefined();
  });

  it('a session replaced without an intervening logout still empties the cache', async () => {
    await useAuthStore.getState().setSession(userA, tokensFor('a'));
    seedUserAsCache();

    // Re-authenticating straight into another account — no `clear()` between.
    await useAuthStore.getState().setSession(userB, tokensFor('b'));

    expect(cachedKeys()).toEqual([]);
  });

  it('a token refresh within one session leaves the cache alone', async () => {
    await useAuthStore.getState().setSession(userA, tokensFor('a'));
    seedUserAsCache();

    await useAuthStore.getState().setTokens({
      accessToken: 'a-access-2',
      refreshToken: 'a-refresh-2',
    });

    // Same person, same session: dropping their data here would blank every
    // screen mid-use every fifteen minutes.
    expect(queryClient.getQueryData(['wallet'])).toEqual({ availableBalance: 125_000 });
  });
});
