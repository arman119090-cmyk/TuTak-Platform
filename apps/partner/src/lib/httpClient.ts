'use client';

import { createHttpClient } from '@tutak/design/web';
import { useAuthStore } from './stores/authStore';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/v1';

export const httpClient = createHttpClient(useAuthStore, API_BASE_URL);

export type { ApiEnvelope } from '@tutak/design/web';
