#!/usr/bin/env node
'use strict';

/**
 * Proves that `packages/observability/src/sentrySanitize.ts` (imported by
 * apps/mobile, apps/admin and apps/partner) and
 * `apps/api/src/common/observability/sentry-sanitize.ts` (apps/api's own
 * copy, kept separate only because of that app's `rootDir` build constraint)
 * apply exactly the same privacy rules.
 *
 * The two files cannot share an import — that is the whole reason a second
 * copy exists — so nothing at the type-checker level would catch them
 * drifting apart. This script is the substitute: it loads both source files
 * directly (via `typescript`'s `transpileModule`, already a root
 * devDependency, so no new tooling is needed for one comparison script) and
 * runs the exact same fixture matrix through both, byte-comparing the
 * output. Any behavioural difference — a forgotten edit to one copy, a typo
 * in a regex — fails loudly here instead of shipping silently to only one
 * of the four apps.
 *
 * Run with: node scripts/verify-sentry-sanitizer-parity.js
 */

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const ts = require('typescript');

function loadTsModuleAsCjs(absPath) {
  const source = fs.readFileSync(absPath, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: absPath,
  });
  const mod = new Module(absPath, module);
  mod.filename = absPath;
  mod.paths = Module._nodeModulePaths(path.dirname(absPath));
  mod._compile(outputText, absPath);
  return mod.exports;
}

const sharedPath = path.resolve(__dirname, '../packages/observability/src/sentrySanitize.ts');
const apiPath = path.resolve(__dirname, '../apps/api/src/common/observability/sentry-sanitize.ts');

const shared = loadTsModuleAsCjs(sharedPath);
const api = loadTsModuleAsCjs(apiPath);

const EXPORTED_NAMES = [
  'SENSITIVE_KEY_SUBSTRINGS',
  'REDACTED',
  'isSensitiveKey',
  'scrubString',
  'scrubValue',
  'stripQueryString',
  'sanitizeSentryEvent',
  'sanitizeBreadcrumb',
];

const DIRTY_EVENT_FIXTURE = {
  event_id: 'abc123',
  timestamp: 1700000000,
  platform: 'node',
  level: 'error',
  environment: 'production',
  release: 'deadbeef',
  tags: { service: 'api', 'http.method': 'GET', 'http.route': '/v1/users/:id', 'http.status_code': 500 },
  message: 'Authorization: Bearer secret-token-abc123',
  exception: {
    values: [
      {
        type: 'Error',
        value: 'Login failed for x-api-key: sk_live_51ABCDEF and password: hunter2',
        mechanism: { type: 'generic', handled: false, data: { framework: 'express' } },
        stacktrace: {
          frames: [
            {
              filename: 'app.ts',
              function: 'login',
              lineno: 10,
              colno: 3,
              in_app: true,
              context_line: 'const token = "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc";',
              vars: { password: 'hunter2' },
            },
          ],
        },
      },
    ],
  },
  breadcrumbs: [
    {
      category: 'console',
      level: 'log',
      timestamp: 1700000000,
      message: 'refresh_token=abc.def.ghi issued for user a@b.com, otp 482913 accepted',
      data: { headers: { cookie: 'sid=abc123; Path=/' }, body: '{"password":"hunter2"}' },
    },
  ],
  request: {
    method: 'POST',
    url: '/v1/auth/login?otp=482913',
    headers: { authorization: 'Bearer secret', 'x-api-key': 'sk_live_abc' },
    cookies: { sid: 'abc123' },
    query_string: 'otp=482913',
    data: { password: 'hunter2', cardNumber: '4111 1111 1111 1111' },
  },
  user: { id: 'u1', ip_address: '1.2.3.4', email: 'a@b.com' },
  extra: { env: { JWT_ACCESS_SECRET: 'x' }, note: 'kept?', phone: '+37455512345' },
  contexts: { runtime: { name: 'node', version: '22.0.0' } },
};

const DIRTY_BREADCRUMB_FIXTURE = {
  category: 'xhr',
  level: 'info',
  timestamp: 1700000000,
  type: 'http',
  message: 'GET /v1/wallet/me?token=abc123 -> 200, Authorization: Bearer secret-token',
  data: {
    url: '/v1/wallet/me?token=abc123',
    body: '{"iban":"AM231234567890123456789012"}',
    headers: { cookie: 'sid=abc123' },
  },
};

let failures = 0;

function check(label, actual, expected) {
  try {
    assert.deepStrictEqual(actual, expected);
  } catch (err) {
    failures += 1;
    console.error(`✗ ${label}`);
    console.error(err.message);
  }
}

// 1. Every exported name exists on both modules.
for (const name of EXPORTED_NAMES) {
  check(`both modules export ${name}`, typeof api[name], typeof shared[name]);
}

// 2. isSensitiveKey and scrubString agree on every keyword.
for (const key of shared.SENSITIVE_KEY_SUBSTRINGS) {
  check(`isSensitiveKey('${key}') parity`, api.isSensitiveKey(key), shared.isSensitiveKey(key));
}

const SAMPLE_STRINGS = [
  'Authorization: Bearer secret-token-abc123',
  'x-api-key: sk_live_51ABCDEF',
  'refresh_token=abc.def.ghi',
  'Cookie: sid=abc123; Path=/',
  'password: hunter2',
  'OTP 482913 expired',
  '482913 is your otp',
  'contact a@b.com',
  'call +37455512345',
  'card 4111 1111 1111 1111',
  'Access denied: contact support',
  'nothing sensitive here',
];
for (const text of SAMPLE_STRINGS) {
  check(`scrubString(${JSON.stringify(text)}) parity`, api.scrubString(text), shared.scrubString(text));
}

// 3. scrubValue on a representative nested structure.
check(
  'scrubValue(...) parity on the full dirty event',
  api.scrubValue(structuredClone(DIRTY_EVENT_FIXTURE)),
  shared.scrubValue(structuredClone(DIRTY_EVENT_FIXTURE)),
);

// 4. sanitizeSentryEvent and sanitizeBreadcrumb on the dirty fixtures — the
// actual `beforeSend`/`beforeBreadcrumb` inputs every one of the four apps
// runs through this policy.
const apiEventResult = api.sanitizeSentryEvent(structuredClone(DIRTY_EVENT_FIXTURE));
const sharedEventResult = shared.sanitizeSentryEvent(structuredClone(DIRTY_EVENT_FIXTURE));
check('sanitizeSentryEvent(...) parity on the dirty event fixture', apiEventResult, sharedEventResult);

const apiBreadcrumbResult = api.sanitizeBreadcrumb(structuredClone(DIRTY_BREADCRUMB_FIXTURE));
const sharedBreadcrumbResult = shared.sanitizeBreadcrumb(structuredClone(DIRTY_BREADCRUMB_FIXTURE));
check('sanitizeBreadcrumb(...) parity on the dirty breadcrumb fixture', apiBreadcrumbResult, sharedBreadcrumbResult);

if (failures > 0) {
  console.error(`\n${failures} parity check(s) failed — apps/api's sanitizer and @tutak/observability disagree.`);
  process.exit(1);
}

console.log('OK — apps/api and @tutak/observability apply identical Sentry sanitization rules.');
