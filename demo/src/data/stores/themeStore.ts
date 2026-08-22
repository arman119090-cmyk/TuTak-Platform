import { create } from 'zustand';
import { getItem, setItem } from '../storage/secureStorage';

const THEME_MODE_KEY = 'tutak.themeMode';

/**
 * `'dark'` remains a valid *stored* value only so `hydrate` below can
 * recognise and migrate it — see `TUTAK_V2_CLAUDE_READ_FIRST.md` /
 * `TUTAK_V2_ANDROID_SYSTEM_UI_QA.md` §6: "the v2 customer release is
 * light-only... neither a fresh nor an existing customer [may] silently
 * land in the legacy dark shell... do not ship a partial second dark v2
 * theme." Nothing in the app is allowed to *set* `mode` to `'dark'` any
 * more (the Settings appearance toggle that used to offer it was removed in
 * the same change that added this migration) — `ThemeMode` keeps the wider
 * union purely so `isThemeMode`/the migration path stay honestly typed
 * against data written by an older build.
 */
export type ThemeMode = 'light' | 'dark';

function isThemeMode(value: string | null): value is ThemeMode {
  return value === 'light' || value === 'dark';
}

interface ThemeState {
  /** Always `'light'` after `hydrate` resolves — see the module docblock. */
  mode: ThemeMode;
  isHydrated: boolean;
  hydrate: () => Promise<void>;
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
  mode: 'light',
  isHydrated: false,

  hydrate: async () => {
    try {
      const stored = await getItem(THEME_MODE_KEY);
      // A pre-v2 install may have `'dark'` (the old default) or an explicit
      // `'light'` written by the old toggle — either way v2 renders light.
      // A `'dark'` value is actively rewritten back to storage so a later
      // read (or a future per-user analytics query of this key) does not
      // keep reporting a preference the app no longer honours.
      if (isThemeMode(stored) && stored === 'dark') {
        try {
          await setItem(THEME_MODE_KEY, 'light');
        } catch {
          // Non-fatal — this run still renders light regardless; see the
          // `setMode` failure note this replaced for why a write can fail.
        }
      }
      set({ mode: 'light', isHydrated: true });
    } catch {
      set({ mode: 'light', isHydrated: true });
    }
  },
}));
