/**
 * Where `req.ip` comes from, stated explicitly rather than guessed.
 *
 * ## The problem this exists for
 *
 * Render's edge does **not** strip an inbound `X-Forwarded-For`; it appends
 * its own hop to whatever the client sent. So on a Render service the header
 * looks like:
 *
 *     X-Forwarded-For: <anything the client wrote>, <infrastructure hops>
 *
 * The leftmost entry is therefore attacker-controlled and must never be
 * believed — it is the value most libraries reach for by default, and
 * trusting it hands anyone a fresh rate-limit bucket per request. Only the
 * entries appended by infrastructure, counted from the *right*, are
 * trustworthy, and how many of those there are is a property of the
 * deployment, not of this codebase.
 *
 * Cloudflare's `CF-Connecting-IP` is deliberately not used. It would be the
 * better answer if it were proven that every request reaching this process
 * has passed through Cloudflare and that Cloudflare overwrites any
 * client-supplied copy of the header on that exact path. That could not be
 * confirmed from primary sources, and an unconfirmed header is worse than
 * the socket address: it looks authoritative while being forgeable by
 * anyone who can reach the origin directly.
 *
 * ## The two strategies
 *
 * `socket` (the default) — `req.ip` is the TCP peer. Never forgeable.
 * Behind a load balancer that is the balancer, identical for every caller,
 * so per-IP limits become one shared bucket; `OtpIpRateLimitService` detects
 * this and stands down rather than locking the whole service out, leaving
 * the global SMS budget as the backstop.
 *
 * `xff-depth` — hand Express's numeric `trust proxy` a count of trusted
 * hops, which it resolves from the right-hand end of the chain.
 *
 * The count includes the socket itself as hop 1, verified against Express in
 * `client-ip.spec.ts` rather than assumed: with `CLIENT_IP_TRUSTED_HOPS=1`
 * and a header of `<spoofed>, <appended by the balancer>`, `req.ip` is the
 * appended value. So for a service behind exactly one load balancer that
 * appends the address it saw — Render's topology — the value is **1**, not
 * the number of forwarded entries.
 *
 * The count must be measured against the live deployment, never assumed:
 * one too high and `req.ip` becomes an entry the attacker wrote, which is
 * the failure this whole file exists to avoid (there is a test pinning that
 * exact regression). See `docs/RENDER_STAGING_RU.md` for how to measure it.
 */
export const CLIENT_IP_STRATEGIES = ['socket', 'xff-depth'] as const;

export type ClientIpStrategy = (typeof CLIENT_IP_STRATEGIES)[number];

export interface ClientIpConfig {
  strategy: ClientIpStrategy;
  /** Infrastructure hops to trust, counted from the right. Only used by `xff-depth`. */
  trustedHops: number;
}

export function resolveClientIpConfig(env: {
  CLIENT_IP_STRATEGY?: string;
  CLIENT_IP_TRUSTED_HOPS?: string;
}): ClientIpConfig {
  const declared = (env.CLIENT_IP_STRATEGY ?? '').trim().toLowerCase();
  const strategy: ClientIpStrategy =
    declared.length === 0
      ? 'socket'
      : (CLIENT_IP_STRATEGIES as readonly string[]).includes(declared)
        ? (declared as ClientIpStrategy)
        : (() => {
            throw new Error(
              `CLIENT_IP_STRATEGY must be one of ${CLIENT_IP_STRATEGIES.join(', ')} — got "${env.CLIENT_IP_STRATEGY}".`,
            );
          })();

  if (strategy === 'socket') return { strategy, trustedHops: 0 };

  const raw = (env.CLIENT_IP_TRUSTED_HOPS ?? '').trim();
  const hops = Number(raw);
  if (!Number.isInteger(hops) || hops < 1) {
    // Refused rather than defaulted. A wrong hop count is not a degraded
    // rate limit, it is a bypassable one, and picking a number here on the
    // operator's behalf is exactly how that happens.
    throw new Error(
      'CLIENT_IP_TRUSTED_HOPS must be a positive integer when CLIENT_IP_STRATEGY=xff-depth. ' +
        'Measure it against the live deployment — see docs/RENDER_STAGING_RU.md — rather than guessing.',
    );
  }

  return { strategy, trustedHops: hops };
}

/**
 * What to hand Express's `app.set('trust proxy', …)`.
 *
 * `undefined` leaves Express's own default (`false`) in place, so `req.ip`
 * is the socket address. A number tells Express to trust that many hops from
 * the right — the only form of this setting that is correct in front of a
 * proxy chain that does not sanitise the header.
 */
export function expressTrustProxySetting(config: ClientIpConfig): number | undefined {
  return config.strategy === 'xff-depth' ? config.trustedHops : undefined;
}

/**
 * Whether `req.ip` can be treated as identifying an individual caller.
 *
 * False under `socket` behind a balancer — every request carries the same
 * address, so a per-caller limit keyed on it is really a global one. Callers
 * that would otherwise lock everybody out at once check this first.
 */
export function clientIpIsPerCaller(config: ClientIpConfig): boolean {
  return config.strategy === 'xff-depth';
}
