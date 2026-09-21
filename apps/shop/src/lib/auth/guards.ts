import { redirect } from 'next/navigation';
import { getSession, type SessionPayload } from './session';
import type { Locale } from '../i18n';

/** Server-component guard: sends guests to the sign-in page. */
export const requireUser = async (locale: Locale, returnTo?: string): Promise<SessionPayload> => {
  const session = await getSession();
  if (!session) {
    const target = returnTo ? `?next=${encodeURIComponent(returnTo)}` : '';
    redirect(`/${locale}/login${target}`);
  }
  return session;
};

/**
 * Admin guard. A customer who guesses an /admin URL is sent to the storefront
 * rather than to the login page: the panel does not advertise its existence.
 */
export const requireAdmin = async (locale: Locale): Promise<SessionPayload> => {
  const session = await getSession();
  if (!session) redirect(`/${locale}/login?next=${encodeURIComponent('/admin')}`);
  if (session.role !== 'ADMIN') redirect(`/${locale}`);
  return session;
};

/** API guard: returns the session or null; route handlers map null to 401/403. */
export const apiSession = async (): Promise<SessionPayload | null> => getSession();
