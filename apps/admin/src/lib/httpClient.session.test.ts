import axios from 'axios';
import type { AxiosAdapter, AxiosRequestConfig } from 'axios';
import type { AuthenticatedUserDto } from '@tutak/shared-types';
import { Role } from '@tutak/shared-types';
import { httpClient } from './httpClient';
import { useAuthStore } from './stores/authStore';

jest.mock('axios', () => {
  const actual = jest.requireActual('axios');
  return { ...actual, default: { ...actual.default, post: jest.fn() }, post: jest.fn() };
});

const mockedPost = axios.post as jest.MockedFunction<typeof axios.post>;

const userA: AuthenticatedUserDto = {
  id: 'admin-a',
  phone: '+37400000001',
  email: 'a@tutak.am',
  firstName: 'Anna',
  lastName: 'A',
  roles: [Role.ADMIN],
  partnerScopes: {},
  locale: 'hy',
  isPhoneVerified: true,
  avatar: null,
  showAvatarInReferralList: false,
  personalizedRecommendationsEnabled: false,
};

const userB: AuthenticatedUserDto = { ...userA, id: 'admin-b', firstName: 'Bagrat' };

const tokens = (who: string) => ({
  accessToken: `${who}-access`,
  refreshToken: `${who}-refresh`,
  accessTokenExpiresAt: '2026-01-01T00:00:00.000Z',
  refreshTokenExpiresAt: '2026-02-01T00:00:00.000Z',
});

/**
 * The dashboards keep no refresh token in JavaScript — the browser holds it as
 * an httpOnly cookie — but the race is the same one the mobile app has. A
 * refresh that started before a sign-out answers after it, with an access
 * token the API issued while the session was still valid. Writing it back puts
 * an operator's bearer token into a browser whose operator has left, and on a
 * shared workstation into the *next* operator's session.
 */
describe('admin httpClient — session lifetime across refresh', () => {
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

  const pendingRefresh = (who: string) => {
    let release: () => void = () => {};
    let fail: (err: unknown) => void = () => {};
    mockedPost.mockReturnValue(
      new Promise((resolve, reject) => {
        release = () => resolve({ data: { data: { tokens: tokens(who) } } } as never);
        fail = reject;
      }) as never,
    );
    return { release: () => release(), fail: (err: unknown) => fail(err) };
  };

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    window.localStorage.clear();
    mockedPost.mockReset();
    useAuthStore.getState().setSession(userA, tokens('a'));
  });

  it('1. refresh pending → sign-out → refresh succeeds: the session stays closed', async () => {
    const refresh = pendingRefresh('a');
    respondWith(unauthorized);

    const request = httpClient.get('/admin/users').catch(() => 'rejected');
    await settle();

    useAuthStore.getState().clear();
    refresh.release();
    await request;
    await settle();

    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('2. A signs out, B signs in, A’s refresh lands late: B’s session is untouched', async () => {
    const refresh = pendingRefresh('a');
    respondWith(unauthorized);

    const request = httpClient.get('/admin/users').catch(() => 'rejected');
    await settle();

    useAuthStore.getState().clear();
    useAuthStore.getState().setSession(userB, tokens('b'));

    refresh.release();
    await request;
    await settle();

    expect(useAuthStore.getState().user?.id).toBe('admin-b');
    expect(useAuthStore.getState().accessToken).toBe('b-access');
  });

  it('3. concurrent 401s across a session change do not overwrite the new session', async () => {
    const refresh = pendingRefresh('a');
    respondWith(unauthorized);

    const requests = Promise.all([
      httpClient.get('/admin/users').catch(() => 'rejected'),
      httpClient.get('/admin/partners').catch(() => 'rejected'),
    ]);
    await settle();

    useAuthStore.getState().clear();
    useAuthStore.getState().setSession(userB, tokens('b'));

    refresh.release();
    await requests;
    await settle();

    expect(useAuthStore.getState().accessToken).toBe('b-access');
  });

  it('4. sign-out during an active request: the request is not replayed with a revived token', async () => {
    const refresh = pendingRefresh('a');
    let seen = 0;
    const adapter = respondWith((config) => {
      seen += 1;
      return seen === 1 ? unauthorized(config) : ok(config);
    });

    const request = httpClient.get('/admin/users').catch(() => 'rejected');
    await settle();
    useAuthStore.getState().clear();
    refresh.release();

    await expect(request).resolves.toBe('rejected');
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('6. a 401 for a request A sent is not refreshed or replayed under B’s session', async () => {
    // The request left under A. Its answer arrives after A signed out and B
    // signed in, so both the refresh and the replay would be made as B.
    let release401: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release401 = resolve;
    });
    const adapter = respondWith(async (config) => {
      await held;
      return unauthorized(config);
    });

    const request = httpClient.get('/admin/users').catch((err: Error) => err.name);
    await settle();

    useAuthStore.getState().clear();
    useAuthStore.getState().setSession(userB, tokens('b'));

    release401();
    await expect(request).resolves.toBe('SessionChangedError');
    await settle();

    expect(mockedPost).not.toHaveBeenCalled();
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().accessToken).toBe('b-access');
  });

  it('5. a failed refresh belonging to the old session does not sign the new one out', async () => {
    const refresh = pendingRefresh('a');
    respondWith(unauthorized);

    const request = httpClient.get('/admin/users').catch(() => 'rejected');
    await settle();

    useAuthStore.getState().clear();
    useAuthStore.getState().setSession(userB, tokens('b'));

    refresh.fail(new Error('refresh cookie rejected'));
    await request;
    await settle();

    expect(useAuthStore.getState().user?.id).toBe('admin-b');
    expect(useAuthStore.getState().accessToken).toBe('b-access');
  });
});
