import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { AppTheme, darkTheme, lightTheme } from './colors';
import { radius, spacing, typography } from './tokens';

interface ThemeContextValue {
  theme: AppTheme;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: isDark ? darkTheme : lightTheme,
      spacing,
      radius,
      typography,
      isDark,
    }),
    [isDark],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useAppTheme must be used within ThemeProvider');
  return ctx;
}
