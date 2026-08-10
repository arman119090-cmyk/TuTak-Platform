import * as React from 'react';
import { cx } from './primitives';
import { JakoLockup } from './Jako';
import { ThemeToggle } from '../ThemeToggle';

export interface NavItem {
  href: string;
  label: string;
  icon?: React.ReactNode;
}

/**
 * The dashboard chrome, shared by the admin panel and the partner
 * dashboard. Both surfaces use the identical shell so someone who works in
 * both — a TuTak ops person, say — never has to relearn the furniture; only
 * the subtitle and the nav items differ.
 */
export function AppShell({
  subtitle,
  nav,
  currentPath,
  userName,
  userRole,
  onSignOut,
  signOutLabel = 'Sign out',
  renderLink,
  children,
}: {
  subtitle: string;
  nav: NavItem[];
  currentPath: string;
  userName?: string;
  userRole?: string;
  onSignOut: () => void;
  signOutLabel?: string;
  /** App supplies its router's Link so the shell stays framework-agnostic. */
  renderLink: (item: NavItem, active: boolean, className: string) => React.ReactNode;
  children: React.ReactNode;
}) {
  const initials = (userName ?? '')
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 hidden w-[260px] flex-col border-r border-line bg-surface px-4 py-6 lg:flex">
        <div className="px-2">
          <JakoLockup subtitle={subtitle} />
        </div>

        <nav className="mt-8 flex flex-1 flex-col gap-0.5">
          {nav.map((item) => {
            const active =
              item.href === '/' ? currentPath === '/' : currentPath.startsWith(item.href);
            return (
              <React.Fragment key={item.href}>
                {renderLink(
                  item,
                  active,
                  cx(
                    'flex items-center gap-3 rounded-tutak-md px-3 py-2.5 text-[14px] font-medium transition-colors',
                    active
                      ? 'bg-brand-surface text-brand'
                      : 'text-muted hover:bg-canvas hover:text-ink',
                  ),
                )}
              </React.Fragment>
            );
          })}
        </nav>

        <div className="mt-6 border-t border-line pt-4">
          <div className="flex items-center gap-3 px-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-surface text-[13px] font-semibold text-brand">
              {initials || '—'}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-ink">{userName}</div>
              {userRole ? <div className="truncate text-[11px] text-faint">{userRole}</div> : null}
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={onSignOut}
              className="flex-1 rounded-tutak-md border border-line px-3 py-2 text-[13px] font-medium text-muted transition-colors hover:bg-canvas hover:text-ink"
            >
              {signOutLabel}
            </button>
            {/* Beside sign-out rather than in a settings page: the reason to
                switch is "this is uncomfortable to read right now", and a
                preference you have to go looking for does not get used. */}
            <ThemeToggle />
          </div>
        </div>
      </aside>

      <main className="flex-1 lg:pl-[260px]">
        <div className="mx-auto max-w-[1240px] px-6 py-8 lg:px-10 lg:py-10">{children}</div>
      </main>
    </div>
  );
}

/**
 * Sign-in layout shared by both dashboards: a single centred card on the
 * subtle canvas, Jako at the top, nothing else competing.
 */
export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="rounded-tutak-2xl border border-line bg-surface p-8 shadow-tutak-md">
          {children ? (
            <>
              <JakoLockup />
              <h1 className="mt-7 text-[22px] font-semibold tracking-[-0.02em] text-ink">
                {title}
              </h1>
              {description ? <p className="mt-1.5 text-[14px] text-muted">{description}</p> : null}
              <div className="mt-7">{children}</div>
            </>
          ) : null}
        </div>
        {footer ? <div className="mt-5 text-center text-[13px] text-faint">{footer}</div> : null}
      </div>
    </div>
  );
}
