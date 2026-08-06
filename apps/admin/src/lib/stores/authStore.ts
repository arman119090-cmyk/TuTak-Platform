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
  const existing = window.localStorage.getItem('tutak-admin-device-id');
  if (existing) return existing;
  const generated = `admin-web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  window.localStorage.setItem('tutak-admin-device-id', generated);
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
    { name: 'tutak-admin-auth' },
  ),
);

/** Roles allowed into the admin panel; anyone else is bounced back to /login. */
export const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN'] as const;
