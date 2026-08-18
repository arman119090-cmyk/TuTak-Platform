import { create } from 'zustand';
import { getItem, setItem } from '../storage/secureStorage';

const THEME_MODE_KEY = 'tutak.themeMode';

export type ThemeMode = 'light' | 'dark';

function isThemeMode(value: string | null): value is ThemeMode {
  return value === 'light' || value === 'dark';
}

interface ThemeState {
  /**
   * Defaults to `'dark'` so a fresh install, and every existing install
   * before this store ever wrote a value, renders exactly the premium dark
   * scheme the product already shipped — nobody's app changes look until
   * they open the new toggle themselves.
   */
  mode: ThemeMode;
  isHydrated: boolean;
  hydrate: () => Promise<void>;
  setMode: (mode: ThemeMode) => Promise<void>;
}

/**
 * Same shape as `authStore`'s hydration: read once at launch, degrade to the
 * default on any failure rather than block the app, and set `isHydrated`
 * unconditionally so nothing ever waits on this forever.
 *
 * Unlike the auth tokens, a stored theme preference is not sensitive, but it
 * reuses `secureStorage` anyway rather than adding a new storage dependency —
 * `apps/mobile/package.json` has no AsyncStorage today, and one more key in
 * the store the app already persists to is simpler than a second mechanism.
 */
export const useThemeStore = create<ThemeState>((set) => ({
  mode: 'dark',
  isHydrated: false,

  hydrate: async () => {
    try {
      const stored = await getItem(THEME_MODE_KEY);
      set({ mode: isThemeMode(stored) ? stored : 'dark', isHydrated: true });
    } catch {
      set({ isHydrated: true });
    }
  },

  setMode: async (mode) => {
    // Applied first so the toggle feels instant; the write happening after
    // is what makes it durable, not what makes it visible.
    set({ mode });
    try {
      await setItem(THEME_MODE_KEY, mode);
    } catch {
      // The choice still holds for the rest of this run — see
      // `secureStorage.ts` for why a write can fail on a real device. Losing
      // the persisted preference is a much smaller failure than the crash-on-
      // launch a rejected promise here used to cause elsewhere in the app.
    }
  },
}));
