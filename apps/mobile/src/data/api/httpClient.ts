import axios, { AxiosError } from 'axios';
import Constants from 'expo-constants';
import type { AuthResponseDto, AuthTokensDto } from '@tutak/shared-types';
import { useAuthStore } from '../stores/authStore';
import { resolveApiBaseUrl } from './apiBaseUrl';

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

export const httpClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15_000,
});

httpClient.interceptors.request.use((config) => {
  const { accessToken } = useAuthStore.getState();
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

let refreshPromise: Promise<AuthTokensDto> | null = null;

async function refreshTokens(): Promise<AuthTokensDto> {
  const { refreshToken, deviceId, setTokens, clear } = useAuthStore.getState();
  if (!refreshToken) {
    throw new Error('No refresh token available');
  }
  try {
    const { data } = await axios.post<{ data: { tokens: AuthTokensDto } }>(
      `${API_BASE_URL}/auth/refresh`,
      { refreshToken, deviceId },
    );
    await setTokens(data.data.tokens);
    return data.data.tokens;
  } catch (err) {
    await clear();
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

export interface ApiEnvelope<T> {
  data: T;
  timestamp: string;
}

export type { AuthResponseDto };
