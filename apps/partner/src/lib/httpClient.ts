'use client';

import { createHttpClient } from '@tutak/design/web';
import { useAuthStore } from './stores/authStore';

type RuntimeConfig = { apiBaseUrl?: string };

// The Dockerfile declares `ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/v1`,
// so when Render never forwards its dashboard value as a build arg, the image
// still bakes in this exact, non-empty string — never undefined. A plain
// `value || fallback` check can't tell "genuinely configured" apart from
// "silently defaulted", so both reads below are checked against this literal
// instead of mere truthiness.
const UNCONFIGURED_DEFAULT = 'http://localhost:4000/v1';

const isConfigured = (value: string | undefined | null): value is string =>
  Boolean(value) && value !== UNCONFIGURED_DEFAULT;

const runtimeApiBaseUrl =
  typeof window === 'undefined'
    ? undefined
    : (window as Window & { __TUTAK_RUNTIME_CONFIG__?: RuntimeConfig }).__TUTAK_RUNTIME_CONFIG__
        ?.apiBaseUrl;

const stagingFallback =
  typeof window !== 'undefined' && window.location.hostname === 'tutak-staging-partner.onrender.com'
    ? 'https://tutak-staging-api.onrender.com/v1'
    : UNCONFIGURED_DEFAULT;

export const API_BASE_URL = isConfigured(runtimeApiBaseUrl)
  ? runtimeApiBaseUrl
  : isConfigured(process.env.NEXT_PUBLIC_API_BASE_URL)
    ? process.env.NEXT_PUBLIC_API_BASE_URL
    : stagingFallback;

export const httpClient = createHttpClient(useAuthStore, API_BASE_URL);

export type { ApiEnvelope } from '@tutak/design/web';
