import type { ThemeName } from '@cashout/design-tokens';

export type ThemePreference = 'light' | 'dark' | 'system';

/** The persisted value, or light when nothing valid was stored. Light is the product default. */
export function parseThemePreference(stored: unknown): ThemePreference {
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'light';
}

/** Pure: what the preference resolves to for a given system scheme. */
export function resolveThemeName(
  preference: ThemePreference,
  systemScheme: 'light' | 'dark' | null | undefined,
): ThemeName {
  if (preference === 'system') return systemScheme === 'dark' ? 'dark' : 'light';
  return preference;
}
