import axios, { AxiosError } from 'axios';
import Constants from 'expo-constants';
import type { AuthResponseDto, AuthTokensDto } from '@tutak/shared-types';
import { useAuthStore } from '../stores/authStore';
import { resolveApiBaseUrl } from './apiBaseUrl';
import { mockAdapter } from './mockAdapter';
import { shouldUseMocks } from './mockGate';

const API_BASE_URL = resolveApiBaseUrl(
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ?? 'http://localhost:4000/v1',
  (Constants.expoConfig as { hostUri?: string } | null | undefined)?.hostUri,
);

/**
 * Where `/health` lives, which is not under the version prefix.
 *
 * The API serves its health probe version-neutral on purpose: an
 * orchestrator checks a fixed path, and `/v1/health` would break the moment
 * the API version moved. So `httpClient.get('/health')` — which axios
 * resolves against the `.../v1` base — asks for `/v1/health` and gets a 404.
 *
 * That silently defeated the demo-mode check: the button that appears only
 * when the server says it is a demonstration would never have appeared,
 * because the question was being asked at an address that does not exist.
 * Caught by a deployment team pointing out that their health route had no
 * `/v1` either.
 */
export const healthUrl = API_BASE_URL.replace(/\/v\d+\/?$/, '') + '/health';

/**
 * Whether this build talks to memory instead of to a server.
 *
 * Two independent flags have to agree, and `app.config.js` cannot produce
 * either of them. See `mockGate.ts` for why one boolean was not enough
 * distance between a demonstration and an authentication bypass.
 */
const USE_MOCKS = shouldUseMocks(Constants.expoConfig?.extra);

export const httpClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15_000,
  // The transport is the only thing swapped. Every interceptor below, every
  // envelope, every DTO and every screen above is the same code that talks to
  // the real API — which is the point, because a demonstration is used to
  // decide whether the product is right.
  ...(USE_MOCKS ? { adapter: mockAdapter } : {}),
});

httpClient.interceptors.request.use((config) => {
  const { accessToken } = useAuthStore.getState();
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

/**
 * Raised when a refresh outlives the session that started it.
 *
 * Not an authentication failure: the tokens the server sent back are valid.
 * They are simply no longer ours to use, because the customer signed out (or
 * signed in as somebody else) while the request was in the air. The original
 * request must not be replayed with them, and the current session — which may
 * belong to a different person — must not be touched.
 */
export class SessionChangedError extends Error {
  constructor() {
    super('The session changed while the token refresh was in flight');
    this.name = 'SessionChangedError';
  }
}

/**
 * The in-flight refresh, tagged with the session that started it.
 *
 * Tagged rather than bare, because a single-flight promise shared across a
 * session boundary is itself a leak: a 401 raised by the *new* session would
 * otherwise await the old session's refresh and replay itself with the
 * previous account's access token.
 */
let refreshInFlight: { epoch: number; promise: Promise<AuthTokensDto> } | null = null;

async function refreshTokens(epoch: number): Promise<AuthTokensDto> {
  const { refreshToken, deviceId, setTokens, clear } = useAuthStore.getState();
  if (!refreshToken) {
    throw new Error('No refresh token available');
  }
  let data: { data: { tokens: AuthTokensDto } };
  try {
    ({ data } = await axios.post<{ data: { tokens: AuthTokensDto } }>(
      `${API_BASE_URL}/auth/refresh`,
      { refreshToken, deviceId },
    ));
  } catch (err) {
    // Only the session that owns this refresh may be closed by its failure.
    // Clearing unconditionally would sign out whoever is signed in now — the
    // failure says nothing about their session.
    if (useAuthStore.getState().sessionEpoch === epoch) {
      await clear();
    }
    throw err;
  }
  const written = await setTokens(data.data.tokens, epoch);
  if (!written) {
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
      const epoch = useAuthStore.getState().sessionEpoch;
      try {
        if (!refreshInFlight || refreshInFlight.epoch !== epoch) {
          refreshInFlight = { epoch, promise: refreshTokens(epoch) };
        }
        const tokens = await refreshInFlight.promise;
        if (refreshInFlight?.epoch === epoch) {
          refreshInFlight = null;
        }
        // The await above is the window this whole guard exists for: a logout
        // during it makes the tokens we are holding somebody else's problem.
        if (useAuthStore.getState().sessionEpoch !== epoch) {
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

export interface ApiEnvelope<T> {
  data: T;
  timestamp: string;
}

export type { AuthResponseDto };
