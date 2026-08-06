'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getPrimaryPartnerId, PARTNER_ROLES, useAuthStore } from '@/lib/stores/authStore';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, accessToken, hasHydrated } = useAuthStore();
  const [checked, setChecked] = useState(false);

  // Persisted state is read back explicitly, so the effect below can tell
  // "signed out" from "not read yet" instead of bouncing every reload.
  useEffect(() => {
    void useAuthStore.persist.rehydrate();
  }, []);

  useEffect(() => {
    if (!hasHydrated) return;
    const isPartner = user?.roles.some((r) => (PARTNER_ROLES as readonly string[]).includes(r));
    const partnerId = getPrimaryPartnerId(user);
    if (!accessToken || !user || !isPartner || !partnerId) {
      router.replace('/login');
    } else {
      setChecked(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, user, hasHydrated]);

  if (!checked) return null;
  return <>{children}</>;
}
