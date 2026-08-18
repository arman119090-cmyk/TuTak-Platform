import React, { createContext, useContext, useEffect } from 'react';
import { tutakTheme, tutakMobileLightTheme, TutakTheme } from '@tutak/design';
import { useThemeStore } from '../../data/stores/themeStore';

/**
 * Two premium schemes, one behind a persisted user toggle: the dark scheme
 * this app shipped with first, and a light "glossy" scheme approved against
 * a reference design. `useThemeStore` holds which one is active, defaulting
 * to `'dark'` — so an install that never opens the new Appearance setting in
 * `SettingsScreen` renders exactly as before.
 *
 * Every screen still reads colour, spacing and radius through a single
 * `useTheme()` call. That is what makes the swap safe: nothing here branches
 * per screen, `TutakTheme` is one shape both objects satisfy (checked at
 * compile time in `@tutak/design`), and a screen that never hardcodes a
 * colour outside this context renders correctly under either theme with no
 * changes of its own.
 */
const ThemeContext = createContext<TutakTheme>(tutakTheme);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const mode = useThemeStore((s) => s.mode);
  const hydrate = useThemeStore((s) => s.hydrate);

  useEffect(() => {
    // Non-blocking: the store already defaults to 'dark', which is the
    // correct render for every screen mounted before this resolves — unlike
    // auth, there is no wrong screen to show while a theme preference is
    // still loading, so this never gates the splash the way `hydrate` on
    // `authStore` does.
    hydrate();
  }, [hydrate]);

  const theme = mode === 'light' ? tutakMobileLightTheme : tutakTheme;

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): TutakTheme {
  return useContext(ThemeContext);
}
