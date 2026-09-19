import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { WithdrawalDto } from '@cashout/contracts';
import { endpoints } from '../api/endpoints';
import { useAuth } from '../auth/auth-context';

const TERMINAL: ReadonlyArray<WithdrawalDto['status']> = ['SENT', 'FAILED', 'UNDER_REVIEW'];

/**
 * Polls one withdrawal until it stops moving.
 *
 * Polling, not a socket: the processing window is a minute or two, the payload
 * is tiny, and a driver on a patchy mobile connection reconnects a poll far
 * more reliably than a socket. The interval backs off, polling pauses while the
 * app is in the background, and it stops as soon as the status is final — the
 * screen tells the driver they can close the app, and it must mean it.
 */
export function useWithdrawalStatus(withdrawalId: string | undefined) {
  const { api } = useAuth();
  const [withdrawal, setWithdrawal] = useState<WithdrawalDto | null>(null);
  const [error, setError] = useState<unknown>(null);
  const attempts = useRef(0);

  useEffect(() => {
    if (!withdrawalId) return undefined;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      if (cancelled) return;
      if (AppState.currentState !== 'active') {
        timer = setTimeout(poll, 3000);
        return;
      }
      try {
        const next = await endpoints.withdrawal(api, withdrawalId);
        if (cancelled) return;
        setWithdrawal(next);
        setError(null);
        if (TERMINAL.includes(next.status)) return;
      } catch (caught) {
        if (cancelled) return;
        setError(caught);
      }
      attempts.current += 1;
      // 1s, 1s, 2s, 3s, 5s… capped at 8s.
      const delay = Math.min(8000, 1000 * Math.ceil(attempts.current ** 1.4));
      timer = setTimeout(poll, delay);
    };

    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [api, withdrawalId]);

  return { withdrawal, error };
}
