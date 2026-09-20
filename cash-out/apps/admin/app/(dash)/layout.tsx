import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { currentAdmin, SESSION_COOKIE } from '@/lib/api';

const NAV: Array<{ href: string; label: string; permission: string }> = [
  { href: '/', label: 'Dashboard', permission: 'dashboard:read' },
  { href: '/withdrawals', label: 'Withdrawals', permission: 'withdrawals:read' },
  { href: '/withdrawals/attention', label: 'Needs attention', permission: 'withdrawals:read' },
  { href: '/parks', label: 'Taxi parks', permission: 'parks:read' },
  { href: '/drivers', label: 'Drivers', permission: 'drivers:read' },
  { href: '/driver-id-requests', label: 'Driver ID requests', permission: 'drivers:read' },
  { href: '/auto-payout', label: 'Automatic payouts', permission: 'withdrawals:read' },
  { href: '/reconciliation', label: 'Reconciliation', permission: 'reconciliation:read' },
  { href: '/fees', label: 'Fees', permission: 'fees:read' },
  { href: '/limits', label: 'Limits', permission: 'limits:read' },
  { href: '/integrations', label: 'Integrations', permission: 'integrations:read' },
  { href: '/audit', label: 'Audit log', permission: 'audit:read' },
];

async function signOut(): Promise<void> {
  'use server';
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect('/sign-in');
}

/**
 * The navigation is filtered by the operator's own permissions, so a viewer
 * does not see links that would 403. The server enforces the same permissions
 * regardless — hiding a link is a courtesy, not a control.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const admin = await currentAdmin();
  const visible = NAV.filter((item) => admin.permissions.includes(item.permission as never));

  return (
    <div className="layout">
      <aside className="sidebar">
        <div>
          <strong style={{ fontSize: 18 }}>Cash Out</strong>
          <div className="muted" style={{ fontSize: 12 }}>
            operations
          </div>
        </div>

        <nav>
          {visible.map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>

        <div style={{ marginTop: 'auto' }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            {admin.email}
            <br />
            <span className="chip neutral">{admin.role}</span>
          </div>
          <form action={signOut}>
            <button className="secondary" type="submit" style={{ width: '100%' }}>
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main className="main">{children}</main>
    </div>
  );
}
