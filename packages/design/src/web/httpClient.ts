import axios, { AxiosError, AxiosInstance } from 'axios';
import type { AuthTokensDto } from '@tutak/shared-types';

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
    setTokens: (tokens: Pick<AuthTokensDto, 'accessToken'>) => void;
    clear: () => void;
  };
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

  let refreshPromise: Promise<AuthTokensDto> | null = null;

  /**
   * The refresh token is never in JavaScript's hands — the browser attaches it
   * as an httpOnly cookie, so this request carries only the device id.
   */
  async function refreshTokens(): Promise<AuthTokensDto> {
    const { deviceId, setTokens, clear } = authStore.getState();
    try {
      const { data } = await axios.post<{ data: { tokens: AuthTokensDto } }>(
        `${apiBaseUrl}/auth/refresh`,
        { deviceId },
        { withCredentials: true },
      );
      setTokens(data.data.tokens);
      return data.data.tokens;
    } catch (err) {
      clear();
      throw err;
    }
  }

  httpClient.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const originalRequest = error.config as (typeof error.config & { _retry?: boolean }) | undefined;
      if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
        originalRequest._retry = true;
        try {
          refreshPromise ??= refreshTokens();
          const tokens = await refreshPromise;
          refreshPromise = null;
          originalRequest.headers = originalRequest.headers ?? {};
          originalRequest.headers.Authorization = `Bearer ${tokens.accessToken}`;
          return httpClient.request(originalRequest);
        } catch (refreshError) {
          refreshPromise = null;
          return Promise.reject(refreshError);
        }
      }
      return Promise.reject(error);
    },
  );

  return httpClient;
}
