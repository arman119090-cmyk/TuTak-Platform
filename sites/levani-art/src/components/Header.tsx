'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { localeMeta, locales, type Locale } from '@/i18n/config';
import { swapLocaleInPath } from '@/i18n/negotiate';
import type { SearchEntry } from '@/lib/search';
import { Wordmark } from './Brand';
import { Emblem } from './Emblem';
import { CloseIcon, SearchIcon } from './Icons';
import { LanguageSelector, rememberLocale } from './LanguageSelector';
import { SearchOverlay, type SearchLabels } from './SearchOverlay';

export interface HeaderLabels {
  nav: {
    home: string;
    collection: string;
    paintings: string;
    sculpture: string;
    decorativeArts: string;
    privateClients: string;
    artists: string;
    about: string;
    contact: string;
    enquire: string;
    search: string;
    menu: string;
    primary: string;
  };
  language: { label: string; current: string };
  search: SearchLabels & { open: string };
  a11y: { openMenu: string; closeMenu: string };
}

export function Header({
  locale,
  labels,
  searchIndex,
}: {
  locale: Locale;
  labels: HeaderLabels;
  searchIndex: SearchEntry[];
}) {
  // Static export uses trailing slashes (/en/about/); compare without them.
  const pathname = (usePathname() || `/${locale}`).replace(/(.)\/+$/, '$1');
  const overHero = pathname === `/${locale}`;
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const menuRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const d = menuRef.current;
    if (!d) return;
    if (menuOpen && !d.open) d.showModal();
    if (!menuOpen && d.open) d.close();
  }, [menuOpen]);

  const n = labels.nav;
  const base = `/${locale}`;
  const links = [
    { href: `${base}/collection`, label: n.collection },
    { href: `${base}/collection/paintings`, label: n.paintings },
    { href: `${base}/collection/sculpture`, label: n.sculpture },
    { href: `${base}/collection/decorative-arts`, label: n.decorativeArts },
    { href: `${base}/private-clients`, label: n.privateClients },
    { href: `${base}/about`, label: n.about },
    { href: `${base}/enquire`, label: n.contact },
  ];
  const isCurrent = (href: string) =>
    href === `${base}/collection` ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      <header
        className="site-header"
        data-over-hero={overHero || undefined}
        data-scrolled={scrolled || undefined}
      >
        <div className="site-header__inner">
          <Link href={base} className="site-header__brand" aria-label={n.home}>
            <Wordmark />
          </Link>

          <nav className="site-nav" aria-label={n.primary}>
            <ul>
              {links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} aria-current={isCurrent(l.href) ? 'page' : undefined}>
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="site-header__tools">
            <button
              type="button"
              className="icon-button"
              aria-label={labels.search.open}
              onClick={() => setSearchOpen(true)}
            >
              <SearchIcon />
            </button>
            <Link href={`${base}/enquire`} className="site-header__enquire">
              {n.enquire}
            </Link>
            <LanguageSelector locale={locale} labels={labels.language} />
            <button
              type="button"
              className="menu-toggle"
              aria-label={labels.a11y.openMenu}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
            >
              <span className="menu-toggle__label">{n.menu}</span>
              <span className="menu-toggle__lines" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <dialog
        ref={menuRef}
        className="overlay mobile-menu"
        aria-label={n.menu}
        onClose={() => setMenuOpen(false)}
      >
        <div className="mobile-menu__top">
          <Wordmark />
          <button
            type="button"
            className="icon-button"
            aria-label={labels.a11y.closeMenu}
            onClick={() => setMenuOpen(false)}
          >
            <CloseIcon size={22} />
          </button>
        </div>
        <nav aria-label={n.primary}>
          <ol className="mobile-menu__links">
            {[...links.slice(0, 5), { href: `${base}/artists`, label: n.artists }, ...links.slice(5)].map(
              (l, i) => (
                <li key={l.href} style={{ '--i': i } as React.CSSProperties}>
                  <Link
                    href={l.href}
                    aria-current={isCurrent(l.href) ? 'page' : undefined}
                    onClick={() => setMenuOpen(false)}
                  >
                    <span className="mobile-menu__num" aria-hidden="true">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    {l.label}
                  </Link>
                </li>
              ),
            )}
          </ol>
        </nav>
        <div className="mobile-menu__foot">
          <p className="eyebrow">{labels.language.label}</p>
          <ul className="mobile-menu__langs">
            {locales.map((l) => (
              <li key={l}>
                <Link
                  href={swapLocaleInPath(pathname, l)}
                  lang={localeMeta[l].htmlLang}
                  hrefLang={localeMeta[l].htmlLang}
                  aria-current={l === locale ? 'true' : undefined}
                  onClick={() => {
                    rememberLocale(l);
                    setMenuOpen(false);
                  }}
                >
                  <span className="emblem-box emblem-box--mobile">
                    <Emblem id={localeMeta[l].emblem} size={26} />
                  </span>
                  {localeMeta[l].nativeName}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </dialog>

      <SearchOverlay
        locale={locale}
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        entries={searchIndex}
        labels={labels.search}
      />
    </>
  );
}
