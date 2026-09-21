import { create } from 'zustand';
import { useAuthStore } from './authStore';
import { deleteItem, readItem, setItem, type SecureRead } from '../storage/secureStorage';
import {
  availableBiometrics,
  createBiometricProof,
  readBiometricOwner,
  removeBiometricProof,
  verifyBiometricProof,
  type BiometricKind,
} from '../biometrics/biometricDevice';
import {
  createPinRecord,
  parsePinRecord,
  pinMatches,
  serializePinRecord,
  type PinRecord,
} from '../appLock/pinCode';

/**
 * The app lock: every signed-in session on this phone is behind a four-digit
 * code, and optionally behind Face ID / a fingerprint on top of it.
 *
 * Mandatory, not opt-in (owner decision, 20.09.2026): a wallet with a
 * balance is not something a phone left on a table should open. So the
 * states are
 *
 *   idle      no session — nothing to protect;
 *   setup     signed in, no code yet — the person must choose one before
 *             the private screens mount;
 *   locked    signed in, code exists — a cold start or a return from the
 *             background lands here until the code or a biometric proves
 *             the person;
 *   unlocked  the private screens are showing.
 *
 * What it is not: server-side authentication. Tokens stay in the ordinary
 * keystore; the lock decides whether *this app* shows them, the same way a
 * banking app does. Guessing is bounded by `MAX_ATTEMPTS`: the fifth wrong
 * code signs the session out, wipes the code, and the only way back is a
 * fresh SMS login. That, not the hash, is what makes four digits enough.
 *
 * Session hygiene follows `biometricStore` from the earlier biometric-only
 * branch: every async result is checked against the auth `sessionEpoch` and a
 * lock `generation` before it is applied, so a scan that answers after a
 * logout or a background transition cannot open anything, and a code written
 * for one account can never unlock another.
 */
export type LockStatus = 'idle' | 'setup' | 'locked' | 'unlocked';
export type PinUnlockResult = 'ok' | 'wrong' | 'signed-out' | 'not-locked' | 'unavailable';
/**
 * Whether the keystore answered for this account's lock (audit 21.09.2026,
 * D07/D08). `unavailable`: a read threw — the code, its owner or the
 * attempt counter could not be read. `invalid`: the account has a code
 * here and it does not parse, or the counter is garbage. Both are `locked`
 * with no keypad: the only way forward is a fresh SMS sign-in, never a new
 * code on top of the live session.
 */
export type LockStorageState = 'ok' | 'unavailable' | 'invalid';

export const MAX_ATTEMPTS = 5;

const PIN_KEY = 'tutak.appLock.pin.v1';
const OWNER_KEY = 'tutak.appLock.owner.v1';
const ATTEMPTS_KEY = 'tutak.appLock.attempts.v1';

interface AppLockState {
  status: LockStatus;
  storage: LockStorageState;
  busy: boolean;
  /** What the device offers, or null when nothing strong is enrolled. */
  biometricKind: BiometricKind | null;
  /** Whether this account chose to unlock with it. */
  biometricsEnabled: boolean;
  attemptsLeft: number;
  hydrate: () => Promise<void>;
  /** Sets (or replaces) the code for the signed-in account and unlocks. */
  createPin: (pin: string) => Promise<boolean>;
  unlockWithPin: (pin: string) => Promise<PinUnlockResult>;
  /** Checks the code without changing the lock — for "change code" in Settings. Counts attempts like an unlock. */
  verifyPin: (pin: string) => Promise<PinUnlockResult>;
  unlockWithBiometrics: (prompt: string) => Promise<boolean>;
  enableBiometrics: (prompt: string) => Promise<boolean>;
  disableBiometrics: () => Promise<void>;
  /**
   * Feed every `AppState` change here. Locks on return to the foreground
   * when the app was away for `LOCK_AFTER_BACKGROUND_MS` or more; a short
   * absence (a system dialog, a quick app switch) does not lock.
   */
  onAppStateChange: (state: string, now?: number) => void;
  lock: () => void;
}

// One queue for every write, shared in spirit with authStore's: a logout's
// deletes and a setup's writes must land in the order they were asked for.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(operation: () => Promise<T>): Promise<T> {
  const run = queue.then(operation, operation);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

let generation = 0;

/**
 * How long the app has to be away before coming back asks for the code.
 *
 * Not zero, and not because of taste: on Android the activity is *paused*
 * — and React Native reports `background` — every time something opens on
 * top of it that is not the app: the camera-permission dialog, the share
 * sheet, the biometric prompt on some handsets. Locking on the event
 * itself meant the code was demanded in the middle of paying, right after
 * granting the camera, and again after the fingerprint dialog closed —
 * "it asks for the code everywhere" (owner, 20.09.2026, on a Samsung).
 *
 * So the lock is armed on `background` and fired on `active` only if the
 * gap was long enough to mean the person actually left. Five minutes: a
 * dialog or a quick switch to another app is seconds; a phone left on a
 * table is minutes. A cold start is always locked regardless (see
 * `hydrate`), which is what "the code when you open the app" means.
 */
export const LOCK_AFTER_BACKGROUND_MS = 5 * 60_000;

/** When the app last went to the background, or null while it is in front. */
let backgroundedAt: number | null = null;
/** The parsed record for the current session, so an unlock does not hit the keystore twice. */
let record: PinRecord | null = null;

const session = () => useAuthStore.getState();

/** The persisted attempt count: absent means none used; anything unparsable is refused, not zeroed. */
function parseAttempts(read: SecureRead): number | 'invalid' {
  if (read.kind !== 'value') return 0;
  const n = Number.parseInt(read.value, 10);
  return Number.isFinite(n) && n >= 0 && String(n) === read.value.trim() ? n : 'invalid';
}

async function wipeLocal(): Promise<void> {
  await Promise.all([deleteItem(PIN_KEY), deleteItem(OWNER_KEY), deleteItem(ATTEMPTS_KEY)]);
  await removeBiometricProof();
}

export const useAppLockStore = create<AppLockState>((set, get) => ({
  status: 'idle',
  storage: 'ok',
  busy: false,
  biometricKind: null,
  biometricsEnabled: false,
  attemptsLeft: MAX_ATTEMPTS,

  hydrate: async () => {
    const { user, sessionEpoch } = session();
    if (!user) {
      record = null;
      set({ status: 'idle', storage: 'ok', biometricsEnabled: false, attemptsLeft: MAX_ATTEMPTS });
      return;
    }
    const [owner, rawPin, attemptsRead, kind, bioOwner] = await Promise.all([
      readItem(OWNER_KEY),
      readItem(PIN_KEY),
      readItem(ATTEMPTS_KEY),
      availableBiometrics().catch(() => null),
      readBiometricOwner().catch(() => null),
    ]);
    // Only a different session may discard this result; backgrounding during
    // hydration must not leave the default state in place.
    if (sessionEpoch !== session().sessionEpoch || user.id !== session().user?.id) return;

    // Fail closed (audit D07): a keystore that could not be read is not a
    // keystore with nothing in it. The old code turned the throw into null,
    // read null as "no code yet" and offered `setup` — a new code, and an
    // unlock, on top of a live session with no proof of the old one.
    const unavailable = [owner, rawPin, attemptsRead].some((read) => read.kind === 'unavailable');
    if (unavailable) {
      record = null;
      set({ status: 'locked', storage: 'unavailable', biometricKind: kind, biometricsEnabled: false, attemptsLeft: 0 });
      return;
    }

    const ownerId = owner.kind === 'value' ? owner.value : null;
    if (ownerId !== user.id) {
      // No code for this account on this phone (first sign-in here, or a
      // code that belonged to somebody else): choose one now.
      record = null;
      set({ status: 'setup', storage: 'ok', biometricKind: kind, biometricsEnabled: false, attemptsLeft: MAX_ATTEMPTS });
      return;
    }

    // This account has a code here. It must read and parse; a missing or
    // corrupt record under a matching owner is damage, not a first visit.
    const parsed = rawPin.kind === 'value' ? parsePinRecord(rawPin.value) : null;
    const attempts = parseAttempts(attemptsRead);
    if (!parsed || attempts === 'invalid') {
      record = null;
      set({ status: 'locked', storage: 'invalid', biometricKind: kind, biometricsEnabled: false, attemptsLeft: 0 });
      return;
    }
    record = parsed;
    set({
      status: 'locked',
      storage: 'ok',
      biometricKind: kind,
      biometricsEnabled: bioOwner === user.id,
      attemptsLeft: Math.max(0, MAX_ATTEMPTS - attempts),
    });
  },

  createPin: async (pin) => {
    const { user, sessionEpoch } = session();
    if (!user || get().busy) return false;
    // A code is chosen at setup, or replaced from inside an unlocked session
    // after the old one was verified (`ChangePinScreen`). Never while locked
    // — that would be a bypass, whatever the keystore did (audit D07).
    if (get().status !== 'setup' && get().status !== 'unlocked') return false;
    const stamp = generation;
    set({ busy: true });
    try {
      const next = await createPinRecord(pin);
      return await serial(async () => {
        if (stamp !== generation || sessionEpoch !== session().sessionEpoch) return false;
        await setItem(PIN_KEY, serializePinRecord(next));
        await setItem(OWNER_KEY, user.id);
        await setItem(ATTEMPTS_KEY, '0');
        if (stamp !== generation || sessionEpoch !== session().sessionEpoch) return false;
        record = next;
        set({ status: 'unlocked', storage: 'ok', attemptsLeft: MAX_ATTEMPTS });
        return true;
      });
    } catch {
      return false;
    } finally {
      set({ busy: false });
    }
  },

  unlockWithPin: (pin) => checkPin(pin, true),
  verifyPin: (pin) => checkPin(pin, false),

  unlockWithBiometrics: async (prompt) => {
    const { user, sessionEpoch } = session();
    if (!user || get().status !== 'locked' || get().storage !== 'ok' || !get().biometricsEnabled || get().busy) return false;
    const stamp = generation;
    set({ busy: true });
    try {
      const accepted = await verifyBiometricProof(user.id, prompt);
      if (!accepted || stamp !== generation || sessionEpoch !== session().sessionEpoch) return false;
      set({ status: 'unlocked' });
      return true;
    } catch {
      return false;
    } finally {
      set({ busy: false });
    }
  },

  enableBiometrics: async (prompt) => {
    const { user, sessionEpoch } = session();
    if (!user || get().busy || get().status === 'locked') return false;
    const stamp = generation;
    set({ busy: true });
    try {
      return await serial(async () => {
        const kind = await availableBiometrics();
        if (!kind) return false;
        await createBiometricProof(user.id, prompt);
        if (stamp !== generation || sessionEpoch !== session().sessionEpoch) {
          await removeBiometricProof();
          return false;
        }
        set({ biometricsEnabled: true, biometricKind: kind });
        return true;
      });
    } catch {
      return false;
    } finally {
      set({ busy: false });
    }
  },

  disableBiometrics: async () => {
    await serial(removeBiometricProof).catch(() => undefined);
    set({ biometricsEnabled: false });
  },

  onAppStateChange: (state, now = Date.now()) => {
    if (state === 'background') {
      if (backgroundedAt === null) backgroundedAt = now;
      return;
    }
    if (state !== 'active') return;
    const since = backgroundedAt;
    backgroundedAt = null;
    if (since !== null && now - since >= LOCK_AFTER_BACKGROUND_MS) get().lock();
  },

  lock: () => {
    // Invalidates a scan or a code check already in flight.
    generation += 1;
    if (get().status === 'unlocked') set({ status: 'locked' });
  },
}));

async function checkPin(pin: string, unlock: boolean): Promise<PinUnlockResult> {
  const store = useAppLockStore;
  const { user, sessionEpoch } = session();
  const { status, storage, busy, attemptsLeft } = store.getState();
  if (!user || busy) return 'not-locked';
  if (storage !== 'ok' || !record) return storage === 'ok' ? 'not-locked' : 'unavailable';
  if (unlock && status !== 'locked') return 'not-locked';
  const stamp = generation;
  store.setState({ busy: true });
  try {
    /*
     * The attempt is written down *before* it is judged (audit D08). The
     * old order — judge, then persist — meant a keystore that refused the
     * write left the count in memory only: four wrong codes, a restart,
     * and five fresh tries. Now a code is not even compared until the
     * count that includes it is on disk; if that write fails the attempt
     * is refused outright, and a restart reads a count that is never lower
     * than the truth.
     */
    const used = MAX_ATTEMPTS - attemptsLeft + 1;
    try {
      await serial(() => setItem(ATTEMPTS_KEY, String(used)));
    } catch {
      return 'unavailable';
    }
    const ok = await pinMatches(pin, record);
    if (stamp !== generation || sessionEpoch !== session().sessionEpoch) return 'not-locked';
    if (ok) {
      // Best effort: a reset that fails leaves the stricter count on disk
      // and in memory, which errs the right way.
      const reset = await serial(() => setItem(ATTEMPTS_KEY, '0')).then(
        () => true,
        () => false,
      );
      store.setState({
        attemptsLeft: reset ? MAX_ATTEMPTS : Math.max(0, MAX_ATTEMPTS - used),
        ...(unlock ? { status: 'unlocked' } : {}),
      });
      return 'ok';
    }
    const left = Math.max(0, MAX_ATTEMPTS - used);
    store.setState({ attemptsLeft: left });
    if (left > 0) return 'wrong';
    // Out of attempts: the session ends here. The auth subscription below
    // wipes the code and the biometric proof; the person signs in by SMS
    // again and chooses a new code.
    await session().clear();
    return 'signed-out';
  } catch {
    return 'not-locked';
  } finally {
    store.setState({ busy: false });
  }
}

useAuthStore.subscribe((state, previous) => {
  if (state.sessionEpoch !== previous.sessionEpoch) {
    // A sign-in or a sign-out. Either way the code that was here belongs to
    // a session that is over.
    generation += 1;
    record = null;
    useAppLockStore.setState({ status: 'idle', storage: 'ok', biometricsEnabled: false, attemptsLeft: MAX_ATTEMPTS });
    void serial(wipeLocal).catch(() => undefined);
  }
  // A session appeared (a fresh sign-in, or the stored one at cold start).
  // Hydration runs behind the wipe in the same queue, so a sign-in lands on
  // `setup`; a cold start lands on `locked`. `App` also awaits hydrate
  // before it leaves the splash, and renders the splash while the status is
  // still `idle` with a user present — the private screens never show
  // before the answer is known.
  if (state.user && state.user.id !== previous.user?.id) {
    void serial(() => useAppLockStore.getState().hydrate()).catch(() => undefined);
  }
});
