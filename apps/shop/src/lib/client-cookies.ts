/** Tiny browser-cookie helpers used by the locale switcher. */

const YEAR_SECONDS = 60 * 60 * 24 * 365;

export const writeCookie = (name: string, value: string, maxAge = YEAR_SECONDS): void => {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=${encodeURIComponent(value)};path=/;max-age=${maxAge};samesite=lax`;
};

export const LOCALE_COOKIE = 'ornata_locale';
