import type { AuthTokensDto, AuthenticatedUserDto } from '@tutak/shared-types';
import { Role } from '@tutak/shared-types';
import * as storage from '../storage/secureStorage';
import { getDeviceId, useAuthStore } from './authStore';

// The store talks to the storage adapter, not to `expo-secure-store`
// directly — that indirection is what lets the same store run in a browser,
// where the native module does not exist. Mocking the adapter therefore
// tests the store on every platform at once.
jest.mock('../storage/secureStorage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  deleteItem: jest.fn(),
}));

const mockedStorage = storage as jest.Mocked<typeof storage>;

const user: AuthenticatedUserDto = {
  id: 'user-1',
  phone: '+37400000001',
  email: null,
  firstName: 'Test',
  lastName: 'User',
  roles: [Role.CUSTOMER],
  partnerScopes: {},
  locale: 'hy',
  isPhoneVerified: true,
};

const tokens: AuthTokensDto = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  accessTokenExpiresAt: '2026-01-01T00:00:00.000Z',
  refreshTokenExpiresAt: '2026-02-01T00:00:00.000Z',
};

describe('authStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedStorage.setItem.mockResolvedValue();
    mockedStorage.deleteItem.mockResolvedValue();
    useAuthStore.setState({
      user: null,
      accessToken: null,
      refreshToken: null,
      deviceId: '',
      isHydrated: false,
    });
  });

  describe('hydrate', () => {
    it('generates and persists a device id when none is stored', async () => {
      mockedStorage.getItem.mockResolvedValue(null);

      await useAuthStore.getState().hydrate();

      const state = useAuthStore.getState();
      expect(state.isHydrated).toBe(true);
      expect(state.deviceId).toMatch(/^dev-/);
      expect(mockedStorage.setItem).toHaveBeenCalledWith('tutak.deviceId', state.deviceId);
    });

    it('restores a previously stored session without generating a new device id', async () => {
      mockedStorage.getItem.mockImplementation((key: string) => {
        const stored: Record<string, string> = {
          'tutak.accessToken': tokens.accessToken,
          'tutak.refreshToken': tokens.refreshToken,
          'tutak.deviceId': 'dev-existing',
          'tutak.user': JSON.stringify(user),
        };
        return Promise.resolve(stored[key] ?? null);
      });

      await useAuthStore.getState().hydrate();

      const state = useAuthStore.getState();
      expect(state.accessToken).toBe(tokens.accessToken);
      expect(state.refreshToken).toBe(tokens.refreshToken);
      expect(state.deviceId).toBe('dev-existing');
      expect(state.user).toEqual(user);
      // A device id was already on record, so nothing should be (re)written.
      expect(mockedStorage.setItem).not.toHaveBeenCalled();
    });

    it('treats an unreadable stored user as no session instead of throwing', async () => {
      // Hydration runs before the first screen. If this threw, the app would
      // sit on its splash forever with no way for anyone to log out of it.
      mockedStorage.getItem.mockImplementation((key: string) =>
        Promise.resolve(key === 'tutak.user' ? '{not json' : null),
      );

      await expect(useAuthStore.getState().hydrate()).resolves.toBeUndefined();

      const state = useAuthStore.getState();
      expect(state.isHydrated).toBe(true);
      expect(state.user).toBeNull();
    });
  });

  describe('setSession', () => {
    it('persists both tokens and the user, and updates state', async () => {
      await useAuthStore.getState().setSession(user, tokens);

      expect(mockedStorage.setItem).toHaveBeenCalledWith('tutak.accessToken', tokens.accessToken);
      expect(mockedStorage.setItem).toHaveBeenCalledWith('tutak.refreshToken', tokens.refreshToken);
      expect(mockedStorage.setItem).toHaveBeenCalledWith('tutak.user', JSON.stringify(user));

      const state = useAuthStore.getState();
      expect(state.user).toEqual(user);
      expect(state.accessToken).toBe(tokens.accessToken);
      expect(state.refreshToken).toBe(tokens.refreshToken);
    });
  });

  describe('setTokens', () => {
    it('rotates only the tokens, leaving the cached user untouched', async () => {
      useAuthStore.setState({ user });

      await useAuthStore.getState().setTokens({
        accessToken: 'access-2',
        refreshToken: 'refresh-2',
      });

      expect(mockedStorage.setItem).toHaveBeenCalledTimes(2);
      expect(mockedStorage.setItem).not.toHaveBeenCalledWith('tutak.user', expect.anything());

      const state = useAuthStore.getState();
      expect(state.accessToken).toBe('access-2');
      expect(state.refreshToken).toBe('refresh-2');
      expect(state.user).toEqual(user);
    });
  });

  describe('clear', () => {
    it('deletes the session keys but preserves device identity', async () => {
      useAuthStore.setState({ user, accessToken: 'a', refreshToken: 'r', deviceId: 'dev-keep' });

      await useAuthStore.getState().clear();

      expect(mockedStorage.deleteItem).toHaveBeenCalledWith('tutak.accessToken');
      expect(mockedStorage.deleteItem).toHaveBeenCalledWith('tutak.refreshToken');
      expect(mockedStorage.deleteItem).toHaveBeenCalledWith('tutak.user');
      // Logging out must not orphan the device id — a fresh login on the
      // same device should keep being recognised as the same device.
      expect(mockedStorage.deleteItem).not.toHaveBeenCalledWith('tutak.deviceId');

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.accessToken).toBeNull();
      expect(state.refreshToken).toBeNull();
      expect(state.deviceId).toBe('dev-keep');
    });
  });

  describe('getDeviceId', () => {
    it('reads the current device id out of the store', () => {
      useAuthStore.setState({ deviceId: 'dev-abc' });
      expect(getDeviceId()).toBe('dev-abc');
    });
  });
});
