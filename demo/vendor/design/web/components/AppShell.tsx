'use client';

import * as React from 'react';
import { cx } from './primitives';
import { JakoLockup } from './Jako';
import { ThemeToggle } from '../ThemeToggle';

export interface NavItem {
  href: string;
  label: string;
  icon?: React.ReactNode;
}

/** The accessible names of the narrow-width menu. */
export interface MenuLabels {
  /** The hamburger's accessible name — "Open the menu". */
  open: string;
  /** The close button's accessible name. */
  close: string;
  /** Names both the `<nav>` and the drawer dialog. */
  nav: string;
}

const DEFAULT_MENU_LABELS: MenuLabels = {
  open: 'Open the menu',
  close: 'Close the menu',
  nav: 'Main navigation',
};

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
  footerExtra,
  menuLabels = DEFAULT_MENU_LABELS,
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
  /**
   * Anything the app wants under the sign-out row — a language switcher, for
   * instance. A slot rather than a `locales` prop: the shell is shared by two
   * dashboards with different ideas about preferences, and the one that does
   * not want a control should not have to pass a flag to hide it.
   */
  footerExtra?: React.ReactNode;
  /**
   * The accessible names of the narrow-width menu. English by default so the
   * admin panel, which speaks one language, passes nothing.
   */
  menuLabels?: MenuLabels;
  children: React.ReactNode;
}) {
  const initials = (userName ?? '')
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const [menuOpen, setMenuOpen] = React.useState(false);
  const drawerRef = React.useRef<HTMLDivElement | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);

  /*
   * Close on navigation.
   *
   * Keyed on the path rather than on a click handler passed through
   * `renderLink`: the app supplies its own router's Link, so the shell never
   * sees the click, and a drawer still covering the screen after the page
   * behind it changed is the single most common way this control is got
   * wrong. Skipped on the first render so the drawer is not "closed" before
   * it was ever opened.
   */
  const firstRender = React.useRef(true);
  React.useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setMenuOpen(false);
  }, [currentPath]);

  /*
   * While the drawer is open it is the only thing on the screen: Escape
   * closes it, Tab cycles inside it, and the page behind does not scroll.
   * Focus moves in on open and back to the button on close, so somebody
   * using a keyboard is never left on an element that is no longer there.
   */
  React.useEffect(() => {
    if (!menuOpen) return undefined;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    // The menu button lives in the header and is never unmounted while the
    // drawer is open, so the node read now is the node to return focus to.
    const trigger = triggerRef.current;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    const focusable = () =>
      Array.from(
        drawerRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), select, input, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => element.offsetParent !== null);

    focusable()[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenuOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      if (elements.length === 0) return;
      const first = elements[0]!;
      const last = elements[elements.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = overflow;
      (trigger ?? previouslyFocused)?.focus();
    };
  }, [menuOpen]);

  const navList = (
    <nav aria-label={menuLabels.nav} className="mt-8 flex flex-1 flex-col gap-0.5 overflow-y-auto">
      {nav.map((item) => {
        const active = item.href === '/' ? currentPath === '/' : currentPath.startsWith(item.href);
        return (
          <React.Fragment key={item.href}>
            {renderLink(
              item,
              active,
              cx(
                'flex items-center gap-3 rounded-tutak-md px-3 py-2.5 text-[14px] font-medium transition-colors',
                active ? 'bg-brand-surface text-brand' : 'text-muted hover:bg-canvas hover:text-ink',
              ),
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );

  const footer = (
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
      {footerExtra}
    </div>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 hidden w-[260px] flex-col border-r border-line bg-surface px-4 py-6 lg:flex">
        <div className="px-2">
          <JakoLockup subtitle={subtitle} />
        </div>
        {navList}
        {footer}
      </aside>

      {/*
        Below `lg` the sidebar is hidden, and until 23.09.2026 nothing
        replaced it: every screen was reachable only by typing its address,
        which on a phone means the dashboard has no navigation at all. This
        bar and the drawer behind it are that navigation. The desktop
        sidebar is untouched — the same nav items, the same sign-out, the
        same preferences, in a shape that fits 320px.
      */}
      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface px-4 lg:hidden">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label={menuLabels.open}
          aria-expanded={menuOpen}
          aria-controls="app-shell-drawer"
          className="-ml-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-tutak-md text-muted transition-colors hover:bg-canvas hover:text-ink"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M4 7h16M4 12h16M4 17h16"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <div className="min-w-0">
          <JakoLockup subtitle={subtitle} />
        </div>
      </header>

      {menuOpen ? (
        <>
          <div
            className="fixed inset-0 z-40 bg-ink/50 lg:hidden"
            onClick={() => setMenuOpen(false)}
            aria-hidden
          />
          <div
            id="app-shell-drawer"
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label={menuLabels.nav}
            /* `w-[min(300px,88vw)]`: at 320px the drawer leaves a strip of
               the page visible, so it reads as a panel over the screen
               rather than as a new one. */
            className="fixed inset-y-0 left-0 z-50 flex w-[min(300px,88vw)] flex-col overflow-y-auto border-r border-line bg-surface px-4 py-5 lg:hidden"
          >
            <div className="flex items-center justify-between gap-3 px-2">
              <JakoLockup subtitle={subtitle} />
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label={menuLabels.close}
                className="-mr-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-tutak-md text-muted transition-colors hover:bg-canvas hover:text-ink"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M6 6l12 12M18 6L6 18"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
            {navList}
            {footer}
          </div>
        </>
      ) : null}

      {/*
        `min-w-0` is what makes the tables inside actually scroll.
        A flex child's minimum width defaults to its content's intrinsic
        width, so a wide table pushed this column past the viewport and the
        `overflow-x-auto` wrapper around the table never had anything to
        scroll — the whole page scrolled sideways instead, taking the
        sidebar and the headings with it. Measured at 390px and at 200%
        text: 398px and 220px of page-wide overflow before this.

        `pt-14` clears the fixed bar above, and only below `lg`, where that
        bar exists.
      */}
      <main className="min-w-0 flex-1 pt-14 lg:pl-[260px] lg:pt-0">
        <div className="mx-auto max-w-[1240px] px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
          {children}
        </div>
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
