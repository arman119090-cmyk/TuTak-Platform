import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import {
  createTranslator,
  DEFAULT_LOCALE,
  formatAmountOnly,
  formatMoney,
  isLocale,
  type Locale,
  type MoneyLike,
  type TranslationKey,
} from '@cashout/i18n';

const STORAGE_KEY = 'cashout.locale';

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
  money: (amount: MoneyLike) => string;
  amount: (amount: MoneyLike) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

/**
 * Picks the driver's language from what they chose before, then from the phone,
 * then Armenian. Armenian rather than English as the final fallback: this ships
 * in Armenia, and an English screen is a failure for the person holding the
 * phone, not a neutral default.
 */
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => detectLocale());

  useEffect(() => {
    void AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (isLocale(stored)) setLocaleState(stored);
    });
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    void AsyncStorage.setItem(STORAGE_KEY, next);
  }, []);

  const value: I18nValue = {
    locale,
    setLocale,
    t: createTranslator(locale),
    money: (amount) => formatMoney(amount, locale),
    amount: (amount) => formatAmountOnly(amount, locale),
  };

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside an I18nProvider');
  return value;
}

function detectLocale(): Locale {
  for (const entry of getLocales()) {
    const code = entry.languageCode ?? '';
    if (isLocale(code)) return code;
  }
  return DEFAULT_LOCALE;
}
