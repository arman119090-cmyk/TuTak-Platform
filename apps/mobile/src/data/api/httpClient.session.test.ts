import axios from 'axios';
import type { AxiosAdapter, AxiosRequestConfig } from 'axios';
import type { AuthTokensDto, AuthenticatedUserDto } from '@tutak/shared-types';
import { Role } from '@tutak/shared-types';
import { httpClient } from './httpClient';
import { useAuthStore } from '../stores/authStore';

jest.mock('../storage/secureStorage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  deleteItem: jest.fn(async () => undefined),
}));

jest.mock('axios', () => {
  const actual = jest.requireActual('axios');
  return { ...actual, default: { ...actual.default, post: jest.fn() }, post: jest.fn() };
});

const mockedPost = axios.post as jest.MockedFunction<typeof axios.post>;

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
 * The invariant these cover: once a session is closed, nothing that was
 * already in flight under it may write credentials again.
 *
 * A refresh started before a logout answers after it. The reply is a valid
 * token pair — the server issued it while the session was still open — so
 * nothing about the response itself says it is stale. Only the client knows
 * the session it belonged to is gone, and if it writes the pair anyway the
 * closed session is back: on this device, in SecureStore, past the logout the
 * customer performed. The account-switch case is worse than resurrection —
 * A's token lands in B's session and B's next request is made as A.
 */
describe('mobile httpClient — session lifetime across refresh', () => {
  const respondWith = (fn: (config: AxiosRequestConfig) => Promise<unknown>): jest.Mock => {
    const adapter = jest.fn(fn) as unknown as jest.Mock;
    httpClient.defaults.adapter = adapter as unknown as AxiosAdapter;
    return adapter;
  };

  const unauthorized = (config: AxiosRequestConfig) =>
    Promise.reject(
      Object.assign(new Error('Request failed with status code 401'), {
        isAxiosError: true,
        config,
        response: { status: 401, data: {}, statusText: 'Unauthorized', headers: {}, config },
      }),
    );

  const ok = (config: AxiosRequestConfig) =>
    Promise.resolve({ data: { data: 'fine' }, status: 200, statusText: 'OK', headers: {}, config });

  /** A refresh whose answer is held until the test decides it has landed. */
  const pendingRefresh = (who: string) => {
    let release: () => void = () => {};
    let fail: (err: unknown) => void = () => {};
    mockedPost.mockReturnValue(
      new Promise((resolve, reject) => {
        release = () =>
          resolve({ data: { data: { tokens: tokensFor(who) } } } as never);
        fail = reject;
      }) as never,
    );
    return { release: () => release(), fail: (err: unknown) => fail(err) };
  };

  /** Lets already-queued microtasks run without advancing to a new test phase. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(async () => {
    mockedPost.mockReset();
    await useAuthStore.getState().setSession(userA, tokensFor('a'));
  });

  it('1. refresh pending → logout → refresh succeeds: the session stays closed', async () => {
    const refresh = pendingRefresh('a');
    respondWith(unauthorized);

    const request = httpClient.get('/wallet/me').catch(() => 'rejected');
    await settle();

    await useAuthStore.getState().clear();
    refresh.release();
    await request;
    await settle();

    const state = useAuthStore.getState();
    expect(state.accessToken).toBeNull();
    expect(state.refreshToken).toBeNull();
    expect(state.user).toBeNull();
  });

  it('2. refresh pending → A logs out → B logs in → A’s refresh lands: B keeps their own session', async () => {
    const refresh = pendingRefresh('a');
    respondWith(unauthorized);

    const request = httpClient.get('/wallet/me').catch(() => 'rejected');
    await settle();

    await useAuthStore.getState().clear();
    await useAuthStore.getState().setSession(userB, tokensFor('b'));

    refresh.release();
    await request;
    await settle();

    const state = useAuthStore.getState();
    expect(state.user?.id).toBe('user-b');
    expect(state.accessToken).toBe('b-access');
    expect(state.refreshToken).toBe('b-refresh');
  });

  it('3. several requests 401 together, then the session changes: no reply revives the old one', async () => {
    const refresh = pendingRefresh('a');
    respondWith(unauthorized);

    const requests = Promise.all([
      httpClient.get('/wallet/me').catch(() => 'rejected'),
      httpClient.get('/transactions').catch(() => 'rejected'),
      httpClient.get('/referrals').catch(() => 'rejected'),
    ]);
    await settle();

    await useAuthStore.getState().clear();
    await useAuthStore.getState().setSession(userB, tokensFor('b'));

    refresh.release();
    await requests;
    await settle();

    expect(useAuthStore.getState().accessToken).toBe('b-access');
    expect(mockedPost).toHaveBeenCalledTimes(1);
  });

  it('4. logout during an active request: the in-flight call cannot re-authenticate it', async () => {
    const refresh = pendingRefresh('a');
    let seen = 0;
    const adapter = respondWith((config) => {
      seen += 1;
      return seen === 1 ? unauthorized(config) : ok(config);
    });

    const request = httpClient.get('/wallet/me').catch(() => 'rejected');
    await settle();
    await useAuthStore.getState().clear();
    refresh.release();

    await expect(request).resolves.toBe('rejected');
    // The replay must not happen: it would carry a token the logout revoked.
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('5. network failure during refresh after B signed in: B is not logged out by A’s failure', async () => {
    const refresh = pendingRefresh('a');
    respondWith(unauthorized);

    const request = httpClient.get('/wallet/me').catch(() => 'rejected');
    await settle();

    await useAuthStore.getState().clear();
    await useAuthStore.getState().setSession(userB, tokensFor('b'));

    refresh.fail(new Error('network error'));
    await request;
    await settle();

    // The failed refresh belonged to A. Clearing here would sign B out of a
    // session that never had anything wrong with it.
    expect(useAuthStore.getState().user?.id).toBe('user-b');
    expect(useAuthStore.getState().accessToken).toBe('b-access');
  });

  it('leaves the new session’s stored tokens intact when the old refresh is refused', async () => {
    const storage = jest.requireMock('../storage/secureStorage') as {
      setItem: jest.Mock;
      deleteItem: jest.Mock;
    };
    const refresh = pendingRefresh('a');
    respondWith(unauthorized);

    const request = httpClient.get('/wallet/me').catch(() => 'rejected');
    await settle();

    await useAuthStore.getState().clear();
    await useAuthStore.getState().setSession(userB, tokensFor('b'));
    storage.setItem.mockClear();
    storage.deleteItem.mockClear();

    refresh.release();
    await request;
    await settle();

    // Refusing A's tokens must not take B's out of SecureStore with them:
    // that would sign B out on the next cold start, long after the fact.
    expect(storage.deleteItem).not.toHaveBeenCalledWith('tutak.accessToken');
    expect(storage.deleteItem).not.toHaveBeenCalledWith('tutak.refreshToken');
    const written = storage.setItem.mock.calls.filter(([key]) => key === 'tutak.accessToken');
    for (const [, value] of written) {
      expect(value).toBe('b-access');
    }
  });

  it('refreshes normally when the session has not changed', async () => {
    mockedPost.mockResolvedValue({ data: { data: { tokens: tokensFor('a2') } } } as never);
    let seen = 0;
    const adapter = respondWith((config) => {
      seen += 1;
      return seen === 1 ? unauthorized(config) : ok(config);
    });

    const response = await httpClient.get('/wallet/me');

    expect(response.data).toEqual({ data: 'fine' });
    expect(adapter).toHaveBeenCalledTimes(2);
    const replay = adapter.mock.calls[1]![0] as AxiosRequestConfig;
    expect(replay.headers?.Authorization).toBe('Bearer a2-access');
    expect(useAuthStore.getState().accessToken).toBe('a2-access');
  });
});
