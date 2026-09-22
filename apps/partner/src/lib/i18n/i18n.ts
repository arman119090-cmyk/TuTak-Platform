import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LOCALE, i18nResources, isSupportedLocale, type SupportedLocale } from '@tutak/i18n';

export const LOCALE_STORAGE_KEY = 'tutak.partner.locale';

/**
 * The language to start in, before anything has been fetched.
 *
 * Order matters and is not arbitrary. A locale the person chose here wins,
 * because they chose it on this screen. Otherwise the browser's own
 * preference, since on a first visit it is the only evidence there is. The
 * signed-in user's stored locale arrives later, with their profile, and
 * `syncLocale` applies it only if they have not chosen here — changing the
 * language under somebody mid-sentence because a request came back is worse
 * than being briefly in the wrong one.
 *
 * `localStorage` is read inside a try: it throws in a locked-down browser,
 * and a dashboard that will not render because it could not read a language
 * preference is a worse failure than the wrong language.
 */
export function startingLocale(): SupportedLocale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  try {
    const chosen = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (chosen && isSupportedLocale(chosen)) return chosen;
  } catch {
    // Storage unavailable. Fall through to the browser's own preference.
  }
  const fromBrowser = window.navigator?.language?.split('-')[0];
  return fromBrowser && isSupportedLocale(fromBrowser) ? fromBrowser : DEFAULT_LOCALE;
}

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: i18nResources,
    lng: startingLocale(),
    fallbackLng: DEFAULT_LOCALE,
    interpolation: { escapeValue: false },
    // The panel renders on the server first. Without this, i18next warns on
    // every render about a missing DOM and React logs a hydration mismatch
    // for text that is in fact identical.
    react: { useSuspense: false },
  });
}

/** Remember a language the person picked, and switch to it now. */
export function chooseLocale(locale: SupportedLocale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Not remembered across reloads. The switch itself still works.
  }
  void i18n.changeLanguage(locale);
}

/**
 * Follow the signed-in user's stored locale — unless they have chosen one
 * here, in which case the choice on this device wins.
 */
export function syncLocale(userLocale: string | null | undefined): void {
  if (!userLocale || !isSupportedLocale(userLocale)) return;
  try {
    if (window.localStorage.getItem(LOCALE_STORAGE_KEY)) return;
  } catch {
    // Cannot tell whether they chose one. Following the profile is the
    // better guess than staying in the browser's language.
  }
  if (i18n.language !== userLocale) void i18n.changeLanguage(userLocale);
}

export default i18n;
