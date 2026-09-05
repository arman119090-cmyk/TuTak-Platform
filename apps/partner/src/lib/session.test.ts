import axios from 'axios';
import type { AxiosAdapter, AxiosRequestConfig } from 'axios';
import { QueryClient } from '@tanstack/react-query';
import { registerSessionCacheReset } from '@tutak/design/web';
import type { AuthenticatedUserDto } from '@tutak/shared-types';
import { Role } from '@tutak/shared-types';
import { httpClient } from './httpClient';
import { useAuthStore } from './stores/authStore';

jest.mock('axios', () => {
  const actual = jest.requireActual('axios');
  return { ...actual, default: { ...actual.default, post: jest.fn() }, post: jest.fn() };
});

const mockedPost = axios.post as jest.MockedFunction<typeof axios.post>;

const staffA: AuthenticatedUserDto = {
  id: 'staff-a',
  phone: '+37400000001',
  email: 'a@partner.am',
  firstName: 'Anna',
  lastName: 'A',
  roles: [Role.PARTNER_STAFF],
  partnerScopes: { PARTNER_STAFF: ['partner-1'] },
  locale: 'hy',
  isPhoneVerified: true,
  avatar: null,
  showAvatarInReferralList: false,
  personalizedRecommendationsEnabled: false,
};

const staffB: AuthenticatedUserDto = { ...staffA, id: 'staff-b', firstName: 'Bagrat' };

const tokens = (who: string) => ({
  accessToken: `${who}-access`,
  refreshToken: `${who}-refresh`,
  accessTokenExpiresAt: '2026-01-01T00:00:00.000Z',
  refreshTokenExpiresAt: '2026-02-01T00:00:00.000Z',
});

/**
 * The partner dashboard is the sharpest case of both problems in this
 * repository: one browser at a counter, staff signing in and out across a
 * shift. A session that survives its own sign-out, or a cache that does,
 * shows one employee another's takings — and lets a request go out as them.
 */
describe('partner session boundary', () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    window.localStorage.clear();
    mockedPost.mockReset();
    useAuthStore.setState({ user: null, accessToken: null, hasRestored: true, sessionEpoch: 0 });
  });

  it('a refresh that outlives its session cannot revive it or overwrite the next one', async () => {
    useAuthStore.getState().setSession(staffA, tokens('a'));

    let release: () => void = () => {};
    mockedPost.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve({ data: { data: { tokens: tokens('a') } } } as never);
      }) as never,
    );

    const adapter = jest.fn((config: AxiosRequestConfig) =>
      Promise.reject(
        Object.assign(new Error('Request failed with status code 401'), {
          isAxiosError: true,
          config,
          response: { status: 401, data: {}, statusText: 'Unauthorized', headers: {}, config },
        }),
      ),
    );
    httpClient.defaults.adapter = adapter as unknown as AxiosAdapter;

    const request = httpClient.get('/partners/me/transactions').catch(() => 'rejected');
    await settle();

    useAuthStore.getState().clear();
    useAuthStore.getState().setSession(staffB, tokens('b'));
    release();
    await request;
    await settle();

    expect(useAuthStore.getState().user?.id).toBe('staff-b');
    expect(useAuthStore.getState().accessToken).toBe('b-access');
  });

  it('signing out empties the cached partner data', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const unregister = registerSessionCacheReset(() => client.clear());
    try {
      useAuthStore.getState().setSession(staffA, tokens('a'));
      client.setQueryData(['partner-transactions'], [{ id: 'txn-1', amount: 9_900 }]);
      client.setQueryData(['partner-settlements'], [{ id: 'settlement-1' }]);

      useAuthStore.getState().clear();

      expect(client.getQueryCache().getAll()).toEqual([]);
    } finally {
      unregister();
    }
  });

  it('the next employee to sign in sees none of the previous one’s data', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const unregister = registerSessionCacheReset(() => client.clear());
    try {
      useAuthStore.getState().setSession(staffA, tokens('a'));
      client.setQueryData(['partner-transactions'], [{ id: 'txn-1', amount: 9_900 }]);

      useAuthStore.getState().clear();
      useAuthStore.getState().setSession(staffB, tokens('b'));

      expect(client.getQueryData(['partner-transactions'])).toBeUndefined();
    } finally {
      unregister();
    }
  });
});
