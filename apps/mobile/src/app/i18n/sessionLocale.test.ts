import type { AuthTokensDto, AuthenticatedUserDto } from '@tutak/shared-types';
import { Role } from '@tutak/shared-types';
import i18n from './i18n';
import './sessionLocale';
import { useAuthStore } from '../../data/stores/authStore';

jest.mock('../../data/storage/secureStorage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  deleteItem: jest.fn(async () => undefined),
}));

const baseUser: AuthenticatedUserDto = {
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

const tokens: AuthTokensDto = {
  accessToken: 'access',
  refreshToken: 'refresh',
  accessTokenExpiresAt: '2026-01-01T00:00:00.000Z',
  refreshTokenExpiresAt: '2026-02-01T00:00:00.000Z',
};

/**
 * Language belongs to the person, not the handset. Someone whose profile says
 * `ru` was opening the app in `hy` because that is what the previous person on
 * that phone had picked — the account's own `locale` was never applied.
 */
describe('interface language follows the session', () => {
  beforeEach(async () => {
    await useAuthStore.getState().clear();
    await i18n.changeLanguage('hy');
  });

  it('switches to the signed-in account’s language', async () => {
    await useAuthStore.getState().setSession({ ...baseUser, locale: 'ru' }, tokens);

    expect(i18n.language).toBe('ru');
  });

  it('switches again when the next person signs in on the same phone', async () => {
    await useAuthStore.getState().setSession({ ...baseUser, locale: 'ru' }, tokens);
    await useAuthStore.getState().clear();
    await useAuthStore.getState().setSession(
      { ...baseUser, id: 'user-b', locale: 'en' },
      tokens,
    );

    expect(i18n.language).toBe('en');
  });

  it('leaves a language chosen mid-session alone', async () => {
    await useAuthStore.getState().setSession({ ...baseUser, locale: 'ru' }, tokens);
    await i18n.changeLanguage('en');

    // A refresh is not a session change; re-applying the profile value here
    // would flip the interface out from under the person using it.
    await useAuthStore.getState().setTokens({ accessToken: 'a2', refreshToken: 'r2' });

    expect(i18n.language).toBe('en');
  });

  it('ignores a locale the app does not ship', async () => {
    await useAuthStore.getState().setSession({ ...baseUser, locale: 'fr' }, tokens);

    // Falling back to whatever was showing beats rendering keys.
    expect(i18n.language).toBe('hy');
  });

  it('keeps the device language when signing out', async () => {
    await useAuthStore.getState().setSession({ ...baseUser, locale: 'ru' }, tokens);
    await useAuthStore.getState().clear();

    // Nothing to switch to: the sign-out screen is nobody's account. The
    // last language stays rather than snapping back mid-animation.
    expect(i18n.language).toBe('ru');
  });
});
