'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { i18nConfig, localeMeta, locales, type Locale } from '@/i18n/config';
import { swapLocaleInPath } from '@/i18n/negotiate';
import { fill } from '@/i18n/plural';
import { Flag } from './Flag';
import { Chevron } from './Icons';

export function rememberLocale(locale: Locale) {
  if (!i18nConfig.persistManualSelection) return;
  document.cookie = `${i18nConfig.cookieName}=${locale}; path=/; max-age=${i18nConfig.cookieMaxAgeSeconds}; samesite=lax`;
}

/**
 * Closed: the current language's flag and a small caret. Hover or keyboard focus
 * reveals the native language name; click or tap opens the list.
 */
export function LanguageSelector({
  locale,
  labels,
}: {
  locale: Locale;
  labels: { label: string; current: string };
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname() || `/${locale}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const menuId = useId();
  const current = localeMeta[locale];

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    const idx = locales.indexOf(locale);
    itemRefs.current[idx]?.focus();
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open, locale]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  const onMenuKey = (e: React.KeyboardEvent) => {
    const items = itemRefs.current.filter(Boolean) as HTMLAnchorElement[];
    const i = items.indexOf(document.activeElement as HTMLAnchorElement);
    const move = (to: number) => {
      e.preventDefault();
      items[(to + items.length) % items.length]?.focus();
    };
    if (e.key === 'ArrowDown') move(i + 1);
    else if (e.key === 'ArrowUp') move(i - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(items.length - 1);
    else if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'Tab') close(false);
  };

  return (
    <div className="lang" ref={rootRef} data-open={open || undefined}>
      <button
        ref={triggerRef}
        type="button"
        className="lang__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={fill(labels.current, { name: current.nativeName })}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Flag id={current.flag} size={16} eager />
        <span className="lang__name" aria-hidden="true">
          {current.nativeName}
        </span>
        <span className="lang__caret" aria-hidden="true">
          <Chevron />
        </span>
      </button>

      <div className="lang__backdrop" aria-hidden="true" onClick={() => close(false)} />
      <div
        id={menuId}
        className="lang__panel"
        role="menu"
        aria-label={labels.label}
        hidden={!open}
        onKeyDown={onMenuKey}
      >
        <p className="lang__heading" aria-hidden="true">
          {labels.label}
        </p>
        {locales.map((l, i) => {
          const meta = localeMeta[l];
          const selected = l === locale;
          return (
            <Link
              key={l}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              href={swapLocaleInPath(pathname, l)}
              hrefLang={meta.htmlLang}
              lang={meta.htmlLang}
              role="menuitemradio"
              aria-checked={selected}
              className="lang__item"
              tabIndex={-1}
              onClick={() => {
                rememberLocale(l);
                setOpen(false);
              }}
            >
              <Flag id={meta.flag} size={18} />
              <span>{meta.nativeName}</span>
              {selected ? <span className="lang__dot" aria-hidden="true" /> : null}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
