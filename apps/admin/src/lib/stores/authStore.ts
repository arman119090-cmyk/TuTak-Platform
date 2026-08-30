'use client';

import { create } from 'zustand';
import type { AuthTokensDto, AuthenticatedUserDto } from '@tutak/shared-types';

interface AuthState {
  user: AuthenticatedUserDto | null;
  accessToken: string | null;
  deviceId: string;
  /**
   * False until the boot-time session restore has finished, either way, so
   * AuthGate can tell "signed out" from "not asked yet".
   */
  hasRestored: boolean;
  markRestored: () => void;
  setSession: (user: AuthenticatedUserDto, tokens: AuthTokensDto) => void;
  setTokens: (tokens: Pick<AuthTokensDto, 'accessToken'>) => void;
  clear: () => void;
}

function getOrCreateDeviceId(): string {
  if (typeof window === 'undefined') return 'ssr';
  const existing = window.localStorage.getItem('tutak-admin-device-id');
  if (existing) return existing;
  const generated = `admin-web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  window.localStorage.setItem('tutak-admin-device-id', generated);
  return generated;
}

/**
 * Session state for the web clients.
 *
 * Nothing that authenticates anything is written to storage. The refresh
 * token lives in an httpOnly cookie the API sets, which page script cannot
 * read; the access token now lives only in this store, in memory, and is gone
 * the moment the tab closes.
 *
 * It used to be persisted here — a short-lived bearer token in
 * `localStorage`, kept so a reload did not force a re-login. That is exactly
 * the value an XSS reads first, and "short-lived" is fifteen minutes of full
 * operator access plus whatever the refresh cookie renews after it. The
 * reload case is now handled by asking the API to rebuild the session from
 * the cookie (`restoreSession`), which page script cannot forge and an
 * attacker cannot read.
 *
 * `deviceId` stays in `localStorage` on purpose: it is not a credential, it
 * identifies this browser to the refresh-token rotation, and it has to
 * survive a reload for that rotation to recognise the device at all.
 */
export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  deviceId: getOrCreateDeviceId(),
  hasRestored: false,
  markRestored: () => set({ hasRestored: true }),
  setSession: (user, tokens) => set({ user, accessToken: tokens.accessToken }),
  setTokens: (tokens) => set({ accessToken: tokens.accessToken }),
  clear: () => set({ user: null, accessToken: null }),
}));

/** Roles allowed into the admin panel; anyone else is bounced back to /login. */
export const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN'] as const;
