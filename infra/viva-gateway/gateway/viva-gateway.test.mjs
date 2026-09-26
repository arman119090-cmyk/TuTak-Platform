import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { ALLOWED_PATHS, createGateway, sign, signingString, tunnelIsUp } from './viva-gateway.mjs';

/**
 * The gateway's whole value is what it refuses.
 *
 * A machine that can reach Viva from a fixed address is also a machine that
 * can send SMS on our account if anyone else can drive it. Every test here is
 * about a way in that must stay shut.
 */

const SECRET = 'test-secret-of-sufficient-length-000000';

const SETTINGS = {
  port: 0,
  bind: '127.0.0.1',
  secret: SECRET,
  maxBodyBytes: 1024,
  upstreamTimeoutMs: 1000,
  clockSkewSeconds: 300,
  rateLimitPerMinute: 1000,
  requireTunnel: false,
  tunnelStateFile: '/nonexistent',
};

async function withGateway(overrides, run) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      status: 200,
      text: async () => JSON.stringify({ trx_unique_id: '642ebd4156c19' }),
    };
  };
  const server = createGateway({
    fetchImpl: overrides.fetchImpl ?? fetchImpl,
    readFile: overrides.readFile ?? (() => { throw new Error('no file'); }),
    now: overrides.now ?? (() => Math.floor(Date.now() / 1000)),
    settings: { ...SETTINGS, ...overrides.settings },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(base, calls);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

function signed(path, body, { secret = SECRET, timestamp, nonce = Math.random().toString(16) } = {}) {
  const ts = String(timestamp ?? Math.floor(Date.now() / 1000));
  return {
    'content-type': 'application/json',
    'x-tutak-timestamp': ts,
    'x-tutak-nonce': nonce,
    'x-tutak-signature': sign(secret, { timestamp: ts, nonce, method: 'POST', path, body }),
  };
}

const post = (base, path, body, headers) =>
  fetch(`${base}${path}`, { method: 'POST', headers, body });

/* ── the allow-list ────────────────────────────────────────────────────── */

test('forwards each of the four documented endpoints and nothing else', async () => {
  await withGateway({}, async (base, calls) => {
    for (const path of ALLOWED_PATHS) {
      const body = '{"a":1}';
      const res = await post(base, path, body, signed(path, body));
      assert.equal(res.status, 200, path);
    }
    assert.equal(calls.length, 4);
    for (const call of calls) {
      assert.ok(call.url.startsWith('https://businesshubapi.viva.am/api/v1/'), call.url);
    }
  });
});

test('refuses any path outside the allow-list', async () => {
  await withGateway({}, async (base, calls) => {
    for (const path of [
      '/v1/transact/send',            // near miss
      '/v1/token',                    // prefix
      '/v1/transact/send/batch/../..',// traversal
      '/',
      '/http://evil.example/',
      '/v1/admin',
    ]) {
      const res = await post(base, path, '{}', signed(path, '{}'));
      assert.equal(res.status, 404, path);
    }
    assert.equal(calls.length, 0, 'nothing was forwarded');
  });
});

test('refuses every method except POST, including CONNECT', async () => {
  await withGateway({}, async (base, calls) => {
    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD']) {
      const res = await fetch(`${base}/v1/transact/send/batch`, { method });
      assert.equal(res.status, 405, method);
    }
    assert.equal(calls.length, 0);
  });
});

test('cannot be pointed at another host by header, query or body', async () => {
  // The upstream is a constant in the source. This pins that nothing in a
  // request can move it.
  await withGateway({}, async (base, calls) => {
    const path = '/v1/token/get';
    const body = JSON.stringify({ url: 'https://evil.example', host: 'evil.example' });
    const headers = {
      ...signed(path, body),
      host: 'evil.example',
      'x-forwarded-host': 'evil.example',
    };
    const res = await post(base, `${path}?upstream=https://evil.example`, body, headers);
    assert.equal(res.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://businesshubapi.viva.am/api/v1/token/get');
  });
});

/* ── authentication ────────────────────────────────────────────────────── */

test('refuses an unsigned request', async () => {
  await withGateway({}, async (base, calls) => {
    const res = await post(base, '/v1/token/get', '{}', { 'content-type': 'application/json' });
    assert.equal(res.status, 401);
    assert.equal(calls.length, 0);
  });
});

test('refuses a signature made with the wrong secret', async () => {
  await withGateway({}, async (base, calls) => {
    const path = '/v1/token/get';
    const res = await post(base, path, '{}', signed(path, '{}', { secret: 'not-the-secret' }));
    assert.equal(res.status, 401);
    assert.equal(calls.length, 0);
  });
});

test('refuses a signature lifted onto a different body', async () => {
  await withGateway({}, async (base, calls) => {
    const path = '/v1/transact/send/batch';
    const headers = signed(path, '{"to":"mine"}');
    const res = await post(base, path, '{"to":"someone-else"}', headers);
    assert.equal(res.status, 401);
    assert.equal(calls.length, 0);
  });
});

test('refuses a signature lifted onto a different endpoint', async () => {
  // A signature for a harmless progress check must not send an SMS.
  await withGateway({}, async (base, calls) => {
    const body = '{}';
    const headers = signed('/v1/transact/show/progress', body);
    const res = await post(base, '/v1/transact/send/batch', body, headers);
    assert.equal(res.status, 401);
    assert.equal(calls.length, 0);
  });
});

test('refuses a stale or future timestamp', async () => {
  const now = 1_000_000;
  await withGateway({ now: () => now }, async (base, calls) => {
    const path = '/v1/token/get';
    for (const timestamp of [now - 301, now + 301]) {
      const res = await post(base, path, '{}', signed(path, '{}', { timestamp }));
      assert.equal(res.status, 401);
    }
    assert.equal(calls.length, 0);
  });
});

test('refuses a replayed request', async () => {
  const now = 1_000_000;
  await withGateway({ now: () => now }, async (base, calls) => {
    const path = '/v1/transact/send/batch';
    const body = '{"send":"once"}';
    const headers = signed(path, body, { timestamp: now, nonce: 'fixed-nonce' });

    assert.equal((await post(base, path, body, headers)).status, 200);
    // Byte-identical replay — the exact thing a captured request would be.
    assert.equal((await post(base, path, body, headers)).status, 401);
    assert.equal(calls.length, 1, 'the SMS was sent once');
  });
});

test('refuses everything when no secret is configured', async () => {
  await withGateway({ settings: { secret: '' } }, async (base, calls) => {
    const path = '/v1/token/get';
    const res = await post(base, path, '{}', signed(path, '{}'));
    assert.equal(res.status, 500);
    assert.equal(calls.length, 0);
  });
});

/* ── limits ────────────────────────────────────────────────────────────── */

test('refuses a body over the limit without forwarding it', async () => {
  await withGateway({ settings: { maxBodyBytes: 64 } }, async (base, calls) => {
    const path = '/v1/transact/send/batch';
    const body = JSON.stringify({ pad: 'x'.repeat(200) });
    const res = await post(base, path, body, signed(path, body));
    assert.ok(res.status === 413 || res.status === 400, `got ${res.status}`);
    assert.equal(calls.length, 0);
  });
});

test('rate limits before reaching Viva', async () => {
  const now = 1_000_000;
  await withGateway({ now: () => now, settings: { rateLimitPerMinute: 2 } }, async (base, calls) => {
    const path = '/v1/token/get';
    const statuses = [];
    for (let i = 0; i < 4; i += 1) {
      const headers = signed(path, '{}', { timestamp: now, nonce: `n${i}` });
      statuses.push((await post(base, path, '{}', headers)).status);
    }
    assert.deepEqual(statuses, [200, 200, 429, 429]);
    assert.equal(calls.length, 2);
  });
});

test('an unsigned flood cannot spend the rate-limit budget', async () => {
  // The gateway port is open to the internet. If the limiter were charged
  // before the signature check, a stranger could exhaust the shared 60/min
  // budget with unsigned POSTs and starve real, signed SMS/OTP traffic — a
  // login-path DoS needing no credential. So an unsigned request must be
  // refused for free: many of them, then a signed one still gets through.
  const now = 1_000_000;
  await withGateway({ now: () => now, settings: { rateLimitPerMinute: 2 } }, async (base, calls) => {
    const path = '/v1/token/get';
    for (let i = 0; i < 10; i += 1) {
      const res = await post(base, path, '{}', { 'x-tutak-signature': 'garbage' });
      assert.equal(res.status, 401, `unsigned attempt ${i} should be 401, got ${res.status}`);
    }
    // Budget untouched: a genuine signed request is still served.
    const ok = await post(base, path, '{}', signed(path, '{}', { timestamp: now, nonce: 'real' }));
    assert.equal(ok.status, 200);
    assert.equal(calls.length, 1);
  });
});

/* ── fail-closed ───────────────────────────────────────────────────────── */

test('refuses to reach Viva at all when the tunnel is required and down', async () => {
  // The failure this exists to prevent: the request quietly leaving over the
  // ordinary internet, which from Railway is indistinguishable from success.
  await withGateway(
    { settings: { requireTunnel: true }, readFile: () => { throw new Error('missing'); } },
    async (base, calls) => {
      const path = '/v1/transact/send/batch';
      const res = await post(base, path, '{}', signed(path, '{}'));
      assert.equal(res.status, 503);
      assert.equal((await res.json()).error, 'tunnel_down');
      assert.equal(calls.length, 0);
    },
  );
});

test('forwards when the tunnel is up and fresh', async () => {
  const now = 1_000_000;
  await withGateway(
    {
      now: () => now,
      settings: { requireTunnel: true },
      readFile: () => `up ${now - 10}`,
    },
    async (base, calls) => {
      const path = '/v1/transact/send/batch';
      const res = await post(base, path, '{}', signed(path, '{}', { timestamp: now }));
      assert.equal(res.status, 200);
      assert.equal(calls.length, 1);
    },
  );
});

test('treats a stale tunnel state file as down', async () => {
  const now = 1_000_000;
  assert.equal(tunnelIsUp(() => `up ${now - 10}`, 'p', now), true);
  assert.equal(tunnelIsUp(() => `up ${now - 3600}`, 'p', now), false, 'stale');
  assert.equal(tunnelIsUp(() => `down ${now}`, 'p', now), false);
  assert.equal(tunnelIsUp(() => 'garbage', 'p', now), false);
  assert.equal(tunnelIsUp(() => { throw new Error('missing'); }, 'p', now), false);
  // A file written in the future is not evidence of anything.
  assert.equal(tunnelIsUp(() => `up ${now + 500}`, 'p', now), false);
});

/* ── what leaves the box ───────────────────────────────────────────────── */

test('forwards Viva auth headers and strips its own', async () => {
  await withGateway({}, async (base, calls) => {
    const path = '/v1/transact/send/batch';
    const body = '{}';
    const res = await post(base, path, body, {
      ...signed(path, body),
      authorization: 'Bearer viva-token',
      'x-viva-custom': 'kept',
      cookie: 'session=secret',
      'x-tutak-internal': 'dropped',
    });
    assert.equal(res.status, 200);

    const forwarded = Object.fromEntries(
      Object.entries(calls[0].init.headers).map(([k, v]) => [k.toLowerCase(), v]),
    );
    assert.equal(forwarded.authorization, 'Bearer viva-token');
    assert.equal(forwarded['x-viva-custom'], 'kept');
    // Our own authentication must never reach Viva, nor anything ambient.
    assert.equal(forwarded['x-tutak-signature'], undefined);
    assert.equal(forwarded['x-tutak-nonce'], undefined);
    assert.equal(forwarded['x-tutak-timestamp'], undefined);
    assert.equal(forwarded.cookie, undefined);
    assert.equal(forwarded['x-tutak-internal'], undefined);
  });
});

test('health needs no signature and reveals nothing but liveness', async () => {
  await withGateway({ readFile: () => 'down 0' }, async (base) => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ok', tunnel: 'down' });
  });
});

/* ── the signing string itself ─────────────────────────────────────────── */

test('the signing string binds body, path, method, time and nonce', async () => {
  const base = { timestamp: '1', nonce: 'n', method: 'POST', path: '/v1/token/get', body: '{}' };
  const of = (o) => signingString({ ...base, ...o });
  const all = new Set([
    of({}),
    of({ timestamp: '2' }),
    of({ nonce: 'm' }),
    of({ path: '/v1/token/refresh' }),
    of({ body: '{"a":1}' }),
  ]);
  assert.equal(all.size, 5, 'every field changes the signature');
  // The body is hashed, never included whole — a signing string is a thing
  // that can end up in a debug log.
  assert.ok(!of({ body: '{"code":"123456"}' }).includes('123456'));
});

/**
 * The contract with `apps/api/src/infrastructure/sms/viva-sms.provider.ts`.
 *
 * The same vector is pinned in that file's own spec. The two implementations
 * are in different languages, packages and machines; if either signing string
 * changes, one of the two suites fails instead of every request from Railway
 * turning into a 401 that looks like a broken secret.
 */
test('the signing string matches the API client byte for byte', () => {
  assert.equal(
    signingString({
      timestamp: '1700000000',
      nonce: 'abc123',
      method: 'post',
      path: '/v1/transact/send/batch',
      body: '{"a":1}',
    }),
    [
      '1700000000',
      'abc123',
      'POST',
      '/v1/transact/send/batch',
      '015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862',
    ].join('\n'),
  );
});

test('a signature the API client would produce is accepted', async () => {
  // End to end across the boundary, using the same header names and the same
  // secret the API would use.
  await withGateway({}, async (base, calls) => {
    const path = '/v1/transact/send/batch';
    const body = '{"sender_name":"TuTak"}';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = 'cross-boundary-nonce';
    const res = await post(base, path, body, {
      'content-type': 'application/json',
      'X-TuTak-Timestamp': timestamp,
      'X-TuTak-Nonce': nonce,
      'X-TuTak-Signature': sign(SECRET, { timestamp, nonce, method: 'POST', path, body }),
    });
    assert.equal(res.status, 200);
    assert.equal(calls.length, 1);
  });
});
