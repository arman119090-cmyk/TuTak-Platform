import axios from 'axios';

/**
 * What kind of failure a request produced, in the terms a screen has to
 * react to.
 *
 * - `network`: no response at all — offline, DNS, the proxy, a timeout. The
 *   request may or may not have reached the server, so nothing about its
 *   outcome may be assumed either way: re-read the state before acting again.
 * - `state`: the server answered and refused because the thing changed
 *   underneath (400/409/404/410) — the purchase expired, someone else
 *   decided first. The server's own sentence says what happened.
 * - `auth`: 401/403 — the session ended or the role does not allow it.
 * - `server`: 5xx — the server is there and broken.
 */
export type ApiFailureKind = 'network' | 'state' | 'auth' | 'server';

export interface ApiFailure {
  kind: ApiFailureKind;
  status: number | null;
  /** The server's own message where it gave one; otherwise a generic line. */
  message: string;
}

export function describeApiFailure(error: unknown): ApiFailure {
  if (!axios.isAxiosError(error)) {
    return { kind: 'server', status: null, message: 'Something went wrong.' };
  }
  const status = error.response?.status ?? null;
  const body = error.response?.data as { message?: string | string[] } | undefined;
  const serverMessage = Array.isArray(body?.message) ? body?.message.join(' ') : body?.message;
  if (status === null) {
    return {
      kind: 'network',
      status,
      message: 'Could not reach the server. The request may or may not have gone through.',
    };
  }
  if (status === 401 || status === 403) {
    return { kind: 'auth', status, message: serverMessage ?? 'You are not allowed to do this.' };
  }
  if (status >= 500) {
    return { kind: 'server', status, message: serverMessage ?? 'The server had a problem.' };
  }
  return { kind: 'state', status, message: serverMessage ?? 'This is no longer possible.' };
}
