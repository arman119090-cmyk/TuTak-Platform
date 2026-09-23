import Link from "next/link";
import { Suspense } from "react";
import type { Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";
import { paths } from "@/lib/paths";
import { env } from "@/lib/env";
import { visibleCollections } from "@/lib/catalog";
import { IconHeart, IconSearch, IconUser } from "@/components/ui/icons";
import { CartButton } from "@/components/cart/cart-button";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { MobileMenu } from "@/components/layout/mobile-menu";
import { Wordmark } from "@/components/layout/wordmark";

export async function SiteHeader({ locale }: { locale: Locale }) {
  const m = getMessages(locale);
  const collections = await visibleCollections(locale);
  const nav = [
    { href: paths.shop(locale), label: m.nav.shop },
    { href: paths.finder(locale), label: m.nav.scentFinder },
    ...(collections.length > 1 ? [{ href: `${paths.home(locale)}#family`, label: m.nav.collections }] : []),
    { href: paths.compare(locale), label: m.nav.compare },
  ];
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-paper/85 backdrop-blur-xl supports-[backdrop-filter]:bg-paper/70">
      <div className="container-lj flex h-16 items-center gap-2">
        <MobileMenu
          locale={locale}
          items={[...nav, { href: paths.favorites(locale), label: m.nav.favorites }, { href: paths.account(locale), label: m.nav.account }]}
        />
        <Link href={paths.home(locale)} className="tap -ml-1 flex items-center px-1" aria-label={env().STORE_NAME}>
          <Wordmark />
        </Link>
        <nav aria-label={m.nav.menu} className="ml-6 hidden lg:block">
          <ul className="flex items-center gap-1">
            {nav.map((n) => (
              <li key={n.href}>
                <Link href={n.href} className="tap inline-flex items-center rounded-full px-3.5 text-[0.92rem] font-medium text-ink-2 hover:bg-mist hover:text-ink">
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-0.5">
          <Link href={paths.shop(locale)} className="tap inline-flex items-center justify-center rounded-full hover:bg-mist" aria-label={m.nav.search}>
            <IconSearch />
          </Link>
          <div className="hidden md:block">
            <Suspense fallback={null}>
              <LanguageSwitcher locale={locale} />
            </Suspense>
          </div>
          <Link href={paths.favorites(locale)} className="tap hidden items-center justify-center rounded-full hover:bg-mist sm:inline-flex" aria-label={m.nav.favorites}>
            <IconHeart />
          </Link>
          <Link href={paths.account(locale)} className="tap hidden items-center justify-center rounded-full hover:bg-mist sm:inline-flex" aria-label={m.nav.account}>
            <IconUser />
          </Link>
          <CartButton />
        </div>
      </div>
    </header>
  );
}
