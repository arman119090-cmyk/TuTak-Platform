import { create } from 'zustand';
import { useAuthStore } from './authStore';
import { deleteItem, getItem, setItem } from '../storage/secureStorage';
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
export type PinUnlockResult = 'ok' | 'wrong' | 'signed-out' | 'not-locked';

export const MAX_ATTEMPTS = 5;

const PIN_KEY = 'tutak.appLock.pin.v1';
const OWNER_KEY = 'tutak.appLock.owner.v1';
const ATTEMPTS_KEY = 'tutak.appLock.attempts.v1';

interface AppLockState {
  status: LockStatus;
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
/** The parsed record for the current session, so an unlock does not hit the keystore twice. */
let record: PinRecord | null = null;

const session = () => useAuthStore.getState();

async function readAttempts(): Promise<number> {
  const raw = await getItem(ATTEMPTS_KEY);
  const n = raw ? Number.parseInt(raw, 10) : 0;
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

async function wipeLocal(): Promise<void> {
  await Promise.all([deleteItem(PIN_KEY), deleteItem(OWNER_KEY), deleteItem(ATTEMPTS_KEY)]);
  await removeBiometricProof();
}

export const useAppLockStore = create<AppLockState>((set, get) => ({
  status: 'idle',
  busy: false,
  biometricKind: null,
  biometricsEnabled: false,
  attemptsLeft: MAX_ATTEMPTS,

  hydrate: async () => {
    const { user, sessionEpoch } = session();
    if (!user) {
      record = null;
      set({ status: 'idle', biometricsEnabled: false, attemptsLeft: MAX_ATTEMPTS });
      return;
    }
    const [owner, rawPin, attempts, kind, bioOwner] = await Promise.all([
      getItem(OWNER_KEY),
      getItem(PIN_KEY),
      readAttempts(),
      availableBiometrics().catch(() => null),
      readBiometricOwner().catch(() => null),
    ]);
    // Only a different session may discard this result; backgrounding during
    // hydration must not leave the default state in place.
    if (sessionEpoch !== session().sessionEpoch || user.id !== session().user?.id) return;
    const parsed = owner === user.id ? parsePinRecord(rawPin) : null;
    record = parsed;
    if (!parsed) {
      // No code for this account on this phone (first sign-in here, a wiped
      // keystore, or a code that belonged to somebody else): choose one now.
      set({ status: 'setup', biometricKind: kind, biometricsEnabled: false, attemptsLeft: MAX_ATTEMPTS });
      return;
    }
    set({
      status: 'locked',
      biometricKind: kind,
      biometricsEnabled: bioOwner === user.id,
      attemptsLeft: Math.max(0, MAX_ATTEMPTS - attempts),
    });
  },

  createPin: async (pin) => {
    const { user, sessionEpoch } = session();
    if (!user || get().busy) return false;
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
        set({ status: 'unlocked', attemptsLeft: MAX_ATTEMPTS });
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
    if (!user || get().status !== 'locked' || !get().biometricsEnabled || get().busy) return false;
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

  lock: () => {
    // Invalidates a scan or a code check already in flight.
    generation += 1;
    if (get().status === 'unlocked') set({ status: 'locked' });
  },
}));

async function checkPin(pin: string, unlock: boolean): Promise<PinUnlockResult> {
  const store = useAppLockStore;
  const { user, sessionEpoch } = session();
  const { status, busy } = store.getState();
  if (!user || busy || !record) return 'not-locked';
  if (unlock && status !== 'locked') return 'not-locked';
  const stamp = generation;
  store.setState({ busy: true });
  try {
    const ok = await pinMatches(pin, record);
    if (stamp !== generation || sessionEpoch !== session().sessionEpoch) return 'not-locked';
    if (ok) {
      await serial(() => setItem(ATTEMPTS_KEY, '0')).catch(() => undefined);
      store.setState({ attemptsLeft: MAX_ATTEMPTS, ...(unlock ? { status: 'unlocked' } : {}) });
      return 'ok';
    }
    const used = MAX_ATTEMPTS - store.getState().attemptsLeft + 1;
    const left = Math.max(0, MAX_ATTEMPTS - used);
    await serial(() => setItem(ATTEMPTS_KEY, String(used))).catch(() => undefined);
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
    useAppLockStore.setState({ status: 'idle', biometricsEnabled: false, attemptsLeft: MAX_ATTEMPTS });
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
