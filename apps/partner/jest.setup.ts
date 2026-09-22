/**
 * The panel's i18n, initialised once for every test.
 *
 * Importing the module is what registers `initReactI18next`, and without it
 * `useTranslation()` in a component rendered outside `I18nProvider` has no
 * instance to read. Pinning the language to English keeps every existing
 * assertion about the English copy meaning what it says; a test that is
 * about another language switches it itself.
 */
import i18n from '@/lib/i18n/i18n';

beforeEach(() => {
  if (i18n.language !== 'en') void i18n.changeLanguage('en');
});
