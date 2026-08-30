'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

/**
 * Next.js replaces the whole root layout with this component when an error
 * escapes every nested error boundary — so it renders its own <html>/<body>.
 * A no-op when NEXT_PUBLIC_SENTRY_DSN is unset, same as everywhere else.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <p>Something went wrong.</p>
      </body>
    </html>
  );
}
