import { create } from 'zustand';
import { useAuthStore } from './authStore';
import {
  availableBiometrics, createBiometricProof, readBiometricOwner,
  removeBiometricProof, verifyBiometricProof, type BiometricKind,
} from '../biometrics/biometricDevice';

interface BiometricState {
  enabled: boolean;
  locked: boolean;
  busy: boolean;
  kind: BiometricKind | null;
  hydrate: () => Promise<void>;
  configure: (enabled: boolean, prompt: string) => Promise<boolean>;
  unlock: (prompt: string) => Promise<boolean>;
  lock: () => void;
}

// Serialize enrollment/removal with logout. A late write cannot recreate the
// previous account's setting after deletion. Rejections do not poison the queue.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.then(operation, operation);
  queue = result.catch(() => undefined);
  return result;
}
let generation = 0;
const currentSession = () => useAuthStore.getState();

export const useBiometricStore = create<BiometricState>((set, get) => ({
  enabled: false, locked: false, busy: false, kind: null,
  hydrate: async () => {
    const { user, sessionEpoch } = currentSession();
    let owner: string | null = null;
    let unreadable = false;
    try { owner = await readBiometricOwner(); } catch { unreadable = true; }
    const kind = await availableBiometrics().catch(() => null);
    // Backgrounding invalidates an in-flight scan, not the saved preference.
    // Dropping hydration for that reason would leave the default unlocked state
    // in place. Only a different auth session may discard this result.
    if (sessionEpoch !== currentSession().sessionEpoch || user?.id !== currentSession().user?.id) return;
    const enabled = Boolean(user && (unreadable || owner === user.id));
    set({ enabled, locked: enabled, kind });
  },
  configure: async (enabled, prompt) => {
    const { user, sessionEpoch } = currentSession();
    if (!user || get().busy || get().locked) return false;
    const stamp = generation;
    set({ busy: true });
    try {
      return await serial(async () => {
        const valid = () => stamp === generation && sessionEpoch === currentSession().sessionEpoch;
        if (!valid()) return false;
        if (enabled) {
          const kind = await availableBiometrics();
          if (!kind) return false;
          await createBiometricProof(user.id, prompt);
          if (!valid()) { await removeBiometricProof(); return false; }
          set({ enabled: true, kind });
        } else {
          if (!(await verifyBiometricProof(user.id, prompt)) || !valid()) return false;
          await removeBiometricProof();
          if (!valid()) return false;
          set({ enabled: false, locked: false });
        }
        return true;
      });
    } catch { return false; }
    finally { set({ busy: false }); }
  },
  unlock: async (prompt) => {
    const { user, sessionEpoch } = currentSession();
    if (!user || !get().enabled || !get().locked || get().busy) return false;
    const stamp = generation;
    set({ busy: true });
    try {
      const accepted = await verifyBiometricProof(user.id, prompt);
      if (!accepted || stamp !== generation || sessionEpoch !== currentSession().sessionEpoch) return false;
      set({ locked: false });
      return true;
    } catch { return false; }
    finally { set({ busy: false }); }
  },
  lock: () => {
    // Invalidate even a scan already running when the app backgrounds.
    generation += 1;
    if (get().enabled) set({ locked: true });
  },
}));

useAuthStore.subscribe((state, previous) => {
  if (state.sessionEpoch === previous.sessionEpoch) return;
  generation += 1;
  useBiometricStore.setState({ enabled: false, locked: false });
  // Exiting does not require a usable biometric. The auth navigator requires
  // a fresh SMS/password login before any account can be accessed again.
  void serial(removeBiometricProof).catch(() => undefined);
});
