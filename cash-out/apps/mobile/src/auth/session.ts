import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { TokenStore } from '../api/client';

const ACCESS_KEY = 'cashout.accessToken';
const REFRESH_KEY = 'cashout.refreshToken';
const DEVICE_KEY = 'cashout.deviceId';

/**
 * Token storage.
 *
 * Tokens go in the platform keystore (`expo-secure-store` — Keychain on iOS,
 * EncryptedSharedPreferences on Android), never in AsyncStorage: AsyncStorage
 * is a plain file, readable by anything with access to the app's sandbox, and a
 * refresh token there is a standing invitation on a rooted phone.
 *
 * The device id is a different matter: it is not a secret, it must survive a
 * keystore wipe, and it identifies the installation for session binding, so it
 * lives in AsyncStorage.
 */
export const tokenStore: TokenStore = {
  async getAccessToken() {
    return SecureStore.getItemAsync(ACCESS_KEY);
  },

  async getRefreshToken() {
    return SecureStore.getItemAsync(REFRESH_KEY);
  },

  async save({ accessToken, refreshToken }) {
    await SecureStore.setItemAsync(ACCESS_KEY, accessToken, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    await SecureStore.setItemAsync(REFRESH_KEY, refreshToken, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  },

  async clear() {
    await SecureStore.deleteItemAsync(ACCESS_KEY);
    await SecureStore.deleteItemAsync(REFRESH_KEY);
  },

  async getDeviceId() {
    const existing = await AsyncStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const created = `dev-${randomId(24)}`;
    await AsyncStorage.setItem(DEVICE_KEY, created);
    return created;
  },
};

function randomId(length: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(length);
  // `crypto.getRandomValues` is provided by Expo's runtime.
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

/**
 * The idempotency key for one *intent* to withdraw — generated when the driver
 * reaches the review screen, reused for every retry of that confirmation. Tying
 * it to the intent rather than to the HTTP attempt is the whole point: a
 * timeout followed by a tap on "try again" must be recognised by the server as
 * the same withdrawal.
 */
export function newIdempotencyKey(): string {
  return `wd-${Date.now().toString(36)}-${randomId(24)}`;
}
