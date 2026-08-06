'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getPrimaryPartnerId, PARTNER_ROLES, useAuthStore } from '@/lib/stores/authStore';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, accessToken } = useAuthStore();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const isPartner = user?.roles.some((r) => (PARTNER_ROLES as readonly string[]).includes(r));
    const partnerId = getPrimaryPartnerId(user);
    if (!accessToken || !user || !isPartner || !partnerId) {
      router.replace('/login');
    } else {
      setChecked(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, user]);

  if (!checked) return null;
  return <>{children}</>;
}
