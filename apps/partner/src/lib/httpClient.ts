'use client';

import { createHttpClient } from '@tutak/design/web';
import { useAuthStore } from './stores/authStore';
// @ts-expect-error — plain ESM with JSDoc types; see that file's header.
import { LOCAL_API_BASE_URL, STAGING_API_BASE_URL } from '../../api-base-url.mjs';

type RuntimeConfig = { apiBaseUrl?: string };

// "Configured" means somebody actually set a value — nothing more.
//
// This used to also reject the exact string `http://localhost:4000/v1`, on the
// theory that it could only be the Dockerfile's ARG default leaking in. It
// could equally be a deployment that genuinely wants localhost, and treating
// that as unset is what put the CSP computed in next.config.ts on a different
// API from the one this client calls. The Dockerfile's ARG now defaults to
// empty, so "unset" says so; see ../../api-base-url.mjs, which the config half
// of this decision uses.
const UNCONFIGURED_DEFAULT = LOCAL_API_BASE_URL;

const isConfigured = (value: string | undefined | null): value is string => Boolean(value);

const runtimeApiBaseUrl =
  typeof window === 'undefined'
    ? undefined
    : (window as Window & { __TUTAK_RUNTIME_CONFIG__?: RuntimeConfig }).__TUTAK_RUNTIME_CONFIG__
        ?.apiBaseUrl;

const stagingFallback =
  typeof window !== 'undefined' && window.location.hostname === 'tutak-staging-partner.onrender.com'
    ? STAGING_API_BASE_URL
    : UNCONFIGURED_DEFAULT;

export const API_BASE_URL = isConfigured(runtimeApiBaseUrl)
  ? runtimeApiBaseUrl
  : isConfigured(process.env.NEXT_PUBLIC_API_BASE_URL)
    ? process.env.NEXT_PUBLIC_API_BASE_URL
    : stagingFallback;

export const httpClient = createHttpClient(useAuthStore, API_BASE_URL);

export type { ApiEnvelope } from '@tutak/design/web';
