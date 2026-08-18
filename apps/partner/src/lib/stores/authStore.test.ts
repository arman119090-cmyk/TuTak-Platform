import type { AuthTokensDto, AuthenticatedUserDto } from '@tutak/shared-types';
import { Role } from '@tutak/shared-types';
import { PARTNER_ROLES, getPrimaryPartnerId, isPartnerOwner, useAuthStore } from './authStore';

const tokens: AuthTokensDto = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  accessTokenExpiresAt: '2026-01-01T00:00:00.000Z',
  refreshTokenExpiresAt: '2026-02-01T00:00:00.000Z',
};

function buildUser(overrides: Partial<AuthenticatedUserDto> = {}): AuthenticatedUserDto {
  return {
    id: 'partner-user-1',
    phone: '+37400000002',
    email: null,
    firstName: 'Owner',
    lastName: 'User',
    roles: [Role.PARTNER_OWNER],
    partnerScopes: {},
    locale: 'hy',
    isPhoneVerified: true,
    ...overrides,
  };
}

describe('partner authStore', () => {
  beforeEach(() => {
    // Not clearing the whole store: the device id is generated once, as a
    // module-load side effect, before any test's beforeEach runs — wiping it
    // here would just delete something the test can no longer regenerate.
    window.localStorage.removeItem('tutak-partner-auth');
    useAuthStore.setState({ user: null, accessToken: null, hasHydrated: false });
  });

  it('persists a device id namespaced separately from the admin app', () => {
    const deviceId = useAuthStore.getState().deviceId;
    expect(deviceId).toMatch(/^partner-web-/);
    expect(window.localStorage.getItem('tutak-partner-device-id')).toBe(deviceId);
    // Regression guard for the copy-paste risk: this must never collide with
    // the admin dashboard's key, or one app's device id could shadow the other's.
    expect(window.localStorage.getItem('tutak-admin-device-id')).toBeNull();
  });

  it('never persists the refresh token to localStorage', () => {
    const user = buildUser();
    useAuthStore.getState().setSession(user, tokens);

    const raw = window.localStorage.getItem('tutak-partner-auth');
    expect(raw).not.toBeNull();
    expect(raw).not.toContain(tokens.refreshToken);

    const persisted = JSON.parse(raw!) as { state: Record<string, unknown> };
    expect(Object.keys(persisted.state).sort()).toEqual(['accessToken', 'user']);
  });

  it('clear wipes the session', () => {
    useAuthStore.getState().setSession(buildUser(), tokens);
    useAuthStore.getState().clear();

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.accessToken).toBeNull();
  });
});

describe('PARTNER_ROLES', () => {
  it('admits only PARTNER_OWNER and PARTNER_STAFF', () => {
    expect(PARTNER_ROLES).toEqual(['PARTNER_OWNER', 'PARTNER_STAFF']);
  });
});

describe('getPrimaryPartnerId', () => {
  it('returns null when there is no user', () => {
    expect(getPrimaryPartnerId(null)).toBeNull();
  });

  it('returns null when the user has no partner scope at all', () => {
    expect(getPrimaryPartnerId(buildUser({ partnerScopes: {} }))).toBeNull();
  });

  it('resolves the partner id from the owner scope', () => {
    const user = buildUser({ partnerScopes: { PARTNER_OWNER: ['partner-1'] } });
    expect(getPrimaryPartnerId(user)).toBe('partner-1');
  });

  it('falls back to the staff scope when there is no owner scope', () => {
    const user = buildUser({
      roles: [Role.PARTNER_STAFF],
      partnerScopes: { PARTNER_STAFF: ['partner-2'] },
    });
    expect(getPrimaryPartnerId(user)).toBe('partner-2');
  });

  it('prefers the owner scope when a user somehow carries both', () => {
    const user = buildUser({
      partnerScopes: { PARTNER_OWNER: ['partner-owner'], PARTNER_STAFF: ['partner-staff'] },
    });
    expect(getPrimaryPartnerId(user)).toBe('partner-owner');
  });
});

describe('isPartnerOwner', () => {
  it('returns false when there is no user', () => {
    expect(isPartnerOwner(null, 'partner-1')).toBe(false);
  });

  it('returns false when there is no partner id', () => {
    const user = buildUser({ partnerScopes: { PARTNER_OWNER: ['partner-1'] } });
    expect(isPartnerOwner(user, null)).toBe(false);
  });

  it('returns true when the user owns this specific partner', () => {
    const user = buildUser({ partnerScopes: { PARTNER_OWNER: ['partner-1'] } });
    expect(isPartnerOwner(user, 'partner-1')).toBe(true);
  });

  it('returns false for a staff member scoped to the same partner', () => {
    const user = buildUser({
      roles: [Role.PARTNER_STAFF],
      partnerScopes: { PARTNER_STAFF: ['partner-1'] },
    });
    expect(isPartnerOwner(user, 'partner-1')).toBe(false);
  });

  it('returns false when the user owns a different partner', () => {
    const user = buildUser({ partnerScopes: { PARTNER_OWNER: ['partner-other'] } });
    expect(isPartnerOwner(user, 'partner-1')).toBe(false);
  });
});
