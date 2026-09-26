'use client';

import { create } from 'zustand';
import type { AuthTokensDto, AuthenticatedUserDto } from '@tutak/shared-types';

interface AuthState {
  user: AuthenticatedUserDto | null;
  accessToken: string | null;
  deviceId: string;
  hasRestored: boolean;
  markRestored: () => void;
  setSession: (user: AuthenticatedUserDto, tokens: AuthTokensDto) => void;
  setTokens: (tokens: Pick<AuthTokensDto, 'accessToken'>) => void;
  clear: () => void;
}

function getOrCreateDeviceId(): string {
  if (typeof window === 'undefined') return 'ssr';
  try {
    const existing = window.localStorage.getItem('tutak-checkout-device-id');
    if (existing) return existing;
    const generated = `checkout-web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem('tutak-checkout-device-id', generated);
    return generated;
  } catch {
    return `checkout-web-${Date.now()}`;
  }
}

/**
 * The customer's session in TuTak Web Checkout — the same discipline as the
 * dashboards: the access token lives in memory only, the refresh token in the
 * API's httpOnly cookie; only the (non-secret) device id is stored.
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
