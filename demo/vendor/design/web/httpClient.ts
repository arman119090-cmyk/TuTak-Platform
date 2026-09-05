import axios, { AxiosError, AxiosInstance } from 'axios';
import type { AuthTokensDto, AuthenticatedUserDto } from '@tutak/shared-types';

/** Every response from the TuTak API arrives wrapped in this envelope. */
export interface ApiEnvelope<T> {
  data: T;
  timestamp: string;
}

/**
 * The minimal shape both dashboards' `useAuthStore` expose — just what the
 * bearer-auth and refresh-on-401 wiring below needs. The two real stores
 * differ in device-id key, persisted name, and (the partner dashboard's)
 * role-scoping helpers, so the store itself stays app-local; only this
 * interface is shared, not an implementation.
 */
export interface HttpAuthStore {
  getState(): {
    accessToken: string | null;
    deviceId: string;
    /**
     * Which session the state belongs to; bumped on every sign-in, sign-out
     * and account switch. See `SessionChangedError` below for what it guards.
     */
    sessionEpoch: number;
    setSession: (user: AuthenticatedUserDto, tokens: AuthTokensDto) => void;
    /**
     * Refuses the write and answers `false` when `expectedEpoch` is given and
     * no longer matches — i.e. the session these tokens belong to is gone.
     */
    setTokens: (tokens: Pick<AuthTokensDto, 'accessToken'>, expectedEpoch?: number) => boolean;
    clear: () => void;
  };
}

/**
 * Raised when a refresh outlives the session that started it.
 *
 * Not an authentication failure: the access token that came back is valid, it
 * just belongs to a session this browser has already closed. On a shared
 * workstation the next operator is already signed in by then, and replaying
 * the original request would make it as the previous one.
 */
export class SessionChangedError extends Error {
  constructor() {
    super('The session changed while the token refresh was in flight');
    this.name = 'SessionChangedError';
  }
}

/** What `POST /auth/refresh` answers with, unwrapped from the envelope. */
interface RefreshResponse {
  data: { tokens: AuthTokensDto; user?: AuthenticatedUserDto };
}

/**
 * Rebuilds a session from the httpOnly refresh cookie alone.
 *
 * This is what replaced keeping the access token in `localStorage`. Nothing
 * about the session survives a reload in storage any more, so on boot the app
 * asks the API whether the browser still holds a valid refresh cookie; the
 * answer carries both a fresh access token and the user it belongs to.
 *
 * Returns `false` rather than throwing on the ordinary case — no cookie, or an
 * expired one — because "not signed in" is not an error, it is the answer.
 *
 * Note the deployment requirement this creates: the cookie must actually
 * reach the API. With `SameSite=Strict` (the default) that means the
 * dashboards and the API share a registrable domain. See
 * `apps/api/src/modules/auth/refresh-cookie.ts` for the setting that covers
 * the deployments where they cannot.
 */
export async function restoreSession(
  authStore: HttpAuthStore,
  apiBaseUrl: string,
): Promise<boolean> {
  const { deviceId, setSession, setTokens } = authStore.getState();
  try {
    const { data } = await axios.post<RefreshResponse>(
      `${apiBaseUrl}/auth/refresh`,
      { deviceId },
      { withCredentials: true },
    );
    if (data.data.user) {
      setSession(data.data.user, data.data.tokens);
    } else {
      // An older API that answers with tokens only. The token is usable, but
      // without the user the gate cannot decide what may render, so this is
      // reported as "no session" rather than half a one.
      setTokens(data.data.tokens);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Builds the axios client both web dashboards share: a bearer-auth
 * interceptor reading the access token from `authStore`, and a refresh-on-401
 * retry that exchanges the httpOnly refresh cookie for a new access token
 * exactly once before giving up. `admin` and `partner` were byte-identical
 * copies of this file before extraction — this is that wiring, parameterized
 * by each app's own store and API base URL instead of duplicated.
 */
export function createHttpClient(authStore: HttpAuthStore, apiBaseUrl: string): AxiosInstance {
  const httpClient = axios.create({
    baseURL: apiBaseUrl,
    timeout: 15_000,
    // Carries the httpOnly refresh cookie to /auth/refresh.
    withCredentials: true,
  });

  httpClient.interceptors.request.use((config) => {
    const { accessToken } = authStore.getState();
    if (accessToken) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }
    return config;
  });

  /**
   * The in-flight refresh, tagged with the session that started it, so a 401
   * raised by a *new* session can never adopt the previous session's refresh.
   */
  let refreshInFlight: { epoch: number; promise: Promise<AuthTokensDto> } | null = null;

  /**
   * The refresh token is never in JavaScript's hands — the browser attaches it
   * as an httpOnly cookie, so this request carries only the device id.
   */
  async function refreshTokens(epoch: number): Promise<AuthTokensDto> {
    const { deviceId, setTokens, clear } = authStore.getState();
    let data: { data: { tokens: AuthTokensDto } };
    try {
      ({ data } = await axios.post<{ data: { tokens: AuthTokensDto } }>(
        `${apiBaseUrl}/auth/refresh`,
        { deviceId },
        { withCredentials: true },
      ));
    } catch (err) {
      // Only the session that owns this refresh may be closed by its failure.
      if (authStore.getState().sessionEpoch === epoch) {
        clear();
      }
      throw err;
    }
    if (!setTokens(data.data.tokens, epoch)) {
      throw new SessionChangedError();
    }
    return data.data.tokens;
  }

  httpClient.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const originalRequest = error.config as (typeof error.config & { _retry?: boolean }) | undefined;
      if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
        originalRequest._retry = true;
        const epoch = authStore.getState().sessionEpoch;
        try {
          if (!refreshInFlight || refreshInFlight.epoch !== epoch) {
            refreshInFlight = { epoch, promise: refreshTokens(epoch) };
          }
          const tokens = await refreshInFlight.promise;
          if (refreshInFlight?.epoch === epoch) {
            refreshInFlight = null;
          }
          // The await above is the window this guard exists for: a sign-out
          // during it makes these tokens somebody else's.
          if (authStore.getState().sessionEpoch !== epoch) {
            return Promise.reject(new SessionChangedError());
          }
          originalRequest.headers = originalRequest.headers ?? {};
          originalRequest.headers.Authorization = `Bearer ${tokens.accessToken}`;
          return httpClient.request(originalRequest);
        } catch (refreshError) {
          if (refreshInFlight?.epoch === epoch) {
            refreshInFlight = null;
          }
          return Promise.reject(refreshError);
        }
      }
      return Promise.reject(error);
    },
  );

  return httpClient;
}
