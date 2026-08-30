'use client';

import { createHttpClient } from '@tutak/design/web';
import { useAuthStore } from './stores/authStore';

type RuntimeConfig = { apiBaseUrl?: string };

const runtimeApiBaseUrl =
  typeof window === 'undefined'
    ? undefined
    : (window as Window & { __TUTAK_RUNTIME_CONFIG__?: RuntimeConfig }).__TUTAK_RUNTIME_CONFIG__
        ?.apiBaseUrl;

const stagingFallback =
  typeof window !== 'undefined' && window.location.hostname === 'tutak-staging-admin.onrender.com'
    ? 'https://tutak-staging-api.onrender.com/v1'
    : 'http://localhost:4000/v1';

const API_BASE_URL = runtimeApiBaseUrl || process.env.NEXT_PUBLIC_API_BASE_URL || stagingFallback;

export const httpClient = createHttpClient(useAuthStore, API_BASE_URL);

export type { ApiEnvelope } from '@tutak/design/web';
