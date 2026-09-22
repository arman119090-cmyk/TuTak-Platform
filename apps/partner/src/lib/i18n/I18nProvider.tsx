'use client';

import { useEffect } from 'react';
import { I18nextProvider } from 'react-i18next';
import i18n, { syncLocale } from './i18n';
import { useAuthStore } from '@/lib/stores/authStore';

/**
 * The panel's language, kept in one place.
 *
 * Mounted above everything so a page never has to think about whether
 * i18next is ready. The effect follows the signed-in user's stored locale,
 * and `syncLocale` is the one that decides whether it may override what is
 * on this device.
 */
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const locale = useAuthStore((state) => state.user?.locale);

  useEffect(() => {
    syncLocale(locale);
  }, [locale]);

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
