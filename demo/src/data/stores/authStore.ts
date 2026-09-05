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
  /**
   * Which session the state below belongs to. Bumped by `setSession` and
   * `clear`, i.e. by every sign-in, sign-out and account switch.
   *
   * Anything that leaves this process and comes back holding credentials has
   * to say which session it started under, because the answer may arrive
   * after that session ended — a refresh in flight during a logout is the
   * ordinary case, not a rare one. Without this, the reply is indistinguishable
   * from a legitimate one and writes a closed session's tokens back into a
   * store that may already belong to somebody else.
   */
  sessionEpoch: number;
  hydrate: () => Promise<void>;
  setSession: (user: AuthenticatedUserDto, tokens: AuthTokensDto) => Promise<void>;
  /**
   * Replaces the stored user without touching the session.
   *
   * Needed because the profile can now change while signed in — the avatar
   * and the referral-list consent flag both live on `AuthenticatedUserDto`,
   * and both are edited from the Profile screen. Persisted as well as set:
   * the stored copy is what hydration reads on the next cold start, and a
   * customer who uploads a photo and reopens the app to their old one would
   * reasonably conclude the upload had not worked.
   */
  setUser: (user: AuthenticatedUserDto) => void;
  /**
   * Writes a refreshed token pair into the session it belongs to.
   *
   * `expectedEpoch` is how a caller that started before an `await` proves the
   * session it refreshed is still the current one. When it does not match, the
   * write is refused and `false` is returned — the tokens are real, but they
   * authenticate a session this device has already closed. Omitting the
   * argument keeps the old unconditional behaviour for callers that hold no
   * such expectation.
   */
  setTokens: (
    tokens: Pick<AuthTokensDto, 'accessToken' | 'refreshToken'>,
    expectedEpoch?: number,
  ) => Promise<boolean>;
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

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  deviceId: '',
  isHydrated: false,
  sessionEpoch: 0,

  /**
   * Hydration cannot be allowed to reject.
   *
   * `parseUser` above covers one way this used to strand the app on its
   * splash. Storage itself is the other: reads are guarded in the adapter
   * now, but the device-id write below is a write, and a device whose
   * keystore refuses one would otherwise take the whole app down with it —
   * over an identifier that only needs to be stable, not durable.
   *
   * So the write is allowed to fail and the generated id is kept for this
   * run. `isHydrated` is set on every path, because whatever went wrong,
   * the answer is the login screen and not a logo forever.
   */
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
      try {
        await setItem(DEVICE_ID_KEY, deviceId);
      } catch {
        // Kept in memory for this run; a new one is generated next launch.
      }
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
    set({
      user,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      sessionEpoch: get().sessionEpoch + 1,
    });
  },

  setUser: (user) => {
    set({ user });
    // Fire-and-forget, deliberately. The in-memory update is what the screen
    // is waiting on; a keystore that refuses the write should cost the
    // customer a stale avatar after a cold start, not a failed save.
    void setItem(USER_KEY, JSON.stringify(user));
  },

  setTokens: async (tokens, expectedEpoch) => {
    // Checked before the write and again after it, because the write itself
    // awaits: a logout landing between the two would otherwise delete the
    // stored tokens and then have them put straight back.
    if (expectedEpoch !== undefined && expectedEpoch !== get().sessionEpoch) {
      return false;
    }
    await Promise.all([
      setItem(ACCESS_TOKEN_KEY, tokens.accessToken),
      setItem(REFRESH_TOKEN_KEY, tokens.refreshToken),
    ]);
    if (expectedEpoch !== undefined && expectedEpoch !== get().sessionEpoch) {
      // Repair rather than delete. The session that replaced ours may have
      // written its own tokens while we were awaiting, and deleting the keys
      // would sign *that* person out on their next cold start. Memory is
      // authoritative here — it is what the current session set — so storage
      // is put back into agreement with it.
      const { accessToken, refreshToken } = get();
      await Promise.all([
        accessToken ? setItem(ACCESS_TOKEN_KEY, accessToken) : deleteItem(ACCESS_TOKEN_KEY),
        refreshToken ? setItem(REFRESH_TOKEN_KEY, refreshToken) : deleteItem(REFRESH_TOKEN_KEY),
      ]);
      return false;
    }
    set({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
    return true;
  },

  clear: async () => {
    // The epoch moves first, before the awaited deletes: anything in flight is
    // invalidated the instant the logout is asked for, not once storage has
    // caught up with it.
    set({ user: null, accessToken: null, refreshToken: null, sessionEpoch: get().sessionEpoch + 1 });
    await Promise.all([
      deleteItem(ACCESS_TOKEN_KEY),
      deleteItem(REFRESH_TOKEN_KEY),
      deleteItem(USER_KEY),
    ]);
  },
}));

export const getDeviceId = (): string => useAuthStore.getState().deviceId;
