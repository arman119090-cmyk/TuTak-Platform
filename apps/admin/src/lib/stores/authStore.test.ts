import type { AuthTokensDto, AuthenticatedUserDto } from '@tutak/shared-types';
import { Role } from '@tutak/shared-types';
import { ADMIN_ROLES, useAuthStore } from './authStore';

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
};

const tokens: AuthTokensDto = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  accessTokenExpiresAt: '2026-01-01T00:00:00.000Z',
  refreshTokenExpiresAt: '2026-02-01T00:00:00.000Z',
};

describe('admin authStore', () => {
  beforeEach(() => {
    // Not clearing the whole store: the device id is generated once, as a
    // module-load side effect, before any test's beforeEach runs — wiping it
    // here would just delete something the test can no longer regenerate.
    window.localStorage.removeItem('tutak-admin-auth');
    useAuthStore.setState({ user: null, accessToken: null, hasHydrated: false });
  });

  it('persists its device id to localStorage and keeps it stable across reads', () => {
    const deviceId = useAuthStore.getState().deviceId;
    expect(deviceId).toMatch(/^admin-web-/);
    expect(window.localStorage.getItem('tutak-admin-device-id')).toBe(deviceId);
    // A second read must return the exact same id, not generate a new one.
    expect(useAuthStore.getState().deviceId).toBe(deviceId);
  });

  it('setSession stores the user and access token', () => {
    useAuthStore.getState().setSession(user, tokens);

    const state = useAuthStore.getState();
    expect(state.user).toEqual(user);
    expect(state.accessToken).toBe(tokens.accessToken);
  });

  /**
   * The property this whole module exists to guarantee (§H2 in the audit
   * history): the refresh token must never reach anything JavaScript-readable,
   * because that used to be exactly what let an XSS bug walk away with a
   * 30-day credential instead of a 15-minute one.
   */
  it('never persists the refresh token to localStorage', () => {
    useAuthStore.getState().setSession(user, tokens);

    const raw = window.localStorage.getItem('tutak-admin-auth');
    expect(raw).not.toBeNull();
    expect(raw).not.toContain(tokens.refreshToken);

    const persisted = JSON.parse(raw!) as { state: Record<string, unknown> };
    expect(Object.keys(persisted.state).sort()).toEqual(['accessToken', 'user']);
  });

  it('setTokens rotates the access token without touching the cached user', () => {
    useAuthStore.getState().setSession(user, tokens);
    useAuthStore.getState().setTokens({ accessToken: 'access-2' });

    const state = useAuthStore.getState();
    expect(state.accessToken).toBe('access-2');
    expect(state.user).toEqual(user);
  });

  it('clear wipes the session', () => {
    useAuthStore.getState().setSession(user, tokens);
    useAuthStore.getState().clear();

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.accessToken).toBeNull();
  });

  it('marks hydration exactly once', () => {
    expect(useAuthStore.getState().hasHydrated).toBe(false);
    useAuthStore.getState().markHydrated();
    expect(useAuthStore.getState().hasHydrated).toBe(true);
  });
});

describe('ADMIN_ROLES', () => {
  it('admits only ADMIN and SUPER_ADMIN', () => {
    expect(ADMIN_ROLES).toEqual(['ADMIN', 'SUPER_ADMIN']);
  });
});
