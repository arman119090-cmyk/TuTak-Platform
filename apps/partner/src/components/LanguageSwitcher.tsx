'use client';

import { useTranslation } from 'react-i18next';
import { SUPPORTED_LOCALES, type SupportedLocale } from '@tutak/i18n';
import { chooseLocale } from '@/lib/i18n/i18n';

/** The language's own name, in that language. Never translated. */
const NATIVE: Record<SupportedLocale, string> = {
  hy: 'Հայերեն',
  ru: 'Русский',
  en: 'English',
};

/**
 * Three languages, next to sign-out.
 *
 * Named in their own alphabets on purpose: somebody looking for Armenian is
 * looking for «Հայերեն», and a list that says "Armenian" in English is a
 * list they have to read in a language they were trying to leave.
 */
export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const current = (SUPPORTED_LOCALES as readonly string[]).includes(i18n.language)
    ? (i18n.language as SupportedLocale)
    : SUPPORTED_LOCALES[0];

  return (
    <div className="mt-2">
      <label htmlFor="panel-language" className="sr-only">
        {t('partnerPanel.nav.language')}
      </label>
      <select
        id="panel-language"
        value={current}
        onChange={(e) => chooseLocale(e.target.value as SupportedLocale)}
        className="w-full rounded-tutak-md border border-line bg-surface px-3 py-2 text-[13px] text-muted transition-colors hover:text-ink focus:border-brand focus:outline-none"
      >
        {SUPPORTED_LOCALES.map((locale) => (
          <option key={locale} value={locale}>
            {NATIVE[locale]}
          </option>
        ))}
      </select>
    </div>
  );
}
