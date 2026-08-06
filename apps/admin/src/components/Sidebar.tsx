'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { authApi } from '@/lib/api/authApi';
import { useAuthStore } from '@/lib/stores/authStore';

const NAV_ITEMS = [
  { href: '/', label: 'Overview' },
  { href: '/users', label: 'Users' },
  { href: '/partners', label: 'Partners' },
  { href: '/bonus', label: 'Bonus adjustments' },
  { href: '/fraud-signals', label: 'Fraud signals' },
  { href: '/audit-logs', label: 'Audit log' },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, deviceId, clear } = useAuthStore();

  const handleLogout = async () => {
    try {
      await authApi.logout(deviceId);
    } finally {
      clear();
      router.push('/login');
    }
  };

  return (
    <aside className="flex h-screen w-64 flex-col justify-between border-r border-black/5 bg-white p-6">
      <div>
        <div className="mb-8">
          <p className="text-xl font-semibold text-brand-green">TuTak</p>
          <p className="text-xs text-neutral-400">Admin panel</p>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                pathname === item.href
                  ? 'bg-brand-green-light text-brand-green'
                  : 'text-neutral-600 hover:bg-neutral-50'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
      <div>
        <p className="mb-2 text-sm text-neutral-500">
          {user?.firstName} {user?.lastName}
        </p>
        <button
          onClick={handleLogout}
          className="w-full rounded-lg border border-neutral-200 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50"
        >
          Log out
        </button>
      </div>
    </aside>
  );
}
