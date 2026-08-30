import assert from 'node:assert/strict';
import test from 'node:test';
import { contentSecurityPolicy } from './security-headers.mjs';

const api = 'https://api.tutak.am/v1';
const dsn = 'https://abc123@o4500.ingest.sentry.io/45001';

const directive = (policy, name) =>
  policy
    .split('; ')
    .find((part) => part.startsWith(`${name} `))
    ?.slice(name.length + 1);

test('connect-src names the API and, when configured, the error reporter', () => {
  const withSentry = contentSecurityPolicy({ apiBaseUrl: api, sentryDsn: dsn });
  const connect = directive(withSentry, 'connect-src');

  assert.ok(connect.includes('https://api.tutak.am'));
  assert.ok(connect.includes('https://o4500.ingest.sentry.io'));
  // The credential in the DSN is not part of an origin and must not leak
  // into a response header.
  assert.ok(!withSentry.includes('abc123'));
});

test('a build with no DSN advertises no host it never contacts', () => {
  const connect = directive(contentSecurityPolicy({ apiBaseUrl: api }), 'connect-src');

  assert.equal(connect, "'self' https://api.tutak.am");
});

test('an unparseable DSN is ignored rather than breaking the policy', () => {
  const connect = directive(
    contentSecurityPolicy({ apiBaseUrl: api, sentryDsn: 'not-a-dsn' }),
    'connect-src',
  );

  assert.equal(connect, "'self' https://api.tutak.am");
});

test('a self-hosted Sentry on the API origin is not listed twice', () => {
  const connect = directive(
    contentSecurityPolicy({ apiBaseUrl: api, sentryDsn: 'https://k@api.tutak.am/2' }),
    'connect-src',
  );

  assert.equal(connect, "'self' https://api.tutak.am");
});

test('the rest of the policy is unchanged by a DSN', () => {
  const policy = contentSecurityPolicy({ apiBaseUrl: api, sentryDsn: dsn });

  assert.ok(policy.includes("frame-ancestors 'none'"));
  assert.ok(policy.includes("object-src 'none'"));
  assert.ok(policy.includes("base-uri 'self'"));
  assert.ok(policy.includes("form-action 'self'"));
  assert.ok(!policy.includes("script-src 'self' 'unsafe-inline' https://o4500"));
});
