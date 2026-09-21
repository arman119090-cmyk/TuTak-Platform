'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Heart, LogOut, MapPin, Package, Settings, User } from 'lucide-react';
import type { Dictionary, Locale } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useStore } from '@/components/providers/store-provider';

export const AccountNav = ({ locale, dict }: { locale: Locale; dict: Dictionary }) => {
  const pathname = usePathname();
  const router = useRouter();
  const { toast } = useStore();

  const items = [
    { href: `/${locale}/account`, label: dict.account.profile, icon: User, exact: true },
    { href: `/${locale}/account/orders`, label: dict.account.orders, icon: Package },
    { href: `/${locale}/favorites`, label: dict.account.favorites, icon: Heart },
    { href: `/${locale}/account/addresses`, label: dict.account.addresses, icon: MapPin },
    { href: `/${locale}/account/settings`, label: dict.account.settings, icon: Settings },
  ];

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    toast(dict.auth.logoutDone, 'info');
    router.push(`/${locale}`);
    router.refresh();
  };

  return (
    <nav className="hide-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 lg:mx-0 lg:flex-col lg:px-0">
      {items.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex h-11 shrink-0 items-center gap-2.5 rounded-[var(--radius-sm)] px-3.5 text-[14px] transition-colors',
              active ? 'bg-ink text-white' : 'hover:bg-surface-2',
            )}
          >
            <item.icon width={17} height={17} />
            {item.label}
          </Link>
        );
      })}
      <button
        type="button"
        onClick={logout}
        className="flex h-11 shrink-0 items-center gap-2.5 rounded-[var(--radius-sm)] px-3.5 text-left text-[14px] text-muted hover:bg-surface-2 hover:text-sale"
      >
        <LogOut width={17} height={17} />
        {dict.nav.logout}
      </button>
    </nav>
  );
};
