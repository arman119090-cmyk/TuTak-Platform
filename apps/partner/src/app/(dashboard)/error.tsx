'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

/**
 * The one route-level boundary this dashboard needs.
 *
 * Without it, `global-error.tsx` is the only thing between a render error and
 * the operator: Next replaces the entire document with it — root layout,
 * navigation, session and all — so one failing table takes the whole
 * dashboard with it, and the way back is a reload. Placed on the
 * `(dashboard)` segment, an error is contained to the content area instead,
 * the shell stays on screen, and the operator can walk to another section
 * without losing what they were doing.
 *
 * Deliberately one boundary rather than one per route directory. A boundary
 * in every folder isolates failures that are already isolated and costs a
 * file each; the segment boundary is where the difference between "this page
 * broke" and "the product broke" actually lives.
 *
 * `global-error.tsx` stays as the last resort for a failure in the root
 * layout itself, which this cannot catch.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Same reporting as the global boundary, and for the same reason: a
    // no-op without a DSN, and the operator's only chance of us finding out.
    Sentry.captureException(error);
  }, [error]);

  return (
    <div role="alert" className="rounded-lg border border-line bg-surface p-6">
      <h2 className="text-[15px] font-semibold text-ink">This section could not load</h2>
      <p className="mt-1 text-[13px] text-muted">
        The rest of the dashboard is unaffected. Try again, or pick another section.
      </p>
      {error.digest && (
        <p className="mt-2 font-mono text-[11px] text-faint">Reference: {error.digest}</p>
      )}
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-md border border-line px-3 py-2 text-[13px] font-medium text-ink"
      >
        Try again
      </button>
    </div>
  );
}
