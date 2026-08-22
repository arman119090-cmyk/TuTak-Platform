import React, { createContext, useContext, useEffect } from 'react';
import { tutakMobileLightTheme, TutakTheme } from '@tutak/design';
import { useThemeStore } from '../../data/stores/themeStore';

/**
 * The v2 customer release is light-only — `TUTAK_V2_CLAUDE_READ_FIRST.md`:
 * "The legacy app defaults to dark today, while v2 is explicitly a
 * light-only delivery. Migrate the default/persisted theme behaviour so
 * neither a fresh nor an existing customer silently lands in the legacy
 * dark shell; do not build an unapproved partial dark v2 variant." This
 * provider therefore always renders `tutakMobileLightTheme` — the premium
 * light "glossy" scheme already approved and shipped behind the old
 * Appearance toggle (`SettingsScreen`, now removed) — never the dark
 * `tutakTheme` a customer could previously opt into.
 *
 * `useThemeStore` still exists (see its own docblock) purely to migrate a
 * pre-v2 install's persisted `'dark'` value so nothing re-reads it as a
 * live preference; this provider does not branch on `mode` any more, since
 * there is only one theme to branch to.
 *
 * `TutakTheme` stays the type every screen reads through `useTheme()` —
 * unchanged so no screen needs to change how it consumes colour, spacing or
 * radius, even though only one concrete value now flows through it.
 */
const ThemeContext = createContext<TutakTheme>(tutakMobileLightTheme);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const hydrate = useThemeStore((s) => s.hydrate);

  useEffect(() => {
    // Non-blocking, and now purely a one-time storage migration (see
    // `themeStore.ts`) — the render is 'light' immediately regardless of
    // whether this has resolved yet, so there is no loading state to gate.
    hydrate();
  }, [hydrate]);

  return <ThemeContext.Provider value={tutakMobileLightTheme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): TutakTheme {
  return useContext(ThemeContext);
}
