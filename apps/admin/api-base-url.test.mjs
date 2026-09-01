import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
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

test('a production build with nothing configured targets the staging API', () => {
  // Render's case: `NEXT_PUBLIC_API_BASE_URL` is a runtime variable there and
  // never reaches the image as a build argument.
  assert.equal(resolveApiBaseUrl({ configured: '', isDevelopment: false }), STAGING_API_BASE_URL);
  assert.equal(
    resolveApiBaseUrl({ configured: undefined, isDevelopment: false }),
    STAGING_API_BASE_URL,
  );
});

test('a development build with nothing configured targets the local API', () => {
  assert.equal(resolveApiBaseUrl({ configured: '', isDevelopment: true }), LOCAL_API_BASE_URL);
});
