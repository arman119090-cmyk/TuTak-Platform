import { create } from 'zustand';
import type { AuthTokensDto, AuthenticatedUserDto } from '@tutak/shared-types';
import { deleteItem, getItem, setItem } from '../storage/secureStorage';

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

/**
 * Hydration runs before the first screen, so anything that throws in here
 * leaves the app on its splash forever with no way out — the user cannot even
 * log out, because logging out is behind a screen that never renders. A
 * half-written or hand-edited storage entry is enough to cause that, so a
 * value that will not parse is treated as no session rather than as a crash.
 */
function parseUser(raw: string | null): AuthenticatedUserDto | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthenticatedUserDto;
  } catch {
    return null;
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  deviceId: '',
  isHydrated: false,

  hydrate: async () => {
    const [accessToken, refreshToken, storedDeviceId, storedUser] = await Promise.all([
      getItem(ACCESS_TOKEN_KEY),
      getItem(REFRESH_TOKEN_KEY),
      getItem(DEVICE_ID_KEY),
      getItem(USER_KEY),
    ]);

    let deviceId = storedDeviceId;
    if (!deviceId) {
      deviceId = generateDeviceId();
      await setItem(DEVICE_ID_KEY, deviceId);
    }

    set({
      accessToken,
      refreshToken,
      deviceId,
      user: parseUser(storedUser),
      isHydrated: true,
    });
  },

  setSession: async (user, tokens) => {
    await Promise.all([
      setItem(ACCESS_TOKEN_KEY, tokens.accessToken),
      setItem(REFRESH_TOKEN_KEY, tokens.refreshToken),
      setItem(USER_KEY, JSON.stringify(user)),
    ]);
    set({ user, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
  },

  setTokens: async (tokens) => {
    await Promise.all([
      setItem(ACCESS_TOKEN_KEY, tokens.accessToken),
      setItem(REFRESH_TOKEN_KEY, tokens.refreshToken),
    ]);
    set({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
  },

  clear: async () => {
    await Promise.all([
      deleteItem(ACCESS_TOKEN_KEY),
      deleteItem(REFRESH_TOKEN_KEY),
      deleteItem(USER_KEY),
    ]);
    set({ user: null, accessToken: null, refreshToken: null });
  },
}));

export const getDeviceId = (): string => useAuthStore.getState().deviceId;
