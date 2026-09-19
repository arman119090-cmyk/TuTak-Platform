import { useCallback, useEffect, useState } from 'react';
import type { BalanceDto } from '@cashout/contracts';
import { endpoints } from '../api/endpoints';
import { useAuth } from '../auth/auth-context';

export interface BalanceState {
  balance: BalanceDto | null;
  loading: boolean;
  error: unknown;
  refresh: () => Promise<void>;
}

export function useBalance(): BalanceState {
  const { api } = useAuth();
  const [balance, setBalance] = useState<BalanceDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setBalance(await endpoints.balance(api));
      setError(null);
    } catch (caught) {
      setError(caught);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { balance, loading, error, refresh };
}
