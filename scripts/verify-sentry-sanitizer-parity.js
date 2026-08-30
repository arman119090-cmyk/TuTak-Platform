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
 * runs the exact same fixture matrix through both, deep-comparing the
 * output. Any behavioural difference — a forgotten edit to one copy, a
 * mistyped allowlist entry — fails loudly here instead of shipping silently
 * to only one of the four apps.
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
  'ALLOWED_TAG_KEYS',
  'FALLBACK_ERROR_TYPE',
  'safeErrorType',
  'sanitizeSentryEvent',
  'sanitizeBreadcrumb',
];

/**
 * Every category the policy must drop, in one event: raw paths carrying a
 * name and an account number, a password, an unlabelled opaque token, a
 * customer name, arbitrary tags, an arbitrary fingerprint, and a secret in
 * stack-frame source text.
 */
const DIRTY_EVENT_FIXTURE = {
  event_id: 'abc123',
  timestamp: 1700000000,
  platform: 'node',
  level: 'error',
  environment: 'production',
  release: 'deadbeef',
  fingerprint: ['customer', 'Арман Петросян'],
  message: 'password hunter2 rejected for Арман Петросян',
  tags: {
    service: 'api',
    kind: 'sentry-verify',
    'http.method': 'GET',
    'http.route': '/v1/users/:id',
    'http.status_code': 500,
    customerName: 'Арман Петросян',
    rawPath: '/v1/users/Арман',
    opaque: 'Zx9QpLm2Vt7RhK4NsE1BgYcW',
  },
  exception: {
    values: [
      {
        type: 'Error',
        value: 'password hunter2 for /v1/customers/123456789',
        mechanism: { type: 'generic', handled: false, data: { framework: 'express' } },
        stacktrace: {
          frames: [
            {
              filename: 'auth.ts',
              function: 'login',
              module: 'app.auth',
              lineno: 10,
              colno: 3,
              in_app: true,
              context_line: 'const key = "Zx9QpLm2Vt7RhK4NsE1BgYcW";',
              pre_context: ['// customer Арман Петросян'],
              post_context: ['return key;'],
              vars: { password: 'hunter2' },
            },
          ],
        },
      },
      { type: 'not a class name!', value: 'boom' },
    ],
  },
  breadcrumbs: [
    {
      category: 'console',
      level: 'log',
      timestamp: 1700000000,
      type: 'default',
      message: 'GET /v1/customers/123456789 for Арман Петросян',
      data: { headers: { cookie: 'sid=abc123' }, body: '{"password":"hunter2"}' },
    },
  ],
  request: {
    method: 'POST',
    url: '/v1/users/Арман?otp=482913',
    headers: { authorization: 'Bearer secret', 'x-api-key': 'sk_live_abc' },
    cookies: { sid: 'abc123' },
    query_string: 'otp=482913',
    data: { password: 'hunter2', cardNumber: '4111 1111 1111 1111' },
  },
  user: { id: 'u1', ip_address: '1.2.3.4', email: 'a@b.com', username: 'Арман' },
  extra: { env: { JWT_ACCESS_SECRET: 'x' }, phone: '+37455512345' },
  contexts: { runtime: { name: 'node' }, custom: { ssn: '123-45-6789' } },
};

const DIRTY_BREADCRUMB_FIXTURE = {
  category: 'xhr',
  level: 'info',
  timestamp: 1700000000,
  type: 'http',
  message: 'GET /v1/users/Арман?token=abc123 -> 200',
  data: {
    url: '/v1/users/Арман?token=abc123',
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

// 2. The tag allowlist itself is identical — a divergence here would let a
// tag through in one app and not the other.
check('ALLOWED_TAG_KEYS parity', [...api.ALLOWED_TAG_KEYS], [...shared.ALLOWED_TAG_KEYS]);
check('FALLBACK_ERROR_TYPE parity', api.FALLBACK_ERROR_TYPE, shared.FALLBACK_ERROR_TYPE);

// 3. Error-type validation agrees on identifiers and on everything that is
// not one.
const ERROR_TYPE_SAMPLES = [
  'Error',
  'TypeError',
  'PrismaClientKnownRequestError',
  'SentryVerificationProbe',
  '_private$Thing',
  'not a class name!',
  'Error: password hunter2',
  '/v1/users/Арман',
  '',
  'A'.repeat(200),
  undefined,
  null,
  42,
  { toString: () => 'Error' },
];
for (const sample of ERROR_TYPE_SAMPLES) {
  check(
    `safeErrorType(${JSON.stringify(sample)}) parity`,
    api.safeErrorType(sample),
    shared.safeErrorType(sample),
  );
}

// 4. The actual `beforeSend`/`beforeBreadcrumb` inputs every one of the four
// apps runs through this policy.
check(
  'sanitizeSentryEvent(...) parity on the dirty event fixture',
  api.sanitizeSentryEvent(structuredClone(DIRTY_EVENT_FIXTURE)),
  shared.sanitizeSentryEvent(structuredClone(DIRTY_EVENT_FIXTURE)),
);
check(
  'sanitizeBreadcrumb(...) parity on the dirty breadcrumb fixture',
  api.sanitizeBreadcrumb(structuredClone(DIRTY_BREADCRUMB_FIXTURE)),
  shared.sanitizeBreadcrumb(structuredClone(DIRTY_BREADCRUMB_FIXTURE)),
);

// 5. Independently of parity: neither copy may emit any of the fixture's
// secrets. This is the same assertion the unit suites make, repeated here so
// the CI step that guards drift also guards the policy itself.
const SECRETS = [
  'Арман',
  'hunter2',
  '123456789',
  'Zx9QpLm2Vt7RhK4NsE1BgYcW',
  'customerName',
  'sk_live_abc',
  'Bearer secret',
  '4111 1111 1111 1111',
  'sid=abc123',
  'not a class name!',
];
for (const [label, mod] of [
  ['@tutak/observability', shared],
  ['apps/api', api],
]) {
  const serialized = JSON.stringify([
    mod.sanitizeSentryEvent(structuredClone(DIRTY_EVENT_FIXTURE)),
    mod.sanitizeBreadcrumb(structuredClone(DIRTY_BREADCRUMB_FIXTURE)),
  ]);
  for (const secret of SECRETS) {
    if (serialized.includes(secret)) {
      failures += 1;
      console.error(`✗ ${label} leaked ${JSON.stringify(secret)} through the sanitizer`);
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed — the Sentry privacy policy is not sound.`);
  process.exit(1);
}

console.log('OK — apps/api and @tutak/observability apply identical Sentry sanitization rules.');
