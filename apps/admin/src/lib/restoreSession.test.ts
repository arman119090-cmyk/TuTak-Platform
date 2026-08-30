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
