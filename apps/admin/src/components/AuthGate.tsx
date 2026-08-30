'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { restoreSession } from '@tutak/design/web';
import { API_BASE_URL } from '@/lib/httpClient';
import { ADMIN_ROLES, useAuthStore } from '@/lib/stores/authStore';

/**
 * Decides whether the dashboard may render, and rebuilds the session first.
 *
 * The access token is no longer persisted anywhere, so on a fresh page load
 * this component has nothing in hand and must ask: the browser still holds
 * the httpOnly refresh cookie, and `restoreSession` exchanges it for a token
 * and the user it belongs to. Until that answer arrives, "signed out" and
 * "not asked yet" look identical — which is what `hasRestored` separates, and
 * why rendering nothing in the meantime is correct rather than lazy.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, accessToken, hasRestored } = useAuthStore();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (useAuthStore.getState().hasRestored) return;
    let cancelled = false;
    void (async () => {
      // A session established moments ago by the login form needs no restore.
      if (!useAuthStore.getState().accessToken) {
        await restoreSession(useAuthStore, API_BASE_URL);
      }
      if (!cancelled) useAuthStore.getState().markRestored();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hasRestored) return;
    const isAdmin = user?.roles.some((r) => (ADMIN_ROLES as readonly string[]).includes(r));
    if (!accessToken || !user || !isAdmin) {
      router.replace('/login');
    } else {
      setChecked(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, user, hasRestored]);

  if (!checked) return null;
  return <>{children}</>;
}
