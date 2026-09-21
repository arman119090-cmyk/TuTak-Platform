import type { QueryClient } from '@tanstack/react-query';

/**
 * Every query that shows the customer money or bonus.
 *
 * A confirmed purchase, a cancellation and a refund each change all of them
 * at once: the balance, the ledger behind it, the lots that expire, and the
 * history. Invalidating only `['wallet']` — which is what the status screen
 * used to do — left the ledger and the lots showing the world as it was
 * before the purchase until some unrelated refetch happened to fix them.
 */
export const MONEY_QUERY_KEYS: readonly (readonly string[])[] = [
  ['wallet'],
  ['wallet-ledger'],
  ['wallet-lots'],
  ['transactions'],
];

export function invalidateMoney(queryClient: QueryClient): void {
  for (const key of MONEY_QUERY_KEYS) {
    void queryClient.invalidateQueries({ queryKey: [...key] });
  }
}
