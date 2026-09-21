import { create } from 'zustand';
import { getItem, setItem } from '../storage/secureStorage';

const THEME_MODE_KEY = 'tutak.themeMode';

/**
 * What the person asked for in Settings → Appearance. `'system'` follows
 * the phone's own light/dark setting; the other two pin it. Which concrete
 * theme that resolves to is decided in `ThemeProvider`, which is the one
 * place that also reads the phone's scheme.
 *
 * History: the v2 release shipped light-only and this store existed purely
 * to migrate an older install's persisted `'dark'` back to `'light'`
 * (`TUTAK_V2_CLAUDE_READ_FIRST.md`). On 20.09.2026 the owner asked for a
 * user-switchable dark theme, which supersedes that brief; the dark theme
 * a stored `'dark'` now selects is the new green-on-ink
 * `tutakMobileDarkTheme`, not the legacy shell the migration was guarding
 * against, so an old `'dark'` value is simply honoured.
 */
export type ThemeMode = 'system' | 'light' | 'dark';

export const DEFAULT_THEME_MODE: ThemeMode = 'system';

function isThemeMode(value: string | null): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

interface ThemeState {
  mode: ThemeMode;
  isHydrated: boolean;
  hydrate: () => Promise<void>;
  /** Applies at once and persists; a failed write keeps the choice for this run. */
  setMode: (mode: ThemeMode) => Promise<void>;
}

/**
 * Same shape as `authStore`'s hydration: read once at launch, degrade to the
 * default on any failure rather than block the app, and set `isHydrated`
 * unconditionally so nothing ever waits on this forever.
 *
 * A theme preference is not sensitive, but it reuses `secureStorage` rather
 * than adding a second storage dependency — `apps/mobile/package.json` has
 * no AsyncStorage, and one more key in the store the app already persists
 * to is simpler than a second mechanism.
 */
export const useThemeStore = create<ThemeState>((set) => ({
  mode: DEFAULT_THEME_MODE,
  isHydrated: false,

  hydrate: async () => {
    try {
      const stored = await getItem(THEME_MODE_KEY);
      set({ mode: isThemeMode(stored) ? stored : DEFAULT_THEME_MODE, isHydrated: true });
    } catch {
      set({ mode: DEFAULT_THEME_MODE, isHydrated: true });
    }
  },

  setMode: async (mode) => {
    // The screen re-themes on this frame; the write is for next launch.
    set({ mode });
    try {
      await setItem(THEME_MODE_KEY, mode);
    } catch {
      // Non-fatal: the choice holds until the app is closed. Storage on a
      // phone fails for reasons (full disk, a keystore hiccup) that are not
      // worth an error dialog over a theme switch.
    }
  },
}));
