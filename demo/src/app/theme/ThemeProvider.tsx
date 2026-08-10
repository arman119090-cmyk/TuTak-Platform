import React, { createContext, useContext } from 'react';
import { tutakTheme, TutakTheme } from '@tutak/design';

/**
 * TuTak is a light-surface product by design: the balance is the brightest
 * thing on screen and colour is reserved for bonus state, which only reads
 * correctly on white. There is therefore a single theme rather than a
 * light/dark pair — the tokens come straight from @tutak/design, so the
 * app, the partner dashboard and the admin panel are literally rendering
 * the same values.
 */
const ThemeContext = createContext<TutakTheme>(tutakTheme);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return <ThemeContext.Provider value={tutakTheme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): TutakTheme {
  return useContext(ThemeContext);
}
