/**
 * Response headers for the two Next.js dashboards.
 *
 * The API sends a full set through helmet; the dashboards sent none. That is
 * the wrong way round: the API answers with JSON to a bearer token, while the
 * dashboards are where an operator's session lives, where the access token
 * sits in `localStorage`, and where an injected script would actually have
 * something to steal.
 *
 * Lives in `@tutak/design` rather than beside either app for two reasons: the
 * two dashboards must not drift apart on this, and the policy has to know
 * about `themeInitScript` — the blocking inline script this package asks both
 * apps to put in their `<head>` — which is precisely what decides whether a
 * script policy can be strict.
 *
 * ## What this policy does and does not buy
 *
 * `script-src` allows `'unsafe-inline'`, and there is no honest way around it
 * today: Next.js emits inline bootstrap and flight-data scripts on every
 * page, and this package's own theme script has to run before paint. Removing
 * it means minting a per-request nonce in middleware and threading it through
 * both the framework's scripts and ours — worth doing, not worth pretending
 * has been done.
 *
 * So this does **not** stop a script from being injected. What it does stop
 * is that script being useful:
 *
 *  - `connect-src` and `img-src` name the API, the error reporter and nothing
 *    else, so a payload cannot post a stolen token to an attacker's host, or
 *    smuggle it out in an image URL — which is how a stolen token is actually
 *    monetised.
 *  - `script-src` has no host sources beyond `'self'`, so `<script src>`
 *    pointing at someone else's CDN is refused.
 *  - `form-action` stops a planted form posting credentials elsewhere, and
 *    `base-uri` stops a `<base>` tag silently re-pointing every relative URL.
 *  - `frame-ancestors: 'none'` (plus `X-Frame-Options`) stops the dashboards
 *    being framed and clickjacked into approving a payout.
 *
 * The XSS that gets in still runs. It just has nowhere to send anything.
 */

/**
 * Plain ESM rather than TypeScript on purpose: this is imported by
 * `next.config.ts` in both dashboards, and a Next config is loaded by Node
 * before any of the workspace's TypeScript tooling is in play —
 * `transpilePackages` applies to the application build, not to the file that
 * configures it.
 *
 * @typedef {object} SecurityHeaderOptions
 * @property {string} apiBaseUrl Where the browser may send API requests — the
 *   same value the app was built with. Only its origin is used.
 * @property {boolean} [isDevelopment] Development relaxes two things: HSTS is
 *   omitted (it would pin `http://localhost` into every browser that ever
 *   loaded it, which is remarkably annoying to undo), and websockets are
 *   allowed so hot reload works.
 * @property {string} [sentryDsn] The DSN this app was built with, if any.
 *   Only its origin is used, and only to allow the browser SDK to reach it:
 *   `connect-src` named the API and nothing else, so a configured DSN
 *   produced a dashboard that collected errors and could not send one —
 *   silently, because a blocked report is exactly the case where nothing is
 *   left to report it. Naming one more host the app deliberately talks to is
 *   not a weakening of the policy; leaving error reporting broken to keep
 *   the directive shorter would be.
 */

/**
 * The origin of a URL, or `null` if it cannot be parsed.
 * @param {string} url
 * @returns {string | null}
 */
function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * @param {SecurityHeaderOptions} options
 * @returns {string}
 */
export function contentSecurityPolicy(options) {
  const api = originOf(options.apiBaseUrl);
  const sentry = options.sentryDsn ? originOf(options.sentryDsn) : null;
  const connect = [
    "'self'",
    ...(api ? [api] : []),
    // Absent unless this build actually has a DSN, so a deployment with
    // Sentry off does not advertise a host it never contacts.
    ...(sentry && sentry !== api ? [sentry] : []),
  ];
  if (options.isDevelopment) {
    // Next's hot reload runs over a websocket to the dev server.
    connect.push('ws:', 'wss:');
  }

  return [
    "default-src 'self'",
    // See the note above: unavoidable while Next emits inline bootstrap
    // scripts and the theme script has to beat first paint.
    "script-src 'self' 'unsafe-inline'",
    // Tailwind and the theme tokens are injected as style elements.
    "style-src 'self' 'unsafe-inline'",
    // `data:` and `blob:` cover the inlined SVG brand marks and locally
    // previewed uploads. The API origin is here for a real reason and for
    // exactly one: partner logos, covers and customer avatars are served by
    // the API (TUTAK_V2_MEDIA_SYSTEM_SPEC.md §3.2), so the branding page and
    // the brand-media review queue load images cross-origin. Without it the
    // browser blocks them with a bare `csp` failure and every preview renders
    // as a broken image — which is how this was found, in a screenshot.
    //
    // It costs nothing against the threat this directive exists for. An image
    // URL is an exfiltration channel because it reaches an *attacker's* host;
    // the API origin is already an allowed `connect-src`, so a payload that
    // wanted to send a stolen token there could always do so directly. No new
    // destination is opened. Any other host is still refused.
    `img-src ${['\'self\'', 'data:', 'blob:', ...(api ? [api] : [])].join(' ')}`,
    "font-src 'self' data:",
    `connect-src ${connect.join(' ')}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Only when the deployment is actually on TLS, which the API's own scheme
    // is the honest signal for. Emitting it unconditionally in production
    // would rewrite the API call to `https://` on any stack served over plain
    // HTTP — the demo compose stack, or a LAN address — and break every
    // request the dashboard makes. A hardening directive must not be the
    // thing that takes the product down.
    ...(api?.startsWith('https://') ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

/**
 * The header list in the shape `next.config.ts` wants.
 * @param {SecurityHeaderOptions} options
 * @returns {{ key: string, value: string }[]}
 */
export function securityHeaders(options) {
  const headers = [
    { key: 'Content-Security-Policy', value: contentSecurityPolicy(options) },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    // Redundant with `frame-ancestors` for current browsers, kept for older
    // ones. Costs nothing and the thing it prevents is an operator being
    // tricked into clicking a control they cannot see.
    { key: 'X-Frame-Options', value: 'DENY' },
    // Send the origin to other sites, the full path only to ourselves. A
    // dashboard URL can carry a payout or partner id, which is not something
    // to hand to whatever a user clicks through to.
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    // Nothing in either dashboard uses these.
    {
      key: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    },
    { key: 'X-DNS-Prefetch-Control', value: 'off' },
  ];

  if (!options.isDevelopment) {
    headers.push({
      // Two years, subdomains included. Deliberately no `preload` directive:
      // preloading is effectively irreversible for the apex domain, and that
      // is the operator's decision to make, not a default to inherit from a
      // package.
      key: 'Strict-Transport-Security',
      value: 'max-age=63072000; includeSubDomains',
    });
  }

  return headers;
}
