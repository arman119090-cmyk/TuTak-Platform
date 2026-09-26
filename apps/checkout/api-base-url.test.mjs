import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiBaseUrlNotConfiguredError, LOCAL_API_BASE_URL, resolveApiBaseUrl } from './api-base-url.mjs';

test('a configured API is always honoured', () => {
  assert.equal(resolveApiBaseUrl({ configured: 'https://api.example/v1', isDevelopment: false }), 'https://api.example/v1');
});

test('local development falls back to the local API', () => {
  assert.equal(resolveApiBaseUrl({ configured: '', isDevelopment: true }), LOCAL_API_BASE_URL);
});

test('a deployed build that was told nothing fails instead of guessing', () => {
  assert.throws(() => resolveApiBaseUrl({ configured: undefined, isDevelopment: false }), ApiBaseUrlNotConfiguredError);
});
