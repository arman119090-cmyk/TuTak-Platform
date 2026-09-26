/**
 * The hook that empties client-side caches when the session changes.
 *
 * Both dashboards keep one React Query client alive for the lifetime of the
 * tab, and every cached key is user-specific without saying so: `['users']`,
 * `['payouts']`, `['ledger']` are the same strings for whoever is signed in.
 * A sign-out that leaves that cache in place hands the next person to use the
 * browser the previous operator's data — rendered from cache, before any
 * request goes out, and with `staleTime` sometimes without one going out at
 * all.
 *
 * The provider that owns the cache registers here; the auth store calls
 * `resetSessionCaches` as it changes session. Neither imports the other: the
 * store belongs to each app, the provider is shared, and a direct dependency
 * either way would be a cycle.
 */

type Reset = () => void;

const resets = new Set<Reset>();

/**
 * Registers a cache to be emptied on every session change. Returns the
 * unregister function, so a provider that unmounts does not leave a reset
 * behind pointing at a dead cache.
 */
export function registerSessionCacheReset(reset: Reset): () => void {
  resets.add(reset);
  return () => {
    resets.delete(reset);
  };
}

/**
 * Empties every registered cache. Called by the auth stores on sign-in,
 * sign-out and account switch — not on token refresh, which is the same
 * session and would blank the screen mid-use every fifteen minutes.
 *
 * A throwing reset must not stop the others: this runs on the sign-out path,
 * where the caller has already decided the session is over.
 */
export function resetSessionCaches(): void {
  for (const reset of resets) {
    try {
      reset();
    } catch {
      // A cache that cannot be cleared is not a reason to abandon the rest.
    }
  }
}
