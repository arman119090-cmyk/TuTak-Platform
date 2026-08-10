import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import { DEFAULT_LOCALE, i18nResources, isSupportedLocale } from '@tutak/i18n';

const deviceLocale = Localization.getLocales()[0]?.languageCode ?? DEFAULT_LOCALE;
const startingLocale = isSupportedLocale(deviceLocale) ? deviceLocale : DEFAULT_LOCALE;

i18n.use(initReactI18next).init({
  resources: i18nResources,
  lng: startingLocale,
  fallbackLng: DEFAULT_LOCALE,
  interpolation: { escapeValue: false },
  compatibilityJSON: 'v4',
});

export default i18n;
