import { DEFAULT_LOCALE, isLocale, type Locale } from '@cashout/i18n';

/**
 * Which language to show, in order of authority: what the driver chose before
 * (persisted on the phone), then the phone's own languages, then Armenian.
 * Armenian rather than English as the last resort — this ships in Armenia.
 */
export function pickLocale(stored: unknown, deviceLanguageCodes: ReadonlyArray<string>): Locale {
  if (isLocale(stored)) return stored;
  for (const code of deviceLanguageCodes) {
    if (isLocale(code)) return code;
  }
  return DEFAULT_LOCALE;
}
