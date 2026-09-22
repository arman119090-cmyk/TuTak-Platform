'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';
import { DEFAULT_LOCALE, i18nResources, isSupportedLocale } from '@tutak/i18n';

/**
 * Next.js replaces the whole root layout with this component when an error
 * escapes every nested error boundary — so it renders its own <html>/<body>.
 * A no-op when NEXT_PUBLIC_SENTRY_DSN is unset, same as everywhere else.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  /*
   * The bundle is read directly rather than through `useTranslation`.
   *
   * This component replaces the whole root layout, so the i18n provider
   * that every other screen sits inside is exactly one of the things that
   * is gone by the time this renders. Reading the resource object is the
   * only way this sentence is not English on a Russian person's screen,
   * and it cannot throw: a missing key falls through to the Armenian one.
   */
  const locale = resolveLocale();
  const copy = (i18nResources[locale].translation as PanelCopy).partnerPanel?.notice;

  return (
    <html lang={locale}>
      <body>
        <p>{copy?.globalFailed ?? 'Something went wrong.'}</p>
      </body>
    </html>
  );
}

interface PanelCopy {
  partnerPanel?: { notice?: { globalFailed?: string } };
}

/** The chosen language, then the browser's, then Armenian. */
function resolveLocale() {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  try {
    const chosen = window.localStorage.getItem('tutak.partner.locale');
    if (chosen && isSupportedLocale(chosen)) return chosen;
  } catch {
    // Storage blocked. The browser's own preference is the next best guess.
  }
  const fromBrowser = window.navigator?.language?.split('-')[0];
  return fromBrowser && isSupportedLocale(fromBrowser) ? fromBrowser : DEFAULT_LOCALE;
}
