'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthTokensDto, AuthenticatedUserDto } from '@tutak/shared-types';

interface AuthState {
  user: AuthenticatedUserDto | null;
  accessToken: string | null;
  refreshToken: string | null;
  deviceId: string;
  setSession: (user: AuthenticatedUserDto, tokens: AuthTokensDto) => void;
  setTokens: (tokens: Pick<AuthTokensDto, 'accessToken' | 'refreshToken'>) => void;
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

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      deviceId: getOrCreateDeviceId(),
      setSession: (user, tokens) =>
        set({ user, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }),
      setTokens: (tokens) => set({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }),
      clear: () => set({ user: null, accessToken: null, refreshToken: null }),
    }),
    { name: 'tutak-partner-auth' },
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
