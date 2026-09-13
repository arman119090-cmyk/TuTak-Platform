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
   * Applies a profile change to the signed-in user, in place.
   *
   * Needed because the profile can change while signed in — the avatar, the
   * referral-list consent flag and the interface language all live on
   * `AuthenticatedUserDto` and are edited from the Profile and Settings
   * screens. Persisted as well as set: the stored copy is what hydration
   * reads on the next cold start, and a customer who uploads a photo and
   * reopens the app to their old one would reasonably conclude the upload had
   * not worked.
   *
   * Takes a patch rather than a whole user, and an `expectedEpoch`, because
   * every caller here is a network reply: it left under one session and
   * arrives under whichever session exists now. Answers `false` when that is
   * no longer the session it was sent for.
   */
  patchUser: (patch: Partial<AuthenticatedUserDto>, expectedEpoch?: number) => boolean;
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
 * Serialises every write to the session keys.
 *
 * `expo-secure-store` is asynchronous and crosses into native code, so two
 * session operations started close together can have their writes interleave
 * in any order. Interleaving is what turns a guard into a hole: a sign-in's
 * writes landing *after* a sign-out's deletes leave a signed-out session
 * sitting in the keystore, and the next cold start reads it back.
 *
 * With one queue, storage operations happen in the order they were asked for,
 * and each one re-checks the session it belongs to at the moment it runs —
 * so a superseded write refuses instead of racing.
 */
let storageQueue: Promise<unknown> = Promise.resolve();

function enqueueStorageWrite<T>(operation: () => Promise<T>): Promise<T> {
  // Chained off the settled queue, not the raw one: a failed write must not
  // stop every later session operation on this device.
  const run = storageQueue.then(operation, operation);
  storageQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
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

  setSession: async (user, tokens) =>
    enqueueStorageWrite(async () => {
      // Claimed here, inside the queue, rather than at call time: two sign-ins
      // racing would otherwise compute the same next epoch and the second
      // would look superseded by the first.
      const epoch = get().sessionEpoch + 1;
      set({ sessionEpoch: epoch });
      await Promise.all([
        setItem(ACCESS_TOKEN_KEY, tokens.accessToken),
        setItem(REFRESH_TOKEN_KEY, tokens.refreshToken),
        setItem(USER_KEY, JSON.stringify(user)),
      ]);
      // A sign-out asked for during the write is a later instruction than this
      // sign-in, and it wins: the deletes it queued run next, and putting this
      // session into memory now would leave the app signed in as somebody the
      // person just signed out of.
      if (get().sessionEpoch !== epoch) return;
      set({ user, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
    }),

  patchUser: (patch, expectedEpoch) => {
    // Applied to whatever the session holds *now*, never to a copy the caller
    // captured before its request. A profile edit sends one field and the
    // reply carries one field; merging it into a captured object would write
    // that whole object back — and if the session changed meanwhile, that
    // object is the previous person's name, phone and avatar landing in a
    // store whose tokens belong to someone else.
    const { user, sessionEpoch } = get();
    if (expectedEpoch !== undefined && expectedEpoch !== sessionEpoch) return false;
    if (!user) return false;
    const next = { ...user, ...patch };
    set({ user: next });
    // Fire-and-forget, deliberately. The in-memory update is what the screen
    // is waiting on; a keystore that refuses the write should cost the
    // customer a stale avatar after a cold start, not a failed save. Queued
    // so it cannot interleave with a sign-in or sign-out writing the same key.
    void enqueueStorageWrite(async () => {
      if (get().sessionEpoch !== sessionEpoch) return;
      await setItem(USER_KEY, JSON.stringify(next));
    });
    return true;
  },

  setTokens: async (tokens, expectedEpoch) =>
    enqueueStorageWrite(async () => {
      // Checked here, when the write actually runs, rather than when it was
      // requested. Between the two, a sign-out or another sign-in may have
      // taken the store — and a write that checked only on the way in would
      // put a closed session's tokens into the keystore behind them.
      //
      // This replaced a compensating write that repaired storage from memory
      // afterwards. That repair had the same defect one level down: the memory
      // it read could itself be signed out before the repair finished, so it
      // could restore tokens the person had just deleted. Refusing before
      // writing anything removes the class rather than patching an instance.
      if (expectedEpoch !== undefined && expectedEpoch !== get().sessionEpoch) {
        return false;
      }
      await Promise.all([
        setItem(ACCESS_TOKEN_KEY, tokens.accessToken),
        setItem(REFRESH_TOKEN_KEY, tokens.refreshToken),
      ]);
      if (expectedEpoch !== undefined && expectedEpoch !== get().sessionEpoch) {
        // Nothing to undo — the queue guarantees no other write ran in
        // between, so the only writer of these keys was this call, and the
        // sign-out that superseded it has its own deletes queued behind us.
        return false;
      }
      set({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
      return true;
    }),

  clear: async () => {
    // The epoch moves first and outside the queue, so anything in flight is
    // invalidated the instant the logout is asked for rather than once storage
    // has caught up with it. The deletes then run in order behind whatever
    // writes were already queued, so they cannot be undone by a write that
    // started earlier.
    set({ user: null, accessToken: null, refreshToken: null, sessionEpoch: get().sessionEpoch + 1 });
    await enqueueStorageWrite(() =>
      Promise.all([
        deleteItem(ACCESS_TOKEN_KEY),
        deleteItem(REFRESH_TOKEN_KEY),
        deleteItem(USER_KEY),
      ]),
    );
  },
}));

export const getDeviceId = (): string => useAuthStore.getState().deviceId;
