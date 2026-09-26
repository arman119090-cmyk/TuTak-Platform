'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { AppShell, type NavItem } from '@tutak/design/web';
import { authApi } from '@/lib/api/authApi';
import { useAuthStore } from '@/lib/stores/authStore';

const NAV: NavItem[] = [
  { href: '/', label: 'Overview', icon: <NavIcon d="M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5" /> },
  { href: '/users', label: 'Users', icon: <NavIcon d="M16 20v-1.5A3.5 3.5 0 0 0 12.5 15h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM20 20v-1.5a3.5 3.5 0 0 0-2.6-3.4M15.5 4.2a3.5 3.5 0 0 1 0 6.6" /> },
  { href: '/partners', label: 'Partners', icon: <NavIcon d="M3 21h18M5 21V8l7-5 7 5v13M9.5 21v-5h5v5" /> },
  { href: '/media', label: 'Brand media', icon: <NavIcon d="M4 16.5V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1.5Zm0 0 4.5-4.5 3 3 3.5-3.5L20 15M9 9.5a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Z" /> },
  { href: '/roaming-cpo-stations', label: 'Roaming-CPO stations', icon: <NavIcon d="M13 2 4 14h7l-1 8 10-13h-7l0-7Z" /> },
  { href: '/bonus', label: 'Bonus adjustments', icon: <NavIcon d="M12 3v18M5 8h9a3 3 0 0 1 0 6H5m0 0h10" /> },
  { href: '/refunds', label: 'Refunds', icon: <NavIcon d="M3 10h13a5 5 0 0 1 0 10h-3M3 10l4-4M3 10l4 4" /> },
  { href: '/payouts', label: 'Payouts', icon: <NavIcon d="M3 7h18v11H3zM3 11h18M7 15h3" /> },
  { href: '/ledger', label: 'Ledger', icon: <NavIcon d="M4 4h13l3 3v13H4zM8 9h8M8 13h8M8 17h5" /> },
  { href: '/reconciliation', label: 'Reconciliation', icon: <NavIcon d="M4 7h10M4 7l3-3M4 7l3 3M20 17H10m10 0-3-3m3 3-3 3" /> },
  { href: '/fraud-signals', label: 'Fraud signals', icon: <NavIcon d="M12 3 4 6.5v5c0 4.6 3.2 8.7 8 9.5 4.8-.8 8-4.9 8-9.5v-5L12 3ZM12 9v4M12 16.5h.01" /> },
  { href: '/partner-orders', label: 'Partner orders', icon: <NavIcon d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4M3 6h18M16 10a4 4 0 0 1-8 0" /> },
  { href: '/partner-order-disputes', label: 'Order disputes', icon: <NavIcon d="M12 3 3 7v5c0 5 3.8 8.4 9 9 5.2-.6 9-4 9-9V7l-9-4Z" /> },
  { href: '/commerce-reviews', label: 'Commerce reviews', icon: <NavIcon d="M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" /> },
  { href: '/commerce-settings', label: 'Commerce settings', icon: <NavIcon d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" /> },
  { href: '/partner-order-escalations', label: 'Order escalations', icon: <NavIcon d="M12 9v4M12 16.5h.01M10.3 3.9 2.5 18a1.5 1.5 0 0 0 1.3 2.2h16.4a1.5 1.5 0 0 0 1.3-2.2L13.7 3.9a1.5 1.5 0 0 0-2.6 0Z" /> },
  { href: '/partner-order-sourcing', label: 'Sourcing queue', icon: <NavIcon d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM21 21l-4.3-4.3" /> },
  { href: '/audit-logs', label: 'Audit log', icon: <NavIcon d="M8 3h8l4 4v14H4V3h4ZM15 3v5h5M8.5 13h7M8.5 17h4" /> },
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
      subtitle="Admin"
      nav={NAV}
      currentPath={pathname}
      userName={user ? `${user.firstName} ${user.lastName}` : undefined}
      userRole={user?.roles?.[0]}
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
