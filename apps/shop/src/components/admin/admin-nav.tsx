'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  BarChart3, Boxes, FolderTree, Image as ImageIcon, Inbox, LogOut, Package, Percent, ShoppingCart, Upload, Users,
} from 'lucide-react';
import { brand } from '@/config/brand';
import { cn } from '@/lib/utils';

const ITEMS = [
  { href: '/admin', label: 'Дашборд', icon: BarChart3, exact: true },
  { href: '/admin/orders', label: 'Заказы', icon: ShoppingCart },
  { href: '/admin/products', label: 'Товары', icon: Package },
  { href: '/admin/categories', label: 'Категории и бренды', icon: FolderTree },
  { href: '/admin/promos', label: 'Промокоды', icon: Percent },
  { href: '/admin/banners', label: 'Баннеры', icon: ImageIcon },
  { href: '/admin/requests', label: 'Заявки', icon: Inbox },
  { href: '/admin/customers', label: 'Клиенты', icon: Users },
  { href: '/admin/import', label: 'Импорт', icon: Upload },
];

export const AdminNav = ({ name }: { name: string }) => {
  const pathname = usePathname();
  const router = useRouter();

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/ru');
    router.refresh();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center gap-2 border-b border-line px-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] bg-ink font-display text-white">
          {brand.monogram}
        </span>
        <span className="font-display text-[17px] tracking-[0.12em]">{brand.name}</span>
        <span className="ml-auto rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold text-accent-strong">
          ADMIN
        </span>
      </div>

      <nav className="hide-scrollbar flex gap-1 overflow-x-auto p-3 lg:flex-col lg:overflow-visible">
        {ITEMS.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex h-10 shrink-0 items-center gap-2.5 rounded-[var(--radius-sm)] px-3 text-[13px] transition-colors',
                active ? 'bg-ink text-white' : 'text-ink-soft hover:bg-surface-2',
              )}
            >
              <item.icon width={16} height={16} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto hidden border-t border-line p-3 lg:block">
        <p className="px-3 text-[12px] text-muted">{name}</p>
        <div className="mt-2 flex flex-col gap-1">
          <Link href="/ru" className="flex h-10 items-center gap-2.5 rounded-[var(--radius-sm)] px-3 text-[13px] hover:bg-surface-2">
            <Boxes width={16} height={16} /> В магазин
          </Link>
          <button
            type="button"
            onClick={logout}
            className="flex h-10 items-center gap-2.5 rounded-[var(--radius-sm)] px-3 text-left text-[13px] text-muted hover:bg-surface-2 hover:text-sale"
          >
            <LogOut width={16} height={16} /> Выйти
          </button>
        </div>
      </div>
    </div>
  );
};
