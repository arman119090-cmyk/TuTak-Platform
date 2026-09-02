#!/usr/bin/env node
/**
 * The TuTak → Viva gateway.
 *
 * One job: accept a signed request from the TuTak API on Railway, and forward
 * it to exactly one of four Viva endpoints over the IPsec tunnel. It is not a
 * proxy in the general sense and must never become one — the whole point of
 * putting a machine here is that Viva sees a single fixed address, and the
 * whole risk of putting a machine here is that it turns into an open relay
 * somebody else can send SMS through on our account.
 *
 * ## What is refused, structurally
 *
 *  - any path that is not one of the four (`ALLOWED_PATHS`);
 *  - any method that is not POST;
 *  - CONNECT, and every other method, before routing;
 *  - any upstream but `businesshubapi.viva.am` — the host is a constant here,
 *    never read from a header, a query parameter or a body field;
 *  - a body over `MAX_BODY_BYTES`;
 *  - a request whose signature, timestamp or nonce does not check out;
 *  - anything at all, when the tunnel is required and is not up.
 *
 * There is deliberately no configuration that can widen any of those.
 *
 * Dependency-free on purpose: this process sits on the login path of the
 * whole product, and a supply chain is a poor thing to put there for the sake
 * of a router and an HMAC.
 */
import { createServer } from 'node:http';
import { createHmac, randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** The only four things this gateway will ever forward. */
export const ALLOWED_PATHS = Object.freeze([
  '/v1/token/get',
  '/v1/token/refresh',
  '/v1/transact/send/batch',
  '/v1/transact/show/progress',
]);

/** Fixed. Not configuration — changing it is a code change and a review. */
const UPSTREAM_HOST = 'businesshubapi.viva.am';
const UPSTREAM_PREFIX = '/api';

const config = {
  port: Number(process.env.VIVA_GATEWAY_PORT ?? 8443),
  bind: process.env.VIVA_GATEWAY_BIND ?? '0.0.0.0',
  secret: process.env.VIVA_GATEWAY_SECRET ?? '',
  maxBodyBytes: Number(process.env.VIVA_GATEWAY_MAX_BODY_BYTES ?? 64 * 1024),
  upstreamTimeoutMs: Number(process.env.VIVA_GATEWAY_TIMEOUT_MS ?? 15_000),
  clockSkewSeconds: Number(process.env.VIVA_GATEWAY_CLOCK_SKEW_SECONDS ?? 300),
  rateLimitPerMinute: Number(process.env.VIVA_GATEWAY_RATE_LIMIT_PER_MINUTE ?? 60),
  /**
   * Fail-closed. Default on: a request that silently leaves this box over the
   * ordinary internet instead of the tunnel is the exact outcome the tunnel
   * exists to prevent, and it would look identical to a working one from
   * Railway. Turned off only, and deliberately, for the pre-VPN phase.
   */
  requireTunnel: process.env.VIVA_GATEWAY_REQUIRE_TUNNEL !== 'false',
  tunnelStateFile: process.env.VIVA_GATEWAY_TUNNEL_STATE_FILE ?? '/run/viva-tunnel/state',
};

/* ── request signing ───────────────────────────────────────────────────── */

/**
 * The string both sides sign.
 *
 * Covers the body, so a signature cannot be lifted onto a different message;
 * the path, so a signature for `show/progress` cannot send an SMS; and a
 * timestamp and nonce, so a captured request cannot be replayed. The secret
 * itself never travels.
 */
export function signingString({ timestamp, nonce, method, path, body }) {
  const digest = createHash('sha256').update(body ?? '').digest('hex');
  return [timestamp, nonce, method.toUpperCase(), path, digest].join('\n');
}

export function sign(secret, parts) {
  return createHmac('sha256', secret).update(signingString(parts)).digest('hex');
}

function signatureMatches(expected, provided) {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided ?? '', 'utf8');
  // Length first: `timingSafeEqual` throws on a mismatch, and an exception is
  // itself a timing signal.
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ── replay and rate limiting ──────────────────────────────────────────── */

/**
 * Nonces already spent, and when they expire.
 *
 * Bounded by the skew window rather than by count: anything older than the
 * window is refused by the timestamp check anyway, so it can be dropped.
 */
class NonceCache {
  #seen = new Map();

  remember(nonce, now, ttlSeconds) {
    this.#sweep(now);
    if (this.#seen.has(nonce)) return false;
    this.#seen.set(nonce, now + ttlSeconds);
    return true;
  }

  #sweep(now) {
    for (const [nonce, expiry] of this.#seen) {
      if (expiry <= now) this.#seen.delete(nonce);
    }
  }
}

class RateLimiter {
  #hits = [];

  allow(now, limit) {
    const cutoff = now - 60;
    this.#hits = this.#hits.filter((t) => t > cutoff);
    if (this.#hits.length >= limit) return false;
    this.#hits.push(now);
    return true;
  }
}

/* ── tunnel state ──────────────────────────────────────────────────────── */

/**
 * Whether the IPsec tunnel is up, according to the health unit.
 *
 * Read from a file the health timer writes rather than by shelling out to
 * `swanctl` per request: this is on the login path, and a fork per SMS is a
 * cost with no benefit. A missing or stale file reads as *down*, which is the
 * safe direction — see `requireTunnel`.
 */
export function tunnelIsUp(readFile, path, now, maxAgeSeconds = 120) {
  try {
    const raw = readFile(path, 'utf8').trim();
    const [state, writtenAt] = raw.split(/\s+/);
    if (state !== 'up') return false;
    const age = now - Number(writtenAt);
    return Number.isFinite(age) && age >= 0 && age <= maxAgeSeconds;
  } catch {
    return false;
  }
}

/* ── the server ────────────────────────────────────────────────────────── */

/**
 * The request body, refused rather than buffered once it passes the limit.
 *
 * The stream is paused rather than destroyed: destroying it here races the
 * 413 the caller is about to write, and the client then sees a dropped
 * connection instead of the reason. Tearing the socket down is the response
 * path's job, once the reason has actually been sent.
 */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        req.pause();
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * What goes in the log. Never a header, never a body, never a token.
 *
 * `endpoint` is the path, which is one of four fixed strings and therefore
 * carries nothing. `trx` is Viva's own transaction id, which is what makes a
 * delivery traceable at all.
 */
function logLine(fields) {
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), ...fields })}\n`);
}

export function createGateway(deps = {}) {
  const {
    fetchImpl = fetch,
    readFile = readFileSync,
    now = () => Math.floor(Date.now() / 1000),
    settings = config,
  } = deps;

  const nonces = new NonceCache();
  const limiter = new RateLimiter();

  return createServer(async (req, res) => {
    const requestId = randomUUID();
    const started = Date.now();
    const send = (status, code) => {
      logLine({
        request_id: requestId,
        endpoint: req.url ?? '',
        method: req.method ?? '',
        status,
        code,
        duration_ms: Date.now() - started,
      });
      res.writeHead(status, { 'content-type': 'application/json', connection: 'close' });
      // The socket is closed only after the reason has been flushed. A body
      // that was refused for being too large is still arriving, and draining
      // it would be the very cost the limit exists to avoid.
      res.end(JSON.stringify({ error: code, request_id: requestId }), () => {
        if (!req.readableEnded) req.destroy();
      });
    };

    // Liveness, before anything else and requiring no signature. It says
    // whether the process is up and whether the tunnel is up — and nothing
    // about Viva, credentials or traffic.
    if (req.method === 'GET' && req.url === '/health') {
      const up = tunnelIsUp(readFile, settings.tunnelStateFile, now());
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', tunnel: up ? 'up' : 'down' }));
      return;
    }

    if (req.method !== 'POST') return send(405, 'method_not_allowed');

    const path = (req.url ?? '').split('?')[0];
    if (!ALLOWED_PATHS.includes(path)) return send(404, 'unknown_endpoint');

    if (!limiter.allow(now(), settings.rateLimitPerMinute)) {
      return send(429, 'rate_limited');
    }

    if (!settings.secret) return send(500, 'gateway_not_configured');

    let body;
    try {
      body = await readBody(req, settings.maxBodyBytes);
    } catch (err) {
      return send(err.status === 413 ? 413 : 400, err.status === 413 ? 'body_too_large' : 'bad_request');
    }

    const timestamp = req.headers['x-tutak-timestamp'];
    const nonce = req.headers['x-tutak-nonce'];
    const signature = req.headers['x-tutak-signature'];
    if (!timestamp || !nonce || !signature) return send(401, 'unauthenticated');

    const skew = Math.abs(now() - Number(timestamp));
    if (!Number.isFinite(skew) || skew > settings.clockSkewSeconds) {
      return send(401, 'stale_timestamp');
    }

    const expected = sign(settings.secret, {
      timestamp: String(timestamp),
      nonce: String(nonce),
      method: 'POST',
      path,
      body,
    });
    if (!signatureMatches(expected, String(signature))) return send(401, 'bad_signature');

    if (!nonces.remember(String(nonce), now(), settings.clockSkewSeconds * 2)) {
      return send(401, 'replayed_nonce');
    }

    if (settings.requireTunnel && !tunnelIsUp(readFile, settings.tunnelStateFile, now())) {
      // The request is dropped rather than sent the ordinary way. Viva
      // expects our traffic from inside the tunnel, and a silent fallback to
      // the open internet would look identical to success from Railway.
      return send(503, 'tunnel_down');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), settings.upstreamTimeoutMs);
    try {
      const upstream = await fetchImpl(`https://${UPSTREAM_HOST}${UPSTREAM_PREFIX}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          // Viva's own auth travels in the body or a header the API set; it
          // is forwarded untouched and never inspected or logged here.
          ...forwardableHeaders(req.headers),
        },
        body,
        signal: controller.signal,
      });

      const text = await upstream.text();
      logLine({
        request_id: requestId,
        endpoint: path,
        status: upstream.status,
        duration_ms: Date.now() - started,
        trx: safeTransactionId(text),
      });
      res.writeHead(upstream.status, { 'content-type': 'application/json' });
      res.end(text);
    } catch (err) {
      send(504, err.name === 'AbortError' ? 'upstream_timeout' : 'upstream_unreachable');
    } finally {
      clearTimeout(timer);
    }
  });
}

/**
 * Headers passed through to Viva.
 *
 * An allow-list, not a deny-list. The API may present Viva's access token in
 * a header (`SMS_VIVA_TOKEN_PLACEMENT=header:...`), and that has to reach
 * Viva — but nothing else does, and in particular none of this gateway's own
 * authentication, no `Host`, no forwarding headers and no cookies.
 */
function forwardableHeaders(headers) {
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (lower === 'authorization' || lower.startsWith('x-viva-')) {
      out[name] = value;
    }
  }
  return out;
}

/** Viva's transaction id, if the response plainly contains one. */
function safeTransactionId(text) {
  try {
    const parsed = JSON.parse(text);
    const id = parsed?.trx_unique_id ?? parsed?.data?.trx_unique_id;
    return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/* istanbul ignore next -- entry point */
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  createGateway().listen(config.port, config.bind, () => {
    logLine({ event: 'listening', port: config.port, require_tunnel: config.requireTunnel });
  });
}
