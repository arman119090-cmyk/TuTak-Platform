import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import type { AuthTokensDto, AuthenticatedUserDto } from '@tutak/shared-types';

const ACCESS_TOKEN_KEY = 'tutak.accessToken';
const REFRESH_TOKEN_KEY = 'tutak.refreshToken';
const DEVICE_ID_KEY = 'tutak.deviceId';
const USER_KEY = 'tutak.user';

interface AuthState {
  user: AuthenticatedUserDto | null;
  accessToken: string | null;
  refreshToken: string | null;
  deviceId: string;
  isHydrated: boolean;
  hydrate: () => Promise<void>;
  setSession: (user: AuthenticatedUserDto, tokens: AuthTokensDto) => Promise<void>;
  setTokens: (tokens: Pick<AuthTokensDto, 'accessToken' | 'refreshToken'>) => Promise<void>;
  clear: () => Promise<void>;
}

function generateDeviceId(): string {
  return `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  deviceId: '',
  isHydrated: false,

  hydrate: async () => {
    const [accessToken, refreshToken, storedDeviceId, storedUser] = await Promise.all([
      SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
      SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
      SecureStore.getItemAsync(DEVICE_ID_KEY),
      SecureStore.getItemAsync(USER_KEY),
    ]);

    let deviceId = storedDeviceId;
    if (!deviceId) {
      deviceId = generateDeviceId();
      await SecureStore.setItemAsync(DEVICE_ID_KEY, deviceId);
    }

    set({
      accessToken,
      refreshToken,
      deviceId,
      user: storedUser ? (JSON.parse(storedUser) as AuthenticatedUserDto) : null,
      isHydrated: true,
    });
  },

  setSession: async (user, tokens) => {
    await Promise.all([
      SecureStore.setItemAsync(ACCESS_TOKEN_KEY, tokens.accessToken),
      SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refreshToken),
      SecureStore.setItemAsync(USER_KEY, JSON.stringify(user)),
    ]);
    set({ user, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
  },

  setTokens: async (tokens) => {
    await Promise.all([
      SecureStore.setItemAsync(ACCESS_TOKEN_KEY, tokens.accessToken),
      SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refreshToken),
    ]);
    set({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
  },

  clear: async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
      SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
      SecureStore.deleteItemAsync(USER_KEY),
    ]);
    set({ user: null, accessToken: null, refreshToken: null });
  },
}));

export const getDeviceId = (): string => useAuthStore.getState().deviceId;
