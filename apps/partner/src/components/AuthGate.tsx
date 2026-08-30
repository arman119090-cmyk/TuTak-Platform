'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { restoreSession } from '@tutak/design/web';
import { API_BASE_URL } from '@/lib/httpClient';
import { getPrimaryPartnerId, PARTNER_ROLES, useAuthStore } from '@/lib/stores/authStore';

/**
 * See the admin dashboard's copy for the reasoning: the access token is no
 * longer persisted, so a fresh page load rebuilds the session from the
 * httpOnly refresh cookie before it can decide anything.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, accessToken, hasRestored } = useAuthStore();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (useAuthStore.getState().hasRestored) return;
    let cancelled = false;
    void (async () => {
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
    const isPartner = user?.roles.some((r) => (PARTNER_ROLES as readonly string[]).includes(r));
    const partnerId = getPrimaryPartnerId(user);
    if (!accessToken || !user || !isPartner || !partnerId) {
      router.replace('/login');
    } else {
      setChecked(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, user, hasRestored]);

  if (!checked) return null;
  return <>{children}</>;
}
