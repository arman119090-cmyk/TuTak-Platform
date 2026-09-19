import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { darkTheme, lightTheme, type Theme } from '@cashout/design-tokens';

const ThemeContext = createContext<Theme>(lightTheme);

/**
 * The app ships light-first, as the brief asks: a driver uses this in daylight,
 * often through a windscreen, and the light palette is the one that has been
 * contrast-checked for that. The dark theme exists and is wired up here so that
 * enabling it later is a one-line change rather than a repaint of every screen —
 * `followSystem` is the switch.
 */
export function ThemeProvider({
  children,
  followSystem = false,
}: {
  children: React.ReactNode;
  followSystem?: boolean;
}) {
  const scheme = useColorScheme();
  const theme = useMemo(
    () => (followSystem && scheme === 'dark' ? darkTheme : lightTheme),
    [followSystem, scheme],
  );
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
