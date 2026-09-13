import { QueryClient } from '@tanstack/react-query';
import { useAuthStore } from './stores/authStore';

/**
 * `mutations.retry: 0` is the library default and is stated here anyway.
 *
 * A retried mutation is a second purchase, a second bonus accrual and a
 * second settlement obligation — a timeout means the request may well have
 * been received and only the answer lost. That must stay a person's decision,
 * so the value is written down where anyone changing retry policy will see it
 * rather than left to a default that could move in a future major version.
 * `src/data/network/networkFailure.ts` holds the same rule for anything that
 * retries outside Query.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
    mutations: { retry: 0 },
  },
});

/**
 * The cache is emptied on every session change.
 *
 * It has to be, because the keys do not carry a user: `['me']`, `['wallet']`,
 * `['transactions']`, `['referrals']` are the same strings for everyone who
 * signs in on this phone. Nothing evicts them at sign-out on its own —
 * `gcTime` is five minutes of inactivity, and `staleTime` means a query can
 * render from cache without asking the server at all. So the next person to
 * sign in on a shared, borrowed or resold handset would open the app to the
 * previous person's balance and purchase history.
 *
 * Keyed on `sessionEpoch` rather than on `user` being null, so that signing
 * straight into another account — no sign-out in between — clears it too, and
 * so that a token refresh within one session does not (that would blank every
 * screen mid-use every fifteen minutes).
 *
 * Subscribed at module scope: this file is imported by `App.tsx` before any
 * screen renders, and the subscription must outlive every component that
 * could be unmounted by the very sign-out it is watching for.
 */
let lastSessionEpoch = useAuthStore.getState().sessionEpoch;
useAuthStore.subscribe((state) => {
  if (state.sessionEpoch !== lastSessionEpoch) {
    lastSessionEpoch = state.sessionEpoch;
    queryClient.clear();
  }
});
