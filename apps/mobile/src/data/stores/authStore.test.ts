import * as SecureStore from 'expo-secure-store';
import type { AuthTokensDto, AuthenticatedUserDto } from '@tutak/shared-types';
import { Role } from '@tutak/shared-types';
import { getDeviceId, useAuthStore } from './authStore';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const mockedSecureStore = SecureStore as jest.Mocked<typeof SecureStore>;

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
      mockedSecureStore.getItemAsync.mockResolvedValue(null);

      await useAuthStore.getState().hydrate();

      const state = useAuthStore.getState();
      expect(state.isHydrated).toBe(true);
      expect(state.deviceId).toMatch(/^dev-/);
      expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith('tutak.deviceId', state.deviceId);
    });

    it('restores a previously stored session without generating a new device id', async () => {
      mockedSecureStore.getItemAsync.mockImplementation((key: string) => {
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
      expect(mockedSecureStore.setItemAsync).not.toHaveBeenCalled();
    });
  });

  describe('setSession', () => {
    it('persists both tokens and the user, and updates state', async () => {
      mockedSecureStore.setItemAsync.mockResolvedValue();

      await useAuthStore.getState().setSession(user, tokens);

      expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith(
        'tutak.accessToken',
        tokens.accessToken,
      );
      expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith(
        'tutak.refreshToken',
        tokens.refreshToken,
      );
      expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith(
        'tutak.user',
        JSON.stringify(user),
      );

      const state = useAuthStore.getState();
      expect(state.user).toEqual(user);
      expect(state.accessToken).toBe(tokens.accessToken);
      expect(state.refreshToken).toBe(tokens.refreshToken);
    });
  });

  describe('setTokens', () => {
    it('rotates only the tokens, leaving the cached user untouched', async () => {
      useAuthStore.setState({ user });
      mockedSecureStore.setItemAsync.mockResolvedValue();

      await useAuthStore.getState().setTokens({
        accessToken: 'access-2',
        refreshToken: 'refresh-2',
      });

      expect(mockedSecureStore.setItemAsync).toHaveBeenCalledTimes(2);
      expect(mockedSecureStore.setItemAsync).not.toHaveBeenCalledWith(
        'tutak.user',
        expect.anything(),
      );

      const state = useAuthStore.getState();
      expect(state.accessToken).toBe('access-2');
      expect(state.refreshToken).toBe('refresh-2');
      expect(state.user).toEqual(user);
    });
  });

  describe('clear', () => {
    it('deletes the session keys but preserves device identity', async () => {
      useAuthStore.setState({ user, accessToken: 'a', refreshToken: 'r', deviceId: 'dev-keep' });
      mockedSecureStore.deleteItemAsync.mockResolvedValue();

      await useAuthStore.getState().clear();

      expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith('tutak.accessToken');
      expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith('tutak.refreshToken');
      expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith('tutak.user');
      // Logging out must not orphan the device id — a fresh login on the
      // same device should keep being recognised as the same device.
      expect(mockedSecureStore.deleteItemAsync).not.toHaveBeenCalledWith('tutak.deviceId');

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
