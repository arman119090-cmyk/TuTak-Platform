'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';

export const BannerToggle = ({ id, isActive }: { id: string; isActive: boolean }) => {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    setBusy(true);
    await fetch('/api/admin/banners', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, isActive: !isActive }),
    });
    setBusy(false);
    router.refresh();
  };

  return (
    <Button variant={isActive ? 'secondary' : 'primary'} size="sm" onClick={toggle} disabled={busy}>
      {isActive ? 'Отключить' : 'Включить'}
    </Button>
  );
};
