'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthTokensDto, AuthenticatedUserDto } from '@tutak/shared-types';

interface AuthState {
  user: AuthenticatedUserDto | null;
  accessToken: string | null;
  deviceId: string;
  /** False until zustand has read persisted state back, so AuthGate can wait. */
  hasHydrated: boolean;
  markHydrated: () => void;
  setSession: (user: AuthenticatedUserDto, tokens: AuthTokensDto) => void;
  setTokens: (tokens: Pick<AuthTokensDto, 'accessToken'>) => void;
  clear: () => void;
}

function getOrCreateDeviceId(): string {
  if (typeof window === 'undefined') return 'ssr';
  const existing = window.localStorage.getItem('tutak-partner-device-id');
  if (existing) return existing;
  const generated = `partner-web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  window.localStorage.setItem('tutak-partner-device-id', generated);
  return generated;
}

/**
 * Session state for the web clients.
 *
 * The refresh token is deliberately absent. Both tokens used to be persisted
 * here, so any XSS — including one arriving through a dependency — walked away
 * with a 30-day refresh token and full control of an operator account
 * (docs/AUDIT_2026-08-B.md §H2). It now lives in an httpOnly cookie the API
 * sets, which page script cannot read; only the short-lived access token is
 * kept here, and only so a reload does not force a re-login.
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      deviceId: getOrCreateDeviceId(),
      hasHydrated: false,
      markHydrated: () => set({ hasHydrated: true }),
      setSession: (user, tokens) => set({ user, accessToken: tokens.accessToken }),
      setTokens: (tokens) => set({ accessToken: tokens.accessToken }),
      clear: () => set({ user: null, accessToken: null }),
    }),
    {
      name: 'tutak-partner-auth',
      // Hydration is deferred so the first client render matches the server's,
      // and AuthGate can tell "not logged in" from "not read yet" — without
      // this it redirected authenticated operators to /login on every reload
      // and every deep link (§M19).
      skipHydration: true,
      partialize: (state) => ({ user: state.user, accessToken: state.accessToken }),
      onRehydrateStorage: () => (state) => state?.markHydrated(),
    },
  ),
);

export const PARTNER_ROLES = ['PARTNER_OWNER', 'PARTNER_STAFF'] as const;

/** MVP assumption: a partner-role user belongs to exactly one partner. */
export function getPrimaryPartnerId(user: AuthenticatedUserDto | null): string | null {
  if (!user) return null;
  for (const role of PARTNER_ROLES) {
    const ids = user.partnerScopes[role];
    if (ids && ids.length > 0) return ids[0];
  }
  return null;
}
