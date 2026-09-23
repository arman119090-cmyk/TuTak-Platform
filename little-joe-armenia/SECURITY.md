# Security

This page covers what the code does today and what it does not do. File paths are given for each control.

## Threat model (summary)

| Asset | Threats considered | Main controls |
|---|---|---|
| Orders and payments | Forged or replayed payment callbacks; tampered amounts; browser redirect used as proof of payment; double submit | Signature check per adapter, unique `(adapter, eventId)`, amount equality, state changes only from verified callbacks, idempotency key on checkout |
| Stock | Overselling under concurrency | Conditional atomic `UPDATE`, row locks, CHECK constraints (see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#inventory--concurrency)) |
| Back office | Credential stuffing, session theft, CSRF, privilege escalation | scrypt passwords, rate limit, `SameSite=Strict` session, `requireAdmin(area)` on every page and action, audit log |
| Customer accounts | OTP brute force, account enumeration | Hashed 6-digit codes, 10 min TTL, 5 attempts, single use, rate limits |
| Guest order pages | Order number guessing | Unguessable access token (HMAC), hash stored |
| Storefront | XSS, clickjacking, content injection via CMS or uploads | React escaping, plain-text CMS, nonce CSP, `frame-ancestors 'none'`, upload sniffing |
| Secrets | Leakage to the client bundle | `server-only` modules, zod-validated env |

Out of scope, not handled: volumetric DDoS (Render edge only), a compromised hosting account, a malicious admin with OWNER role.

## Input validation

- **Validation uses zod at every boundary:**
  - checkout (`src/lib/validation/checkout.ts`, the same schema on client and server);
  - reviews (`reviewSchema`);
  - sign-in (`src/app/actions/account.ts`);
  - admin actions (`src/lib/admin/forms.ts` + `parse()` in `src/lib/admin/action.ts`);
  - settings (`src/lib/settings.ts`: a malformed row falls back to defaults);
  - env (`src/lib/env.ts`).
- **Catalogue filter parameters are whitelisted and bounded** (`parseFilters()` in `src/lib/catalog.ts`): list values of 60 characters or less, at most 20 values, the search query cut to 80 characters, and integers range-checked.
- **Prices, stock and totals are never taken from the browser.** They are re-read from the database at checkout (`placeOrder()`).
- **Admin login redirect** (`next`) is restricted to `^/admin(/…)?$`, so it can never redirect to an absolute or protocol-relative URL.

## Secrets

- **Env is validated once and only on the server.** `src/lib/env.ts` imports `server-only` and validates with zod: `SESSION_SECRET` must be at least 32 characters, and unsafe combinations are refused (`AUTH_CODE_DELIVERY=screen` without `DEMO_MODE`; `PAYMENTS_MODE=mock` in production without `DEMO_MODE`; `resend` without an API key and sender).
- **No secret reaches the client.** There are no `NEXT_PUBLIC_*` secrets. Analytics IDs (public by nature) come from DB settings.
- **Render generates the random secrets.** `render.yaml` generates `SESSION_SECRET`, `MOCK_PAYMENT_SECRET` and `CRON_SECRET`, and `ADMIN_EMAIL`/`ADMIN_PASSWORD` are `sync: false` (entered in the dashboard).

## Sessions and cookies (`src/lib/security/session.ts`)

| Cookie | Purpose | Lifetime | SameSite |
|---|---|---|---|
| `lj_guest` | Cart and favourites without an account | 180 days | Lax |
| `lj_session` | Signed-in customer | 30 days | Lax |
| `lj_admin` | Back office | 12 hours | **Strict** |
| `lj_locale` | Language preference (not a credential) | 1 year | Lax |

- **Cookie values are opaque random tokens,** 256 bits from `randomBytes`. Only `HMAC-SHA256(SESSION_SECRET, token)` is stored in the database (`tokenHash`). A database leak alone does not give usable sessions, and rotating `SESSION_SECRET` invalidates them all.
- **Session cookies are locked down.** They are `httpOnly` and `Path=/`. When `APP_URL` is `https://`, they are `Secure` and use the **`__Host-`** prefix (no `Domain`). `lj_locale` is set by the proxy without the prefix.
- **Server-side checks:** a session is valid only if its row exists and has not expired. An admin must also be `isActive`. Logout deletes the row.
- **Sessions are not rotated or bound.** There is no rotation on privilege change beyond login, and no binding to IP or user agent.

## Passwords and OTP

- **Admin passwords use scrypt** with `N=2^15, r=8, p=1`, a 16-byte salt, a 64-byte key and NFKC normalisation (`src/lib/security/password.ts`). The minimum is 12 characters (seed, `scripts/create-admin.ts`).
- **Admin login does not reveal which emails exist.** It verifies against a dummy hash for unknown emails, so timing does not reveal accounts, and it always returns the same generic error (`src/app/admin/login/actions.ts`).
- **Customers have no passwords.** They sign in with a one-time code (`src/lib/domain/customer-auth.ts`):
  - a 6-digit code from `crypto.randomInt`, stored as `HMAC(SESSION_SECRET, target:code)`;
  - it expires after 10 minutes and allows at most 5 attempts;
  - the attempt counter is incremented atomically **before** comparing;
  - consumption is a conditional update, so the code is single use;
  - the comparison is constant-time.
- **How codes are delivered:**
  - by email via Resend when `AUTH_CODE_DELIVERY=resend`;
  - to the server log in development;
  - on screen only when `DEMO_MODE=true`.

  **There is no SMS gateway.** Phone sign-in is unavailable in production unless the demo `screen` mode is on.

## CSRF

- **Server Actions** (every storefront and admin mutation): Next.js compares `Origin` against `Host` for Server Actions.
- **Route handlers that accept browser POSTs** call `isSameOrigin()` (`src/lib/security/request.ts`), for example `/api/admin/upload`. It requires an `Origin` header matching `APP_URL` or the request host.
- **Cookies add a second layer:** `SameSite=Lax` for shoppers and `Strict` for admins.
- **Some routes deliberately skip the origin check** and authenticate differently: payment callbacks (signature) and `/api/cron/expire` (Bearer secret).

## Headers and CSP

The CSP is set per request in `src/proxy.ts` with a fresh nonce (`btoa(crypto.randomUUID())`):

```
default-src 'self'
script-src 'self' 'nonce-…' 'strict-dynamic'          (+ 'unsafe-eval' in dev only)
style-src 'self' 'unsafe-inline'                     (dynamic accent colours)
img-src 'self' data: blob: https:
font-src 'self'
connect-src 'self' <GA4, Meta, TikTok endpoints>      (+ ws: in dev)
frame-src 'none'; object-src 'none'; base-uri 'self'
form-action 'self' https://banking.idram.am          (Idram hosted page POST)
frame-ancestors 'none'
upgrade-insecure-requests                            (production)
```

If `IDRAM_PAYMENT_URL` is changed to another host, `form-action` must be updated too.

Static headers come from `next.config.ts`:
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`
- `Cross-Origin-Opener-Policy: same-origin`
- `X-Robots-Tag: noindex, nofollow` on `/admin/*`

`poweredByHeader: false`.

## XSS

- **React escapes all rendered values.** There is no `dangerouslySetInnerHTML` except JSON-LD.
- **CMS page bodies are plain text.** They are split into paragraphs, `## ` headings and `- ` lists and never interpreted as HTML (`src/app/[locale]/info/[slug]/page.tsx`; schema comment on `PageTranslation.body`). `fmt()` inserts variables as text.
- **JSON-LD is escaped:** `<`, U+2028 and U+2029 are escaped before being injected (`src/components/ui/json-ld.tsx`).
- **Placeholder SVGs cannot run scripts.** They are generated server-side from validated `^[0-9a-fA-F]{6}$` colours and served with their own `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'` + `nosniff` (`src/app/media/placeholder/[name]/route.ts`).
- **Uploads are checked by content, not name** (`src/app/api/admin/upload/route.ts`, `src/lib/storage/index.ts`):
  - the requester must be an admin (any role) with a same-origin request;
  - the limit is 5 MB;
  - the type is decided by magic bytes (JPEG, PNG, WebP, AVIF), never by file name or the declared type;
  - **SVG is refused**;
  - the file name is server-generated (UUID);
  - every upload is audited.
- **Admin media URLs are restricted** to `https://…` or a root-relative path (`addMedia`).

## SQL

- **All queries go through Prisma (parameterised).** Raw SQL uses tagged templates only (`$queryRaw\`…${value}\``, `$executeRaw\`…\``), which are parameterised too: inventory, rate limit, row locks, promo usage.
- **The one `$executeRawUnsafe`** is the test-only `resetDb()` (`tests/support/db.ts`), which builds its statement from `pg_tables` names and refuses non-test databases.

## Rate limits

`src/lib/security/rate-limit.ts` implements a Postgres fixed window:

| Bucket | Limit | Window | Key |
|---|---|---|---|
| `authRequest` | 5 | 15 min | IP, and separately the target (email/phone) |
| `authVerify` | 10 | 15 min | IP + target |
| `adminLogin` | 5 | 15 min | IP + email |
| `checkout` | 10 | 10 min | IP (place order, retry payment) |
| `promo` | 15 | 10 min | IP |
| `review` | 5 | 60 min | IP |
| `webhook` | 120 | 1 min | adapter + IP |
| `cart` | 120 | 1 min | IP |

The client IP is the first entry of `X-Forwarded-For` (Render sets it). Failed and rate-limited admin logins are written to the audit log.

## Payment webhooks

The details are in [docs/ARCHITECTURE.md § Payments](docs/ARCHITECTURE.md#payments-pipeline). In short:
- **Only a verified callback can change payment state.** It is checked by signature (Idram checksum, mock HMAC, constant-time compare) and by amount equality.
- **Replays are harmless.** `PaymentEvent (adapter, eventId)` is unique and is the first write in the transaction, so a replay is acknowledged as `DUPLICATE` without effects.
- **Forged or invalid events are stored under random ids and audited.**
- **A failure notice never reverses a success.**
- **Late money is never lost.** It is recorded and flagged (`PAID_STOCK_UNAVAILABLE`, `PAID_ORDER_CLOSED`).

## Audit log

`AuditLog(actor, action, entity, entityId, data, ip, createdAt)`, written by `audit()` (`src/lib/audit.ts`), in the same transaction as the change where possible. It covers:
- admin login success, failure and rate-limit, and logout;
- every admin mutation (orders, products, facts, media, stock, promos, claims, CMS, settings, users, import reviews);
- uploads;
- the seed admin bootstrap;
- bad payment signatures, amount mismatches and late or closed-order payments.

OWNERs can view it at `/admin/audit`. Rows are never deleted by the app.

## Admin roles

`src/lib/admin/auth.ts`: `OWNER` (everything), `MANAGER` (orders, customers, products incl. price and stock, promotions, reviews), `CONTENT` (product content, collections, CMS, reviews, translations). `requireAdmin(area)` redirects to `/admin/login` or `/admin/denied`. Server Actions are public POST endpoints, so each one checks for itself.

## Payment card data

The app never receives, stores or logs card numbers. Online payments happen on the provider's hosted page (Idram form POST), and the card acquirer adapter is not implemented. `PaymentEvent.payload` stores the raw callback body for audit. For Idram, that includes the payer account and transaction id, but no card data.

## Known gaps

- **No 2FA for admin accounts.** Password + rate limit only.
- **No SMS gateway**, so phone OTP does not work in production.
- **No WAF or bot protection** beyond Render's edge. Rate limiting is in the database, so a flood still costs DB round-trips, and `RateLimit` rows are never purged.
- **The IP comes from the first `X-Forwarded-For` entry.** That is correct behind Render's proxy, but spoofable if the app is exposed some other way.
- **The upload endpoint accepts any admin role** (including CONTENT) and has no rate limit.
- **The sandbox payment action** (`src/app/actions/mock-pay.ts`) lets anyone who knows a `paymentId` approve it while `PAYMENTS_MODE=mock`. That is acceptable for a demo only, and production refuses mock mode unless `DEMO_MODE=true`.
- **The Idram checksum and field names are UNVERIFIED** against the official merchant documentation. Telcell and card acquiring are not implemented.
- **Sessions are not rotated periodically.** There is no "sign out everywhere" except rotating `SESSION_SECRET`.
- **`style-src 'unsafe-inline'` is allowed** because of the dynamic accent colours.
- **Demo mode has no global `noindex` meta tag.** It relies on robots.txt `Disallow: /` and per-product `noindex`.
- **There are no automated dependency or security scans** configured in this folder.
- **The legal texts** (privacy, terms, returns, delivery, payment) are drafts flagged `legalReviewRequired` and need a lawyer.

## Reporting a vulnerability

Do not open a public issue. Email the store owner at the contact address in `/admin/settings` (contacts) or, before launch, the repository owner. Include the URL, the steps and the impact. Please do not access other customers' data or run automated scans against the production store. Payment-provider issues (Idram etc.) should also be reported to the provider.
