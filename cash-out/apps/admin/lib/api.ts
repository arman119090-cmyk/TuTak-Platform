import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { AdminPermission, AdminRole } from '@cashout/contracts';

export const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000';
export const SESSION_COOKIE = 'cashout_admin_session';

export class AdminApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AdminApiError';
  }
}

/**
 * Calls the API as the signed-in operator.
 *
 * The session token lives in an httpOnly, SameSite=Lax cookie and is attached
 * here, on the server. It is never sent to the browser as a value and never
 * touches client JavaScript, so an XSS in a dashboard chart cannot walk away
 * with an operator's session.
 */
export async function adminFetch<T>(
  path: string,
  init: RequestInit & { parse?: boolean } = {},
): Promise<T> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) redirect('/sign-in');

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
    // Operational data: never served from a cache.
    cache: 'no-store',
  });

  if (response.status === 401) redirect('/sign-in');

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : {};

  if (!response.ok) {
    const body = payload as { code?: string; message?: string };
    throw new AdminApiError(
      body.code ?? 'INTERNAL_ERROR',
      body.message ?? 'Request failed',
      response.status,
    );
  }

  return payload as T;
}

export interface AdminIdentity {
  id: string;
  email: string;
  role: AdminRole;
  permissions: AdminPermission[];
}

export async function currentAdmin(): Promise<AdminIdentity> {
  return adminFetch<AdminIdentity>('/v1/admin/me');
}

export async function signInRequest(
  email: string,
  password: string,
  totpCode?: string,
): Promise<{ token: string; expiresIn: number }> {
  const response = await fetch(`${API_BASE_URL}/v1/admin/auth/sign-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, ...(totpCode ? { totpCode } : {}) }),
    cache: 'no-store',
  });

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!response.ok) {
    throw new AdminApiError(
      String(payload.code ?? 'INTERNAL_ERROR'),
      String(payload.message ?? 'Sign-in failed'),
      response.status,
    );
  }

  return payload as unknown as { token: string; expiresIn: number };
}
