'use client';

import axios, { AxiosError } from 'axios';
import type { AuthTokensDto } from '@tutak/shared-types';
import { useAuthStore } from './stores/authStore';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/v1';

// withCredentials is what carries the httpOnly refresh cookie to /auth/refresh.
export const httpClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15_000,
  withCredentials: true,
});

httpClient.interceptors.request.use((config) => {
  const { accessToken } = useAuthStore.getState();
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
  const { deviceId, setTokens, clear } = useAuthStore.getState();
  try {
    const { data } = await axios.post<{ data: { tokens: AuthTokensDto } }>(
      `${API_BASE_URL}/auth/refresh`,
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

export interface ApiEnvelope<T> {
  data: T;
  timestamp: string;
}
