import Link from "next/link";
import { Suspense } from "react";
import type { Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";
import { paths } from "@/lib/paths";
import { env } from "@/lib/env";
import { IconSearch, IconUser } from "@/components/ui/icons";
import { CartButton } from "@/components/cart/cart-button";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { MobileMenu } from "@/components/layout/mobile-menu";
import { Wordmark } from "@/components/layout/wordmark";
import { NavLinks } from "@/components/layout/nav-links";

export const BRAND_TAGLINE = "Put a smile in the air!";
const HEADER_TAGLINE = "Armenia";

export async function SiteHeader({ locale }: { locale: Locale }) {
  const m = getMessages(locale);
  const nav = [
    { href: paths.shop(locale), label: m.nav.shop },
    { href: paths.finder(locale), label: m.nav.scentFinder },
    { href: paths.compare(locale), label: m.nav.compare },
    { href: paths.favorites(locale), label: m.nav.favorites },
  ];
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-paper/90 backdrop-blur-xl supports-[backdrop-filter]:bg-paper/75">
      <div className="container-lj flex h-16 items-center gap-2 md:h-[4.5rem]">
        <Link href={paths.home(locale)} className="tap flex items-center" aria-label={env().STORE_NAME}>
          <Wordmark tagline={HEADER_TAGLINE} />
        </Link>
        <nav aria-label={m.nav.menu} className="ml-10 hidden lg:block">
          <NavLinks items={nav} />
        </nav>
        <div className="ml-auto flex items-center gap-0.5">
          <Link href={paths.shop(locale)} className="tap inline-flex items-center justify-center rounded-full text-ink-2 hover:text-brand" aria-label={m.nav.search}>
            <IconSearch />
          </Link>
          <CartButton />
          <div className="hidden md:block">
            <Suspense fallback={null}>
              <LanguageSwitcher locale={locale} />
            </Suspense>
          </div>
          <Link
            href={paths.account(locale)}
            className="tap ml-1 hidden items-center gap-2 px-2 text-[0.85rem] font-medium text-ink-2 hover:text-brand lg:inline-flex"
          >
            <IconUser width={20} height={20} />
            {m.nav.account}
          </Link>
          <MobileMenu
            locale={locale}
            items={[...nav, { href: paths.account(locale), label: m.nav.account }]}
          />
        </div>
      </div>
    </header>
  );
}
