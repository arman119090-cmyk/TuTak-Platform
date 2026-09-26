'use client';

import { useEffect, useState } from 'react';
import { restoreSession } from '@tutak/design/web';
import { Button } from '@tutak/design/web';
import { API_BASE_URL } from '@/lib/httpClient';
import { useAuthStore } from '@/lib/stores/authStore';
import { pickLocale, translate, type SupportedLocale } from '@/lib/i18n';
import { CheckoutView } from './CheckoutView';
import { LoginPanel } from './LoginPanel';

/**
 * The page a partner's website sends the customer to: restore an existing
 * TuTak session from the API's httpOnly cookie, otherwise sign in; then the
 * checkout. There is no path to the order without a TuTak account.
 */
export function CheckoutGate({ orderId, initialLocale }: { orderId: string; initialLocale?: string | null }) {
  const { user, hasRestored, markRestored, clear } = useAuthStore();
  const [locale, setLocale] = useState<SupportedLocale>(() =>
    pickLocale(initialLocale, typeof navigator === 'undefined' ? [] : navigator.languages ?? []),
  );
  const t = (key: string, params?: Record<string, string | number>) => translate(locale, key, params);

  useEffect(() => {
    if (hasRestored) return;
    let cancelled = false;
    void restoreSession(useAuthStore, API_BASE_URL).finally(() => {
      if (!cancelled) markRestored();
    });
    return () => {
      cancelled = true;
    };
  }, [hasRestored, markRestored]);

  return (
    <main className="mx-auto grid max-w-[560px] gap-4 px-4 py-8">
      <header className="flex items-center justify-between">
        <h1 className="text-[22px] font-semibold text-ink">{t('partnerOrder.webCheckoutTitle')}</h1>
        <select
          aria-label="Language"
          className="rounded-md border border-line bg-surface px-2 py-1 text-[13px]"
          value={locale}
          onChange={(e) => setLocale(e.target.value as SupportedLocale)}
        >
          <option value="hy">Հայ</option>
          <option value="ru">Рус</option>
          <option value="en">Eng</option>
        </select>
      </header>
      {!hasRestored ? (
        <div className="text-[14px] text-muted">{t('common.loading')}</div>
      ) : user ? (
        <>
          <div className="flex items-center justify-between text-[12px] text-muted">
            <span>{t('partnerOrder.webSignedInAs', { phone: user.phone })}</span>
            <Button size="sm" variant="tertiary" onClick={() => clear()}>
              {t('partnerOrder.webSignOut')}
            </Button>
          </div>
          <CheckoutView orderId={orderId} locale={locale} />
        </>
      ) : (
        <LoginPanel locale={locale} />
      )}
    </main>
  );
}
