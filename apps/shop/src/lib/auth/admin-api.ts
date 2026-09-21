import { NextResponse } from 'next/server';
import { apiSession } from './guards';
import type { SessionPayload } from './session';

/**
 * Guard for admin API routes.
 *
 * Returns either the admin session or the response to send back. Every
 * /api/admin route starts with this — the panel's UI being hidden is not a
 * security control, the check on the server is.
 */
export const requireAdminApi = async (): Promise<
  { ok: true; session: SessionPayload } | { ok: false; response: Response }
> => {
  const session = await apiSession();
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  }
  if (session.role !== 'ADMIN') {
    return { ok: false, response: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
  }
  return { ok: true, session };
};
