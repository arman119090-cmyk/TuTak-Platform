'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  ChevronDown, Heart, Menu, Phone, Scale, Search, ShoppingBag, User, X, Truck, Sparkles,
} from 'lucide-react';
import { brand, brandName, isDemoMode } from '@/config/brand';
import type { Dictionary, Locale } from '@/lib/i18n';
import { LOCALES, localizePath } from '@/lib/i18n';
import type { CategoryTree } from '@/lib/catalog/queries';
import { cn } from '@/lib/utils';
import { LOCALE_COOKIE, writeCookie } from '@/lib/client-cookies';
import { useStore } from '@/components/providers/store-provider';
import { SearchBox } from './search-box';

const HIGHLIGHT_CATEGORIES = ['sofas', 'beds', 'wardrobes', 'kitchens', 'tables', 'chairs', 'doors'];

const CountBadge = ({ value }: { value: number }) =>
  value > 0 ? (
    <span className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white tabular-nums">
      {value > 99 ? '99+' : value}
    </span>
  ) : null;

export const Header = ({
  locale,
  dict,
  tree,
  session,
}: {
  locale: Locale;
  dict: Dictionary;
  tree: CategoryTree;
  session: { name: string; role: string } | null;
}) => {
  const pathname = usePathname();
  const router = useRouter();
  const { cartCount, favorites, compare } = useStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [megaOpen, setMegaOpen] = useState(false);
  const [mobileSearch, setMobileSearch] = useState(false);
  const [activeRoot, setActiveRoot] = useState(tree[0]?.slug ?? '');

  useEffect(() => {
    setMenuOpen(false);
    setMegaOpen(false);
    setMobileSearch(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  const switchLocale = (next: Locale) => {
    writeCookie(LOCALE_COOKIE, next);
    router.push(localizePath(pathname, next));
  };

  const highlights = HIGHLIGHT_CATEGORIES.map((slug) => tree.find((root) => root.slug === slug)).filter(
    (root): root is CategoryTree[number] => Boolean(root),
  );
  const activeTree = tree.find((root) => root.slug === activeRoot) ?? tree[0];

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur">
      {/* utility bar */}
      <div className="hidden border-b border-line bg-surface-2 lg:block">
        <div className="container-page flex h-9 items-center justify-between text-[12px] text-muted">
          <div className="flex items-center gap-5">
            <span className="inline-flex items-center gap-1.5">
              <Truck width={14} height={14} /> {dict.advantages.deliveryTitle}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Sparkles width={14} height={14} /> {dict.advantages.measureTitle}
            </span>
            {isDemoMode ? (
              <span className="rounded-full bg-accent-soft px-2 py-0.5 font-semibold text-accent-strong">
                {dict.common.demoBadge}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-1.5">
              <Phone width={14} height={14} />
              {brand.contacts.phones.map((phone, index) => (
                <a
                  key={phone.dial}
                  href={`tel:${phone.dial}`}
                  className={cn('hover:text-ink', index > 0 && 'hidden xl:inline')}
                >
                  {index > 0 ? <span className="mr-1.5 text-line-strong">·</span> : null}
                  {phone.display}
                </a>
              ))}
            </span>
            <div className="flex items-center gap-1">
              {LOCALES.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => switchLocale(item)}
                  className={cn(
                    'rounded px-1.5 py-0.5 uppercase transition-colors',
                    item === locale ? 'font-semibold text-ink' : 'hover:text-ink',
                  )}
                  aria-current={item === locale}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* main bar */}
      <div className="container-page flex h-16 items-center gap-3 lg:h-[72px] lg:gap-8">
        <button
          type="button"
          className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center lg:hidden"
          onClick={() => setMenuOpen(true)}
          aria-label={dict.nav.menu}
        >
          <Menu width={22} height={22} />
        </button>

        {/* min-w-0 + truncate: a long brand name must give way to the burger
            and the cart icons on a narrow phone, not push them off-screen. */}
        <Link href={`/${locale}`} className="flex min-w-0 shrink items-center gap-2" aria-label={brandName(locale)}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-ink font-display text-lg text-white">
            {brand.monogram}
          </span>
          <span className="flex min-w-0 flex-col leading-none">
            {/* Under 360px the monogram carries the brand on its own — a
                wordmark truncated to one letter reads as a broken layout. */}
            <span className="hidden truncate font-display text-[13px] uppercase tracking-[0.02em] min-[360px]:block xs:text-[17px] xs:tracking-[0.1em] sm:text-xl sm:tracking-[0.12em]">
              {brandName(locale)}
            </span>
            <span className="mt-0.5 hidden text-[10px] uppercase tracking-[0.18em] text-muted sm:block">
              {dict.locale.switch === 'Язык' ? 'мебель и двери' : 'furniture & doors'}
            </span>
          </span>
        </Link>

        <div className="hidden flex-1 lg:block">
          <SearchBox locale={locale} dict={dict} />
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-0.5 lg:gap-1">
          <button
            type="button"
            className="flex h-11 w-11 items-center justify-center lg:hidden"
            onClick={() => setMobileSearch((value) => !value)}
            aria-label={dict.search.title}
          >
            <Search width={20} height={20} />
          </button>
          <Link
            href={`/${locale}/compare`}
            className="relative hidden h-11 w-11 items-center justify-center rounded-[var(--radius-sm)] hover:bg-surface-2 sm:flex"
            aria-label={dict.nav.compare}
          >
            <Scale width={20} height={20} />
            <CountBadge value={compare.length} />
          </Link>
          <Link
            href={`/${locale}/favorites`}
            className="relative flex h-11 w-11 items-center justify-center rounded-[var(--radius-sm)] hover:bg-surface-2"
            aria-label={dict.nav.favorites}
          >
            <Heart width={20} height={20} />
            <CountBadge value={favorites.length} />
          </Link>
          <Link
            href={`/${locale}/cart`}
            className="relative flex h-11 w-11 items-center justify-center rounded-[var(--radius-sm)] hover:bg-surface-2"
            aria-label={dict.nav.cart}
          >
            <ShoppingBag width={20} height={20} />
            <CountBadge value={cartCount} />
          </Link>
          <Link
            href={session ? `/${locale}/account` : `/${locale}/login`}
            className="hidden h-11 items-center gap-2 rounded-[var(--radius-sm)] px-2 hover:bg-surface-2 min-[400px]:flex"
            aria-label={session ? dict.nav.account : dict.nav.login}
          >
            <User width={20} height={20} />
            <span className="hidden max-w-[110px] truncate text-[13px] lg:block">
              {session ? session.name : dict.nav.login}
            </span>
          </Link>
        </div>
      </div>

      {mobileSearch ? (
        <div className="container-page pb-3 lg:hidden">
          <SearchBox locale={locale} dict={dict} variant="mobile" onClose={() => setMobileSearch(false)} />
        </div>
      ) : null}

      {/* category bar */}
      <nav className="hidden border-t border-line lg:block" onMouseLeave={() => setMegaOpen(false)}>
        <div className="container-page flex h-12 items-center gap-1 text-sm">
          <button
            type="button"
            className={cn(
              'flex h-9 items-center gap-2 rounded-[var(--radius-sm)] px-3 font-medium transition-colors',
              megaOpen ? 'bg-ink text-white' : 'hover:bg-surface-2',
            )}
            onClick={() => setMegaOpen((value) => !value)}
            onMouseEnter={() => setMegaOpen(true)}
            aria-expanded={megaOpen}
          >
            <Menu width={16} height={16} />
            {dict.nav.catalog}
            <ChevronDown width={14} height={14} className={cn('transition-transform', megaOpen && 'rotate-180')} />
          </button>
          {highlights.map((root) => (
            <Link
              key={root.slug}
              href={`/${locale}/catalog/${root.slug}`}
              className="flex h-9 items-center rounded-[var(--radius-sm)] px-3 hover:bg-surface-2"
              onMouseEnter={() => {
                setActiveRoot(root.slug);
                setMegaOpen(true);
              }}
            >
              {root.name}
            </Link>
          ))}
          <Link
            href={`/${locale}/catalog?discounted=1`}
            className="flex h-9 items-center rounded-[var(--radius-sm)] px-3 font-medium text-sale hover:bg-surface-2"
          >
            {dict.nav.sale}
          </Link>
          <Link
            href={`/${locale}/kitchens`}
            className="ml-auto flex h-9 items-center rounded-[var(--radius-sm)] border border-line-strong px-3 text-[13px] hover:border-ink"
          >
            {dict.home.kitchensCta}
          </Link>
        </div>

        {megaOpen ? (
          <div className="absolute inset-x-0 border-t border-line bg-surface shadow-[var(--shadow-pop)]">
            <div className="container-page grid grid-cols-[240px_1fr] gap-8 py-6">
              <ul className="border-r border-line pr-4">
                {tree.map((root) => (
                  <li key={root.slug}>
                    <Link
                      href={`/${locale}/catalog/${root.slug}`}
                      onMouseEnter={() => setActiveRoot(root.slug)}
                      className={cn(
                        'flex items-center justify-between rounded-[var(--radius-xs)] px-3 py-2 text-[13px] transition-colors',
                        activeRoot === root.slug ? 'bg-surface-2 font-medium' : 'hover:bg-surface-2',
                      )}
                    >
                      {root.name}
                      <span className="text-[11px] text-muted tabular-nums">{root.productCount}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <div>
                <div className="mb-4 flex items-baseline justify-between">
                  <h3 className="text-xl">{activeTree?.name}</h3>
                  <Link href={`/${locale}/catalog/${activeTree?.slug}`} className="text-[13px] text-accent hover:underline">
                    {dict.common.showAll} →
                  </Link>
                </div>
                <p className="mb-4 max-w-2xl text-[13px] text-muted">{activeTree?.description}</p>
                <div className="grid grid-cols-3 gap-x-6 gap-y-1">
                  {(activeTree?.children.length ? activeTree.children : []).map((child) => (
                    <Link
                      key={child.slug}
                      href={`/${locale}/catalog/${child.slug}`}
                      className="flex items-center justify-between rounded-[var(--radius-xs)] px-2 py-1.5 text-[13px] hover:bg-surface-2"
                    >
                      <span>{child.name}</span>
                      <span className="text-[11px] text-muted tabular-nums">{child.productCount}</span>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </nav>

      {/* mobile drawer */}
      {menuOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setMenuOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[88%] max-w-sm flex-col bg-surface">
            <div className="flex h-16 items-center justify-between border-b border-line px-4">
              <span className="font-display text-lg uppercase tracking-[0.1em]">{brandName(locale)}</span>
              <button type="button" onClick={() => setMenuOpen(false)} aria-label={dict.common.close} className="flex h-11 w-11 items-center justify-center">
                <X width={22} height={22} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-3">
              {tree.map((root) => (
                <details key={root.slug} className="border-b border-line/70">
                  <summary className="flex cursor-pointer items-center justify-between px-3 py-3.5 text-[15px]">
                    {root.name}
                    <ChevronDown width={16} height={16} className="text-muted" />
                  </summary>
                  <div className="pb-2">
                    <Link href={`/${locale}/catalog/${root.slug}`} className="block px-6 py-2.5 text-[14px] text-accent">
                      {dict.common.showAll}
                    </Link>
                    {root.children.map((child) => (
                      <Link key={child.slug} href={`/${locale}/catalog/${child.slug}`} className="block px-6 py-2.5 text-[14px] text-ink-soft">
                        {child.name}
                      </Link>
                    ))}
                  </div>
                </details>
              ))}
              <div className="mt-3 space-y-1 px-3">
                {/* The account icon steps aside on the narrowest phones, so the
                    drawer must always offer a way in. */}
                <Link
                  href={session ? `/${locale}/account` : `/${locale}/login`}
                  className="flex items-center gap-2.5 py-2.5 text-[15px]"
                >
                  <User width={17} height={17} />
                  {session ? dict.nav.account : dict.nav.login}
                </Link>
                <Link href={`/${locale}/kitchens`} className="block py-2.5 text-[15px]">{dict.home.kitchensCta}</Link>
                <Link href={`/${locale}/catalog?discounted=1`} className="block py-2.5 text-[15px] text-sale">{dict.nav.sale}</Link>
                <Link href={`/${locale}/compare`} className="block py-2.5 text-[15px]">{dict.nav.compare} ({compare.length})</Link>
                <Link href={`/${locale}/pages/delivery`} className="block py-2.5 text-[15px]">{dict.product.delivery}</Link>
                <Link href={`/${locale}/pages/contacts`} className="block py-2.5 text-[15px]">{dict.nav.contacts}</Link>
              </div>
            </div>
            <div className="border-t border-line p-4">
              <div className="mb-3 flex items-center gap-2">
                {LOCALES.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => switchLocale(item)}
                    className={cn(
                      'h-9 flex-1 rounded-[var(--radius-sm)] border text-[13px] uppercase',
                      item === locale ? 'border-ink bg-ink text-white' : 'border-line',
                    )}
                  >
                    {item}
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-2">
                {brand.contacts.phones.map((phone) => (
                  <a
                    key={phone.dial}
                    href={`tel:${phone.dial}`}
                    className="flex h-11 items-center justify-center gap-2 rounded-[var(--radius-sm)] bg-surface-2 text-sm"
                  >
                    <Phone width={16} height={16} /> {phone.display}
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
};
