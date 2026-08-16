'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { AppShell, type NavItem } from '@tutak/design/web';
import { authApi } from '@/lib/api/authApi';
import { useAuthStore } from '@/lib/stores/authStore';

const NAV: NavItem[] = [
  { href: '/', label: 'Overview', icon: <NavIcon d="M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5" /> },
  { href: '/transactions', label: 'Transactions', icon: <NavIcon d="M4 7h16M4 7l3-3M4 7l3 3M20 17H4M20 17l-3-3M20 17l-3 3" /> },
  { href: '/qr', label: 'Payment QR', icon: <NavIcon d="M4 4h6v6H4V4ZM14 4h6v6h-6V4ZM4 14h6v6H4v-6ZM14 14h2.5v2.5H14V14ZM19.5 19.5H17V17h2.5v2.5Z" /> },
  { href: '/purchase-intents', label: 'Purchase requests', icon: <NavIcon d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 13l2 2 4-4" /> },
  { href: '/earnings', label: 'Earnings', icon: <NavIcon d="M12 3v18M8 7h6a2.5 2.5 0 0 1 0 5H9a2.5 2.5 0 0 0 0 5h7" /> },
  { href: '/ev-stations', label: 'EV stations', icon: <NavIcon d="m13 2-8 11h6l-2 9 8-11h-6l2-9Z" /> },
  { href: '/integrations', label: 'Integrations', icon: <NavIcon d="M8 12a4 4 0 1 1 8 0 4 4 0 0 1-8 0ZM3 12h2M19 12h2M12 3v2M12 19v2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" /> },
];

function NavIcon({ d }: { d: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d={d}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Sidebar({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, deviceId, clear } = useAuthStore();

  const handleSignOut = async () => {
    try {
      await authApi.logout(deviceId);
    } finally {
      clear();
      router.push('/login');
    }
  };

  return (
    <AppShell
      subtitle="Partner"
      nav={NAV}
      currentPath={pathname}
      userName={user ? `${user.firstName} ${user.lastName}` : undefined}
      userRole={user?.roles?.find((r) => r.startsWith('PARTNER'))?.replace(/_/g, ' ').toLowerCase()}
      onSignOut={handleSignOut}
      renderLink={(item, _active, className) => (
        <Link href={item.href} className={className}>
          {item.icon}
          {item.label}
        </Link>
      )}
    >
      {children}
    </AppShell>
  );
}
