import { useCallback, useEffect, useState } from 'react';
import type { BalanceDto } from '@cashout/contracts';
import { endpoints } from '../api/endpoints';
import { useAuth } from '../auth/auth-context';

export interface BalanceState {
  balance: BalanceDto | null;
  loading: boolean;
  error: unknown;
  /** The display read: the server may answer from a short-lived cache. */
  refresh: () => Promise<void>;
  /** A read straight from the fleet. What every withdraw screen calls first. */
  refreshFresh: () => Promise<BalanceDto | null>;
}

/**
 * The balance on the phone is a copy for display. The server's answer carries
 * `fresh`, and nothing money-related runs on this side while it is false: the
 * withdraw button is disabled, and the amount screen asks for a fresh read
 * before it lets the driver type.
 */
export function useBalance(options: { immediate?: boolean } = {}): BalanceState {
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

  const refreshFresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await endpoints.freshBalance(api);
      setBalance(next);
      setError(null);
      return next;
    } catch (caught) {
      setError(caught);
      return null;
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (options.immediate === false) return;
    void refresh();
  }, [refresh, options.immediate]);

  return { balance, loading, error, refresh, refreshFresh };
}
