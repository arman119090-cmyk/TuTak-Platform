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
  { href: '/bonus', label: 'Bonus adjustments', icon: <NavIcon d="M12 3v18M5 8h9a3 3 0 0 1 0 6H5m0 0h10" /> },
  { href: '/refunds', label: 'Refunds', icon: <NavIcon d="M3 10h13a5 5 0 0 1 0 10h-3M3 10l4-4M3 10l4 4" /> },
  { href: '/payouts', label: 'Payouts', icon: <NavIcon d="M3 7h18v11H3zM3 11h18M7 15h3" /> },
  { href: '/ledger', label: 'Ledger', icon: <NavIcon d="M4 4h13l3 3v13H4zM8 9h8M8 13h8M8 17h5" /> },
  { href: '/reconciliation', label: 'Reconciliation', icon: <NavIcon d="M4 7h10M4 7l3-3M4 7l3 3M20 17H10m10 0-3-3m3 3-3 3" /> },
  { href: '/fraud-signals', label: 'Fraud signals', icon: <NavIcon d="M12 3 4 6.5v5c0 4.6 3.2 8.7 8 9.5 4.8-.8 8-4.9 8-9.5v-5L12 3ZM12 9v4M12 16.5h.01" /> },
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
