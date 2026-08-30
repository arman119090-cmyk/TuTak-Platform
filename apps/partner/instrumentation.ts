import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Surfaces server-component/route-handler errors that Next.js's own request
// lifecycle catches before they would otherwise reach anything of ours.
export const onRequestError = Sentry.captureRequestError;
