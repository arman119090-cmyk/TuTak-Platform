import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { darkTheme, lightTheme, type Theme, type ThemeName } from '@cashout/design-tokens';
import { parseThemePreference, resolveThemeName, type ThemePreference } from './resolve';

export { resolveThemeName, type ThemePreference } from './resolve';

const STORAGE_KEY = 'cashout.theme';

interface ThemeValue {
  theme: Theme;
  preference: ThemePreference;
  setPreference: (next: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeValue>({
  theme: lightTheme,
  preference: 'light',
  setPreference: () => undefined,
});

/**
 * Light or dark, chosen by the driver and remembered across restarts.
 *
 * The choice lives above navigation and above the session: changing it swaps
 * the token set every screen reads and nothing else. No screen holds a colour
 * of its own, so there is nothing to reset.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const scheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('light');

  useEffect(() => {
    void AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => setPreferenceState(parseThemePreference(stored)))
      .catch(() => undefined);
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    void AsyncStorage.setItem(STORAGE_KEY, next).catch(() => undefined);
  }, []);

  const name: ThemeName = resolveThemeName(preference, scheme);

  const value = useMemo<ThemeValue>(
    () => ({ theme: name === 'dark' ? darkTheme : lightTheme, preference, setPreference }),
    [name, preference, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext).theme;
}

export function useThemePreference(): Pick<ThemeValue, 'preference' | 'setPreference'> {
  const { preference, setPreference } = useContext(ThemeContext);
  return { preference, setPreference };
}
