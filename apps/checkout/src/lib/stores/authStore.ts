'use client';

import { create } from 'zustand';
import { resetSessionCaches } from '@tutak/design/web';
import type { AuthTokensDto, AuthenticatedUserDto } from '@tutak/shared-types';

interface AuthState {
  user: AuthenticatedUserDto | null;
  accessToken: string | null;
  deviceId: string;
  hasRestored: boolean;
  /**
   * Which session the state above belongs to — bumped by every sign-in and
   * sign-out, exactly as in the dashboards. A refresh that left before a
   * sign-out and answers after it carries a real token for a session that is
   * gone; only this counter says so (`createHttpClient` checks it).
   */
  sessionEpoch: number;
  markRestored: () => void;
  setSession: (user: AuthenticatedUserDto, tokens: AuthTokensDto) => void;
  /** Refused (returns false) when `expectedEpoch` is given and no longer current. */
  setTokens: (tokens: Pick<AuthTokensDto, 'accessToken'>, expectedEpoch?: number) => boolean;
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
export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  deviceId: getOrCreateDeviceId(),
  hasRestored: false,
  sessionEpoch: 0,
  markRestored: () => set({ hasRestored: true }),
  setSession: (user, tokens) => {
    // Before the new session is visible: an order fetched for the previous
    // customer must never render under the new one's name.
    resetSessionCaches();
    set({ user, accessToken: tokens.accessToken, sessionEpoch: get().sessionEpoch + 1 });
  },
  setTokens: (tokens, expectedEpoch) => {
    if (expectedEpoch !== undefined && expectedEpoch !== get().sessionEpoch) return false;
    set({ accessToken: tokens.accessToken });
    return true;
  },
  clear: () => {
    set({ user: null, accessToken: null, sessionEpoch: get().sessionEpoch + 1 });
    resetSessionCaches();
  },
}));
