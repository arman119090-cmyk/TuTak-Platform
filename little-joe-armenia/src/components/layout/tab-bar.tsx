"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/i18n/provider";
import { paths } from "@/lib/paths";
import { IconBag, IconCompare, IconHeart, IconUser } from "@/components/ui/icons";

function IconHome(p: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
      <path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1v-8Z" />
    </svg>
  );
}

/** Mobile bottom navigation (hidden from md up), respecting the iPhone home indicator. */
export function TabBar() {
  const { m, locale } = useI18n();
  const pathname = usePathname();
  const items = [
    { href: paths.home(locale), label: m.nav.home, icon: IconHome, exact: true },
    { href: paths.shop(locale), label: m.nav.shop, icon: IconBag },
    { href: paths.compare(locale), label: m.nav.compare, icon: IconCompare },
    { href: paths.favorites(locale), label: m.nav.favorites, icon: IconHeart },
    { href: paths.account(locale), label: m.nav.account, icon: IconUser },
  ];
  return (
    <nav
      aria-label={m.nav.menu}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper/95 pb-[var(--safe-bottom)] backdrop-blur-xl md:hidden"
      data-testid="tab-bar"
    >
      <ul className="grid grid-cols-5">
        {items.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-[0.62rem] font-medium text-muted aria-[current=page]:text-ink"
              >
                <Icon width={21} height={21} strokeWidth={1.5} />
                <span className="max-w-full truncate px-1">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
