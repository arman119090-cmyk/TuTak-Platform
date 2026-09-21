import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';

export const SESSION_COOKIE = 'ornata_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;

export type SessionPayload = {
  sub: string;
  email: string;
  role: 'CUSTOMER' | 'ADMIN';
  name: string;
};

const secretKey = (): Uint8Array => {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('AUTH_SECRET is missing or too short — refusing to sign sessions.');
  }
  if (process.env.NODE_ENV === 'production' && secret.includes('demo-only-secret')) {
    throw new Error('AUTH_SECRET still holds the demo value — set a real secret in production.');
  }
  return new TextEncoder().encode(secret);
};

export const signSession = async (payload: SessionPayload): Promise<string> =>
  new SignJWT({ email: payload.email, role: payload.role, name: payload.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());

export const verifySession = async (token: string): Promise<SessionPayload | null> => {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'] });
    if (!payload.sub || (payload.role !== 'CUSTOMER' && payload.role !== 'ADMIN')) return null;
    return {
      sub: payload.sub,
      email: String(payload.email ?? ''),
      role: payload.role,
      name: String(payload.name ?? ''),
    };
  } catch {
    return null;
  }
};

export const setSessionCookie = async (token: string): Promise<void> => {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
};

export const clearSessionCookie = async (): Promise<void> => {
  const store = await cookies();
  store.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
};

/** Current session, or null for a guest. Never throws on a bad cookie. */
export const getSession = async (): Promise<SessionPayload | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
};
