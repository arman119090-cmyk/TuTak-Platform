'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { i18nConfig, isLocale } from '@/i18n/config';
import { notFoundStrings } from '@/i18n/not-found-strings';

// not-found.tsx receives no params; the locale is read back from the path.
export default function NotFound() {
  const seg = (usePathname() ?? '').split('/')[1];
  const locale = isLocale(seg) ? seg : i18nConfig.defaultLocale;
  const t = notFoundStrings[locale];
  return (
    <div className="not-found">
      <p className="eyebrow">404</p>
      <h1 className="page-intro__title">{t.title}</h1>
      <p className="section-text">{t.text}</p>
      <Link href={`/${locale}/collection`} className="button button--ghost">
        {t.back}
      </Link>
    </div>
  );
}
