'use client';

import React, { useEffect, useState } from 'react';
import { DEFAULT_THEME, THEME_STORAGE_KEY, ThemeName } from './theme-script';

/**
 * Switches the dashboard between the dark scheme the product ships with and
 * the light one.
 *
 * The dashboards default to dark so the platform looks like one product, but
 * these are tools people read tables in for an hour at a time, and that is a
 * genuine reason to want a light background. Offering the choice costs one
 * button; forcing either answer costs somebody their afternoon.
 *
 * Reads the attribute the inline head script already set rather than keeping
 * its own default, so the button never disagrees with what is on screen.
 */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useState<ThemeName>(DEFAULT_THEME);

  useEffect(() => {
    const current = document.documentElement.getAttribute('data-theme');
    if (current === 'light' || current === 'dark') setTheme(current);
  }, []);

  const toggle = () => {
    const next: ThemeName = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private browsing. The switch still works for this session.
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      // The label says what pressing it does, not what the current state is —
      // a screen reader user gets no benefit from being told the theme they
      // cannot see.
      aria-label={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}
      title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-tutak-md border border-line text-secondary transition-colors hover:bg-surface-sunken hover:text-ink ${className}`}
    >
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}
