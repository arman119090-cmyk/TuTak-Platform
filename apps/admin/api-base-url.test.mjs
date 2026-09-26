import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ApiBaseUrlNotConfiguredError,
  LOCAL_API_BASE_URL,
  STAGING_API_BASE_URL,
  resolveApiBaseUrl,
} from './api-base-url.mjs';

/**
 * The regression this file exists for.
 *
 * A production build that was explicitly told to talk to localhost used to be
 * treated as unconfigured, and got a Content-Security-Policy naming the Render
 * staging API instead. The dashboard then called the address it had been given
 * and the browser refused the request — every end-to-end login sat on /login
 * for a fortnight without a single failing unit test.
 */
test('an explicitly configured URL is honoured, localhost included', () => {
  assert.equal(
    resolveApiBaseUrl({ configured: LOCAL_API_BASE_URL, isDevelopment: false }),
    LOCAL_API_BASE_URL,
  );
  assert.equal(
    resolveApiBaseUrl({ configured: 'https://api.example.test/v1', isDevelopment: false }),
    'https://api.example.test/v1',
  );
});

test('a deployed build with nothing configured refuses to build', () => {
  // The whole point. This used to fall back to the staging API, which was the
  // right answer for one deployment and a silent wrong one for every other —
  // a production image would have shipped a policy allowing only staging, and
  // the first symptom would have been customers unable to sign in.
  assert.throws(
    () => resolveApiBaseUrl({ configured: '', isDevelopment: false }),
    ApiBaseUrlNotConfiguredError,
  );
  assert.throws(
    () => resolveApiBaseUrl({ configured: undefined, isDevelopment: false }),
    ApiBaseUrlNotConfiguredError,
  );
});

test('the staging API is still a named constant, for the client-side hostname check', () => {
  // Exported for httpClient.ts, never as a default: nothing resolves to it
  // without being told to.
  assert.match(STAGING_API_BASE_URL, /^https:\/\/tutak-staging-api\./);
  assert.equal(
    resolveApiBaseUrl({ configured: STAGING_API_BASE_URL, isDevelopment: false }),
    STAGING_API_BASE_URL,
  );
});

test('a development build with nothing configured targets the local API', () => {
  assert.equal(resolveApiBaseUrl({ configured: '', isDevelopment: true }), LOCAL_API_BASE_URL);
});
