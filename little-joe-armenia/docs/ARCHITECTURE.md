# Architecture

One Next.js 16 app (App Router) with one PostgreSQL database. There are no other services: no Redis, no queue, no cron. This matches the Render free plan.

## Modules

```
src/
  proxy.ts                 locale routing, locale cookie, per-request CSP nonce
  app/
    [locale]/…             storefront (root layout per locale)
    admin/…                back office (separate root layout, Russian UI)
    actions/…              storefront Server Actions (cart, checkout, account, reviews, finder, mock-pay)
    api/payments/callback/[adapter]   provider webhooks
    api/cron/expire        reservation sweep (Bearer CRON_SECRET)
    api/admin/upload       image upload → storage driver
    api/health             DB ping for Render health check
    media/placeholder/[name]          generated SVG placeholders
    sitemap.ts, robots.ts
  lib/
    env.ts                 zod-validated env, server-only
    db.ts                  single PrismaClient (adapter-pg)
    catalog.ts, home.ts    read side of the storefront
    domain/                cart, checkout, orders, order-state, inventory, pricing, delivery, scent, customer-auth, favorites
    payments/              types, registry, service, adapters/{mock,idram,pending}
    security/              crypto, password, session, rate-limit, request
    seo/jsonld.ts          canonical/hreflang + structured data
    storage/index.ts       local | s3 driver
    settings.ts            typed key/value settings
    audit.ts               AuditLog writer
    admin/                 auth (roles), action wrapper, forms, queries
  i18n/                    config, typed dictionaries, provider
  components/              UI (see DESIGN.md)
```

`lib/domain/order-state.ts` and `lib/domain/pricing.ts` are pure (no I/O) and unit-tested. Everything that writes to the database lives in `lib/domain/*`, `lib/payments/service.ts` or admin actions.

## Request flow

1. **`src/proxy.ts`** runs on every non-static request (the matcher excludes `_next/static`, `_next/image`, `favicon.ico`, `fonts/` and router prefetches):
   - `/api/*`, `/_next/*`, `/media/*`, `/uploads/*` and paths with a file extension pass through untouched.
   - Paths not starting with a locale or `admin` get a **307** redirect to `/{locale}{path}`.
   - Otherwise it generates a nonce and sets the `Content-Security-Policy` request and response headers plus `x-nonce`. If the first path segment is a locale that differs from the `lj_locale` cookie, it (re)sets the cookie for one year (`SameSite=Lax`, `Secure` outside dev).
2. **The layout** (`src/app/[locale]/layout.tsx` or `src/app/admin/layout.tsx`) reads `x-nonce`, the shopper identity and settings.
3. **Pages are server components** that read through `lib/catalog.ts` / `lib/home.ts`. Mutations go through Server Actions (`src/app/actions/*`, `src/app/admin/**/actions.ts`), which validate with zod, rate-limit where relevant and call `lib/domain/*`.
4. **Static security headers** come from `next.config.ts` (see [SECURITY.md](../SECURITY.md)).

### Rendering and caching

- **Every storefront page is rendered dynamically on each request (SSR).** The CSP nonce is per request, and the layout reads `headers()` (nonce) and cookies (cart count). `sitemap.ts`, `robots.ts` and `/api/health` are `force-dynamic`.
- **There is no data cache or ISR.** Within a request, `react` `cache()` deduplicates reads (`getProduct`, `getFacets`, `visibleCollections`, `getSetting`).
- **Admin mutations call `revalidatePath("/", "layout")`** (`src/lib/admin/revalidate.ts`), which matters only for client router caches.
- **Fonts are the only long-lived cached assets.** They get `immutable` caching, and so do placeholder SVGs.
- **This costs latency on the free plan.** Each page view queries the database, and a sleeping instance adds a cold start. It is acceptable for a single-brand catalogue, but it is a known cost.

## i18n

| Decision | Implementation |
|---|---|
| All public URLs are locale-prefixed: `/hy`, `/ru`, `/it`, `/en` | `src/i18n/config.ts` (`locales`), `src/lib/paths.ts` |
| `/` (and any unprefixed path) → **307** to the cookie locale, else the `Accept-Language` best match, else `hy` | `proxy.ts` + `negotiateLocale()` (q-values, base-language match) |
| The preference persists | `lj_locale` cookie, set by the proxy whenever a locale URL is visited (so the language switcher needs no extra call) |
| `x-default` hreflang = `/hy/…` | `alternates()` in `src/lib/seo/jsonld.ts`, `src/app/sitemap.ts` |
| Unknown locale segment → 404 | `resolveLocale()` in `src/i18n/server.ts`. Unknown sub-paths hit `src/app/[locale]/[...rest]/page.tsx` → `notFound()` |
| UI strings are typed dictionaries | `src/i18n/messages/{hy,ru,it,en}.ts`. `Messages` is derived from `en`, so a missing key fails `tsc` |
| Translation gate | `pnpm i18n:check` (`scripts/i18n-check.ts`): same key set, no empty strings, identical `{placeholder}` sets, plus DB content completeness when a DB is reachable. Exits non-zero on any problem |
| Interpolation | `fmt()` inserts values as text, never HTML |
| Money | `formatAmd()` in `src/lib/money.ts`, hand-written so server and browser produce identical output: `hy`/`ru` `12 500 ֏`, `it` `12.500 ֏`, `en` `֏12,500` |
| `<html lang>` | `hy-AM`, `ru-AM`, `it-IT`, `en-AM`. `og:locale` `hy_AM`, `ru_RU`, `it_IT`, `en_US` |
| Admin | Russian only, not localised |

## SEO

- **Every page sets a canonical URL and hreflang alternates.** Indexable pages call `alternates(locale, pathFor)`, which produces an absolute canonical on `APP_URL`, an alternate for all four locales and `x-default`.
- **The sitemap lists only clean URLs** (`src/app/sitemap.ts`): home, `/shop`, `/scent-finder`, collections and families with visible non-demo products, non-demo products and CMS pages, each with all four alternates. Filter, search and sort URLs are never listed, and demo products are never listed, even in demo mode.
- **Filtered catalogue pages are `noindex, follow` and canonicalise to the clean `/shop`** (`isFiltered()` + `generateMetadata` in `src/app/[locale]/shop/page.tsx`). robots.txt deliberately leaves them crawlable so crawlers can see the noindex.
- **Private pages are `noindex`:** cart, checkout, account, sign-in, order, favourites, compare and the sandbox payment page. Admin gets `X-Robots-Tag: noindex, nofollow` (`next.config.ts`) and `robots` metadata.
- **Demo deployments are kept out of search engines.** With `DEMO_MODE=true`, robots.txt is `Disallow: /` for all agents (`src/app/robots.ts`), and each demo product page is also `noindex` (`product.isDemo`). There is **no global `noindex` meta tag** in demo mode, so robots.txt is the main barrier.
- **In production, robots.txt** disallows `/admin`, `/api/` and the private pages above, and points to `/sitemap.xml`.
- **JSON-LD** (`src/lib/seo/jsonld.ts`, rendered by `src/components/ui/json-ld.tsx`, which escapes `<`, U+2028 and U+2029):

  | Type | Where | Notes |
  |---|---|---|
  | `Organization` | Every page | `STORE_NAME`, `areaServed: Armenia` |
  | `WebSite` | Every page | With `SearchAction` → `/{locale}/shop?q=` |
  | `BreadcrumbList` | Catalogue, product | |
  | `Product` + `Offer` | Product page | `priceCurrency: AMD`, In/OutOfStock. `gtin13` and `mpn` only from VERIFIED facts. `image` only from `AUTHORIZED` media |
  | `AggregateRating` + `Review` | Product page | Only when there is at least one **APPROVED** review |

- **Search Console verification** uses `GOOGLE_SITE_VERIFICATION` → `<meta name="google-site-verification">`.

## Guest identity and cart

- **Guests are identified by a random token.** The `lj_guest` cookie holds a random 256-bit token, and only its HMAC is stored (`Guest.tokenHash`). The cookie is created lazily by `ensureGuestId()` on the first cart or favourite write, is `httpOnly` and `SameSite=Lax`, and lives 180 days (`src/lib/security/session.ts`).
- **A signed-in customer takes precedence over the guest** (`shopper()`). On sign-in, `mergeGuestIntoCustomer()` moves cart lines (quantities add up, capped at 20), the promo code and favourites into the customer's records, then deletes the guest cart.
- **Each owner has at most one cart.** `Cart` has unique `customerId`/`guestId` and a CHECK that at least one is set. `CartItem` is unique per `(cart, variant)` and has a quantity CHECK of 1–99. The app caps quantities at `MAX_QTY = 20` and at available stock.
- **The cart price is always recomputed on the server** (`viewCart()` → `computeTotals()` in `src/lib/domain/pricing.ts`). "Save for later" lines are excluded from totals.

## Checkout flow

`placeOrderAction` (`src/app/actions/checkout.ts`) → `placeOrder()` (`src/lib/domain/checkout.ts`):

1. **Validate the form** with `checkoutSchema` (`src/lib/validation/checkout.ts`): Armenian phone normalised to `+374XXXXXXXX`, region ∈ ISO 3166-2:AM codes, lengths, and `idempotencyKey` (16–64 chars, generated in the browser).
2. **Rate-limit** with `checkout` (10 per 10 minutes per IP).
3. **Run the lazy sweep** `expireReservations()` (errors ignored).
4. **Idempotency:** if an order with that `idempotencyKey` exists, return it.
5. **Re-read and re-price everything from the database:**
   - the product must still be visible, the variant active and priced;
   - the delivery method must be active for the region;
   - the payment method must be enabled by the admin **and** have an adapter (COD always has one);
   - the promo code is evaluated.
6. **One transaction:**
   - create the `Order` + `OrderItem` snapshot + the first history row;
   - reserve stock per line **in `variantId` order**;
   - consume the promo usage with a conditional `UPDATE … WHERE usedCount < usageLimit` + `PromotionRedemption`;
   - delete the purchased cart lines and optionally save the address.

   `InsufficientStockError` → `OUT_OF_STOCK`, promo exhausted → `PROMO_INVALID`, and a concurrent duplicate key (P2002) → the existing order.
7. **Start the order:**
   - COD: status `PENDING`, no expiry, go straight to the order page.
   - Online: status `AWAITING_PAYMENT`, `reservationExpiresAt = now + RESERVATION_TTL_MINUTES` (default 30), then `startPayment()` → redirect or auto-POST form.
8. **The order page** `/{locale}/order/{number}?t={token}` needs either the access token or the owning customer session. The token is `HMAC(SESSION_SECRET, idempotencyKey)`, and only its hash is stored (`Order.accessTokenHash`).
9. **Retry:** `retryPaymentAction` moves `PAYMENT_FAILED → AWAITING_PAYMENT`, which reserves stock again, then starts a new `Payment`.

## Order state machine

`src/lib/domain/order-state.ts` is the single source of truth for which transition is allowed and who may make it. `transitionOrder()` (`src/lib/domain/orders.ts`) locks the order row (`SELECT … FOR UPDATE`), checks `canTransition`, applies the stock effect, writes `OrderStatusHistory` and, on cancel, returns the promo usage.

| From | To | Allowed actor |
|---|---|---|
| PENDING (COD start) | CONFIRMED | admin |
| PENDING | CANCELLED | admin, system |
| AWAITING_PAYMENT (online start) | PAID | payment |
| AWAITING_PAYMENT | PAYMENT_FAILED | payment, system |
| AWAITING_PAYMENT | CANCELLED | admin, system |
| PAID | CONFIRMED | admin, system |
| PAID | REFUNDED | admin |
| PAYMENT_FAILED | PAID (late success) | payment |
| PAYMENT_FAILED | AWAITING_PAYMENT (retry) | system |
| PAYMENT_FAILED | CANCELLED | admin, system |
| CONFIRMED | PACKING | admin |
| CONFIRMED | CANCELLED | admin |
| PACKING | SHIPPED | admin |
| PACKING | CANCELLED | admin |
| SHIPPED | DELIVERED | admin |
| DELIVERED | REFUNDED | admin |
| CANCELLED, REFUNDED | — (terminal) | |

The stock effect depends on `Order.stockState` (`RESERVED | COMMITTED | RELEASED`):

| stockState | Entering | Effect |
|---|---|---|
| RESERVED | CONFIRMED or PAID | COMMIT (reserved → sold) |
| RESERVED | CANCELLED or PAYMENT_FAILED | RELEASE |
| RELEASED | PAID | COMMIT via `sellFromAvailable` (late payment) |
| RELEASED | AWAITING_PAYMENT | RESERVE (retry) |
| COMMITTED | CANCELLED | RESTOCK (`CANCEL_RETURN`) |
| COMMITTED | REFUNDED | none. Returned goods are restocked by an explicit `RETURN_TO_STOCK` adjustment |

Other rules:
- Admins cannot set `PAID` or `PAYMENT_FAILED`. Only verified provider callbacks can.
- A COD order's `paymentStatus` becomes `SUCCEEDED` when an admin marks it `DELIVERED` (`adminTransition`).
- `PAYMENT_FAILED` orders untouched for 24 hours are auto-cancelled by the sweep.

## Payments pipeline

### Adapter contract (`src/lib/payments/types.ts`)

Each adapter implements `id`, `provider`, `isConfigured()`, `start(input) → {redirect url} | {form action + fields}`, `parseCallback() → precheck | result | invalid` and `ack(accepted)`. Adapters never touch the database: all state changes happen in `src/lib/payments/service.ts`.

### Registry (`src/lib/payments/registry.ts`)

- **`PAYMENTS_MODE=mock` sends every online provider to the sandbox adapter.** In production, `env.ts` refuses mock mode unless `DEMO_MODE=true`.
- **`PAYMENTS_MODE=live` uses only adapters that report `isConfigured()`.** At checkout, a method is offered only when the admin has enabled it (`PaymentMethodSetting`) **and** an adapter exists.

| Adapter | Status |
|---|---|
| `mock` | Complete. `start()` redirects to `/{locale}/pay/mock/{paymentId}`. The sandbox page's Approve/Decline builds an HMAC-signed JSON callback (`x-mock-signature`, key `MOCK_PAYMENT_SECRET`) and sends it through the same `handleCallback()` as the webhook route |
| `idram` | Implemented from the publicly known EDP protocol. **UNVERIFIED against Idram's current merchant documentation.** Form POST to `IDRAM_PAYMENT_URL` with `EDP_LANGUAGE/REC_ACCOUNT/DESCRIPTION/AMOUNT/BILL_NO`. The precheck (`EDP_PRECHECK=YES`) answers `OK` only if the payment exists, the amount matches and the order is `AWAITING_PAYMENT`. The result is verified with `MD5(REC_ACCOUNT:AMOUNT:SECRET_KEY:BILL_NO:PAYER_ACCOUNT:TRANS_ID:TRANS_DATE)` in uppercase and a constant-time compare, and `EDP_TRANS_ID` is the event id |
| `telcell`, `card` | **Stubs** (`adapters/pending.ts`). `isConfigured()` always returns false, even with credentials set; `start()` throws; callbacks are invalid (501). The admin settings page shows credential presence via `credentialStatus()` |

### Callback handling (`POST /api/payments/callback/{adapter}` → `handleCallback`)

1. **Route checks:** the adapter id must match `^[a-z]{2,20}$` (otherwise 404), and the `webhook` rate limit applies (120 per minute per adapter+IP). The body must be 64 KB or less.
2. **Invalid parse:** stored as a `PaymentEvent` with a random id, then rejected.
3. **Precheck:** answered without writing.
4. **Bad signature:** stored under a random `forged:*` event id, so a forged request can never "use up" a real provider event id. It is audited (`payment.callback.bad_signature`) and rejected.
5. **Unknown payment or wrong adapter:** stored and rejected.
6. **Amount check:** the callback amount must equal `Payment.amountAmd`. On mismatch it is stored, audited (`payment.callback.amount_mismatch`) and rejected.
7. **One transaction.** The first write is `PaymentEvent(adapter, eventId)`, which has a **unique** constraint. A duplicate or concurrent delivery hits P2002 and is acknowledged as `DUPLICATE` without side effects. The transaction then locks the `Payment` row:
   - SUCCEEDED + payment already succeeded → `DUPLICATE`.
   - SUCCEEDED otherwise → Payment `SUCCEEDED`, order → `PAID` (actor `payment`).
   - FAILED after success → `IGNORED_STALE` (a success is never un-paid).
   - FAILED otherwise → Payment `FAILED`, and the order goes to `PAYMENT_FAILED` if it is still `AWAITING_PAYMENT`.
8. **Late payments:**
   - **`PAID_STOCK_UNAVAILABLE`:** the reservation lapsed (the order is `PAYMENT_FAILED`, stock released) and the stock is gone. The order is still set to `PAID` / `SUCCEEDED`, with a history note "STOCK UNAVAILABLE … resolve manually" and an audit entry `payment.late_without_stock`.
   - **`PAID_ORDER_CLOSED`:** a verified success arrives for an order that cannot become PAID (e.g. `CANCELLED`). The payment is recorded as `SUCCEEDED`, the order's `paymentStatus` becomes `SUCCEEDED`, an `OrderNote` "REFUND REQUIRED" is added and it is audited as `payment.paid_on_closed_order`. The order status itself is not changed.
9. **The browser return URL never changes state.** The order page only reads it, and `OrderRefresh` polls while the order is awaiting payment.

The integration tests are in `tests/integration/payments.test.ts` (16 cases).

## Inventory & concurrency

`src/lib/domain/inventory.ts`:

- **Each stock change is one conditional atomic `UPDATE`**, run through `$queryRaw` as a tagged, parameterised template with `RETURNING`:

  ```sql
  UPDATE "Variant" SET "reserved" = "reserved" + $q
  WHERE "id" = $id AND "isActive" = true AND "stockOnHand" - "reserved" >= $q
  RETURNING "stockOnHand", "reserved"
  ```

  Zero rows means `InsufficientStockError`. There is no read-then-write window: Postgres row-locks the variant, and a concurrent second writer re-evaluates the `WHERE` against the committed row.
- **Each operation has its own condition:**
  - `release`, `commitReserved`: require `reserved ≥ q`.
  - `sellFromAvailable`: requires available ≥ q.
  - `restock`: unconditional.
  - `adjust` (admin): `stockOnHand + delta ≥ reserved`, so stock never drops below what is reserved.
- **Row locks:** `transitionOrder` locks the `Order` row, and the payment service locks the `Payment` row, so a webhook and an admin click on the same order are serialised.
- **Lock order:** checkout reserves variants sorted by `variantId`, and `transitionOrder` iterates order items `orderBy variantId asc`. Every multi-variant transaction therefore takes locks in the same order, which avoids deadlocks.
- **CHECK constraints are the last line of defence** (`migration.sql`): `stockOnHand ≥ 0`, `reserved ≥ 0` and `reserved ≤ stockOnHand`, plus quantity, price, totals, rating and promo-usage checks.
- **Ledger:** every successful write appends an `InventoryMovement` in the same transaction, recording deltas, resulting values, order id, actor and note. The seed writes opening stock as `PURCHASE`, so the ledger reconciles from the start.
- **Reservation TTL:** online orders hold stock until `reservationExpiresAt`. `expireReservations()` moves up to 50 expired `AWAITING_PAYMENT` orders to `PAYMENT_FAILED` (stock released), and cancels up to 50 orders stuck in `PAYMENT_FAILED` for more than 24 hours (promo usage returned). A `TransitionError` from a concurrent worker is ignored. It runs:
  - lazily at the start of every checkout (`placeOrderAction`);
  - on admin requests (`src/lib/admin/queries.ts`);
  - on `POST /api/cron/expire` with `Authorization: Bearer $CRON_SECRET` (constant-time compare). Render free has no cron, so an external scheduler is optional (see [DEPLOYMENT.md](DEPLOYMENT.md#optional-free-external-cron)).
- **Tests:** concurrency and oversell are covered in `tests/integration/inventory.test.ts` and `checkout.test.ts`.

## Analytics

- **Tags load only after explicit consent.** `src/components/analytics/analytics.tsx` loads GA4, Meta Pixel and TikTok Pixel only when the ID is set in `/admin/settings` (analytics) **and** the visitor accepted the banner. Consent is stored in `localStorage` under `lj_consent`. With no IDs configured, there is no banner and nothing loads. Scripts carry the CSP nonce.
- **`track()` sends nothing without consent** (`src/components/analytics/track.ts`). It uses GA4 event names and maps them to Meta and TikTok events:

  | GA4 | Meta | TikTok | Fired in |
  |---|---|---|---|
  | `view_item_list` | — | — | shop, collection |
  | `view_item` | ViewContent | ViewContent | product page |
  | `search` | Search | Search | `SearchBox` |
  | `add_to_cart` | AddToCart | AddToCart | `BuyBox`, `QuickAdd` |
  | `remove_from_cart` | — | — | cart |
  | `begin_checkout` | InitiateCheckout | InitiateCheckout | checkout |
  | `add_payment_info` | AddPaymentInfo | AddPaymentInfo | checkout submit |
  | `purchase` | Purchase | CompletePayment | order page |

- **`purchase` fires at most once per order** (`src/app/[locale]/order/[number]/page.tsx`):
  - It fires only for statuses that mean a real sale: PENDING (COD) and PAID onward.
  - The server makes an atomic claim `UPDATE Order SET purchaseTrackedAt = now() WHERE id = … AND purchaseTrackedAt IS NULL`, and only the request that wins renders `TrackOnMount`.
  - The client also guards with the `localStorage` key `lj_purchase_{number}`.
  - Caveat: the claim is made even if the visitor has not consented, so a later consent does not replay the purchase.

## Media storage

`src/lib/storage/index.ts` defines `StorageDriver.put(key, bytes, contentType) → {url}`:
- **`local`** writes to `public/uploads/…`. It is for development only, because Render's disk is ephemeral.
- **`s3`** does a SigV4 `PUT` via `aws4fetch` to `S3_ENDPOINT/S3_BUCKET/key` with immutable cache headers and returns `S3_PUBLIC_BASE_URL/key`. It works with Cloudflare R2 and other S3-compatible stores.

`MediaAsset` stores `storageKey` + `url`, so changing the driver or replacing images never touches page code. `next/image` accepts remote hosts `res.cloudinary.com` and the `S3_PUBLIC_BASE_URL` host only (`next.config.ts`). See [ASSETS.md](ASSETS.md).

## Rate limiting

`src/lib/security/rate-limit.ts` implements a Postgres fixed window. One atomic `INSERT … ON CONFLICT DO UPDATE` per hit on `RateLimit(key, windowStart, count)` resets the counter when the window is older than `windowMs`. It works across instances without Redis. The limits are in [SECURITY.md](../SECURITY.md#rate-limits). Old `RateLimit` rows are never purged. The table grows by one row per key and is bounded by distinct IPs and targets.

## Admin

- **`/admin` has its own root layout with a Russian UI.** Areas and their role gates are in `AREA_ROLES` (`src/lib/admin/auth.ts`): dashboard, orders, customers, products (content vs `productCommerce` for price/stock), collections, promotions, reviews, home, pages, brand claims, import review, translations, settings (contacts, social, business, SEO, analytics, delivery methods, payment methods), admin users and audit log.
- **The layout is not a security boundary.** Every page and every admin Server Action calls `requireAdmin(area)`. `adminAction()` (`src/lib/admin/action.ts`) wraps actions: auth first, generic errors, then revalidate.
- **Every mutation writes to `AuditLog` in the same transaction.**
- **The back office is still being finished.** Known gaps in what exists:
  - no admin screen for fragrance families or scent tags;
  - no control to verify `OFFICIAL_DESCRIPTION` / `SCENT_PROFILE` facts;
  - the image upload endpoint `/api/admin/upload` exists, but no admin form calls it (media are added by URL).
