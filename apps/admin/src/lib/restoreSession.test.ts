import axios from 'axios';
import { restoreSession } from '@tutak/design/web';
import { Role, type AuthenticatedUserDto } from '@tutak/shared-types';
import { API_BASE_URL } from './httpClient';
import { useAuthStore } from './stores/authStore';

jest.mock('axios', () => {
  const actual = jest.requireActual('axios');
  return { ...actual, default: { ...actual.default, post: jest.fn() }, post: jest.fn() };
});

const mockedPost = axios.post as jest.MockedFunction<typeof axios.post>;

const user: AuthenticatedUserDto = {
  id: 'admin-1',
  phone: '+37400000000',
  email: null,
  firstName: 'Admin',
  lastName: 'User',
  roles: [Role.SUPER_ADMIN],
  partnerScopes: {},
  locale: 'hy',
  isPhoneVerified: true,
  avatar: null,
  showAvatarInReferralList: false,
  personalizedRecommendationsEnabled: false,
};

/**
 * Rebuilding a session on page load is what replaced keeping the access token
 * in `localStorage`, so it carries that guarantee now: a reload must restore
 * the operator's session from the httpOnly cookie alone, and must leave
 * nothing behind in storage while doing it.
 */
describe('restoreSession', () => {
  beforeEach(() => {
    mockedPost.mockReset();
    useAuthStore.setState({ user: null, accessToken: null, hasRestored: false });
  });

  const other: AuthenticatedUserDto = { ...user, id: 'admin-2', firstName: 'Other' };

  const tokens = (who: string) => ({
    accessToken: `${who}-access`,
    refreshToken: `${who}-refresh`,
    accessTokenExpiresAt: '2026-01-01T00:00:00.000Z',
    refreshTokenExpiresAt: '2026-02-01T00:00:00.000Z',
  });

  /**
   * The boot-time restore is a request like any other, and it can outlive the
   * session it was started for: a reload begins restoring the previous
   * operator's session, that operator's colleague signs in while it is in
   * flight, and the restore's answer then overwrites a session somebody is
   * already using — with the wrong person's identity attached to it.
   */
  it('does not overwrite a session that signed in while the restore was in flight', async () => {
    let release: () => void = () => {};
    mockedPost.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve({ data: { data: { user, tokens: tokens('restored') } } });
      }) as never,
    );

    const restoring = restoreSession(useAuthStore, API_BASE_URL);
    await new Promise((r) => setTimeout(r, 0));

    useAuthStore.getState().setSession(other, tokens('other'));
    release();

    await expect(restoring).resolves.toBe(false);
    expect(useAuthStore.getState().user?.id).toBe('admin-2');
    expect(useAuthStore.getState().accessToken).toBe('other-access');
  });

  it('does not write a tokens-only restore over a session that signed in meanwhile', async () => {
    let release: () => void = () => {};
    mockedPost.mockReturnValue(
      new Promise((resolve) => {
        // An older API: tokens, no user.
        release = () => resolve({ data: { data: { tokens: tokens('restored') } } });
      }) as never,
    );

    const restoring = restoreSession(useAuthStore, API_BASE_URL);
    await new Promise((r) => setTimeout(r, 0));

    useAuthStore.getState().setSession(other, tokens('other'));
    release();

    await expect(restoring).resolves.toBe(false);
    expect(useAuthStore.getState().accessToken).toBe('other-access');
  });

  it('does not restore a session the operator signed out of while it was in flight', async () => {
    let release: () => void = () => {};
    mockedPost.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve({ data: { data: { user, tokens: tokens('restored') } } });
      }) as never,
    );

    const restoring = restoreSession(useAuthStore, API_BASE_URL);
    await new Promise((r) => setTimeout(r, 0));

    useAuthStore.getState().clear();
    release();

    await expect(restoring).resolves.toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('rebuilds user and access token from the refresh cookie', async () => {
    mockedPost.mockResolvedValue({
      data: { data: { user, tokens: { accessToken: 'fresh', refreshToken: 'never-read' } } },
    } as never);

    await expect(restoreSession(useAuthStore, API_BASE_URL)).resolves.toBe(true);

    expect(useAuthStore.getState().accessToken).toBe('fresh');
    expect(useAuthStore.getState().user).toEqual(user);
  });

  it('sends only the device id, with credentials, to the refresh endpoint', async () => {
    mockedPost.mockResolvedValue({
      data: { data: { user, tokens: { accessToken: 'fresh', refreshToken: 'never-read' } } },
    } as never);

    await restoreSession(useAuthStore, API_BASE_URL);

    const [url, body, options] = mockedPost.mock.calls[0]!;
    expect(url).toBe(`${API_BASE_URL}/auth/refresh`);
    expect(Object.keys(body as object)).toEqual(['deviceId']);
    expect((options as { withCredentials?: boolean }).withCredentials).toBe(true);
  });

  it('reports no session, without throwing, when there is no valid cookie', async () => {
    mockedPost.mockRejectedValue(new Error('401'));

    await expect(restoreSession(useAuthStore, API_BASE_URL)).resolves.toBe(false);

    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('refuses a half-session from an API that answers without the user', async () => {
    mockedPost.mockResolvedValue({
      data: { data: { tokens: { accessToken: 'fresh', refreshToken: 'never-read' } } },
    } as never);

    // A token with no user is not enough to decide what may render, so the
    // gate must be told "no session" rather than shown a nameless one.
    await expect(restoreSession(useAuthStore, API_BASE_URL)).resolves.toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('writes nothing to browser storage', async () => {
    mockedPost.mockResolvedValue({
      data: { data: { user, tokens: { accessToken: 'fresh', refreshToken: 'never-read' } } },
    } as never);

    await restoreSession(useAuthStore, API_BASE_URL);

    for (const key of Object.keys(window.localStorage)) {
      expect(window.localStorage.getItem(key)).not.toContain('fresh');
      expect(window.localStorage.getItem(key)).not.toContain('never-read');
    }
    expect(window.sessionStorage.length).toBe(0);
  });
});
