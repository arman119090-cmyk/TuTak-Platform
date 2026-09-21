'use client';

import { Button, EmptyState } from '@tutak/design/web';

/**
 * What a page shows when a query failed (audit 21.09.2026, D13).
 *
 * Not the empty state and not zero: a 500, a 403 or a dropped connection
 * says nothing about how many users, findings or drams there are, and an
 * overview that renders "0 transactions" over an error is the one an
 * operator acts on. Every money page renders this instead, with the retry
 * next to the sentence.
 */
export function LoadFailed({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <EmptyState
      title={`Could not load ${what}`}
      message="These figures are unknown, not zero. Check the connection or try again."
      action={
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      }
    />
  );
}
