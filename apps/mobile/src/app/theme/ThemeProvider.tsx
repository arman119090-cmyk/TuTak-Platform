import React, { createContext, useContext, useEffect, useMemo } from 'react';
import { useColorScheme, type ColorSchemeName } from 'react-native';
import { tutakMobileDarkTheme, tutakMobileLightTheme, TutakTheme } from '@tutak/design';
import { useThemeStore, type ThemeMode } from '../../data/stores/themeStore';

/**
 * Which theme every screen sees.
 *
 * Two premium schemes, one product: `tutakMobileLightTheme` (white ground,
 * approved and shipped in v2) and `tutakMobileDarkTheme` (the same brand on
 * ink — `packages/design/src/tokens/dark-premium.ts`). The person picks
 * light, dark or "same as device" in Settings → Appearance; `'system'`
 * follows `useColorScheme()`, so flipping the phone's own dark mode
 * re-themes the app on the next frame with no restart.
 *
 * This is the only place the choice is resolved. Screens read
 * `useTheme().mode` when they must know (the status bar, the map's scrim)
 * and otherwise just read colours — the two themes share one shape, which
 * is what lets 60-odd components work under either without a branch.
 *
 * `TutakTheme` stays the type every screen reads through `useTheme()`.
 */
const ThemeContext = createContext<TutakTheme>(tutakMobileLightTheme);

/** The concrete theme a stored preference resolves to under a device scheme. */
export function resolveTheme(mode: ThemeMode, deviceScheme: ColorSchemeName | null | undefined): TutakTheme {
  const wantsDark = mode === 'dark' || (mode === 'system' && deviceScheme === 'dark');
  return wantsDark ? tutakMobileDarkTheme : tutakMobileLightTheme;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const mode = useThemeStore((s) => s.mode);
  const hydrate = useThemeStore((s) => s.hydrate);
  const deviceScheme = useColorScheme();

  useEffect(() => {
    // Non-blocking: the first frame renders with the default ('system'),
    // and the persisted choice, if different, lands a moment later. The
    // app is behind its splash for that moment anyway.
    hydrate();
  }, [hydrate]);

  const theme = useMemo(() => resolveTheme(mode, deviceScheme), [mode, deviceScheme]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): TutakTheme {
  return useContext(ThemeContext);
}
