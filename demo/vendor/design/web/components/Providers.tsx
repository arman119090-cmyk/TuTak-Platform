'use client';

import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { registerSessionCacheReset } from '../sessionCache';

/** The one React Query client both dashboards mount their tree under. */
export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } }),
  );

  /**
   * This client outlives every session in the tab, and its keys — `['users']`,
   * `['payouts']`, `['ledger']` — are the same for whoever is signed in. Left
   * alone across a sign-out it renders the previous operator's data to the
   * next one, from cache, before any request is made.
   */
  useEffect(() => registerSessionCacheReset(() => client.clear()), [client]);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
