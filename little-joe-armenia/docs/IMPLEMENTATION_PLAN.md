# Implementation plan and status

Status key: **done** means implemented in code, with tests where noted. **Partial** means it works, with named gaps. **Not done** means missing, or blocked on something external.

The statuses below were written from reading the code on 2026-09-23. At that time `pnpm test` gave 8 files and 176 tests passing, and `pnpm i18n:check` checked 390 UI keys × 4 locales with 0 problems. Integration and e2e tests exist, but they were **not re-run** for this document.

## Phase 0: Foundation — **done**

- Next.js 16, TypeScript, Tailwind 4, ESLint, and Prisma 7 with the `adapter-pg` client.
- Env validation (`src/lib/env.ts`), the full schema in one migration with CHECK constraints (`prisma/migrations/20260923105152_init`) and an idempotent seed.
- Vitest (unit + integration projects) and Playwright (mobile + desktop).
- Render free blueprint (`render.yaml`).

## Phase 1: i18n and design system — **done / partial**

- Done:
  - locale-prefixed routing with a cookie and Accept-Language redirect (`src/proxy.ts`);
  - typed dictionaries for hy, ru, it and en, checked by `i18n:check`;
  - AMD formatting;
  - self-hosted Manrope + Noto Sans Armenian;
  - tokens and components (see [DESIGN.md](DESIGN.md)).
- Partial:
  - **Armenian and Italian texts were not proofread by native speakers.**
  - The left, right and top iPhone safe areas are not handled.
  - `scripts/i18n-check.ts` mentions a `build:check` script and a `--strict` flag that do not exist.

## Phase 2: Catalogue and product page — **done**

- Catalogue with search, filters and sort as URL state, facets, and the desktop sidebar and mobile sheet.
- Collection and fragrance-family pages.
- Product page with gallery and zoom, buy box, sticky mobile bar, scent profile, facts (VERIFIED only), reviews and similar scents.
- Favourites and compare. Compare is stored in `localStorage` and rendered at `/compare`.
- Scent finder. Its recommendations use only the data that is filled in.
- Placeholder SVG images.

## Phase 3: Cart, checkout, orders — **done**

- Guest and customer carts, merge on sign-in, save for later, promo codes with atomic usage, delivery by region, free-delivery threshold.
- Idempotent checkout with stock reservation; COD flow; order page reachable by access token.
- Order state machine with stock effects and history, and reservation expiry (lazy sweep plus the cron endpoint).
- Tests: `tests/integration/{checkout,inventory}.test.ts`, `tests/unit/{pricing,order-state,checkout-schema}.test.ts` and `tests/e2e/checkout.spec.ts`.

## Phase 4: Payments — **partial**

- **Done:**
  - provider-agnostic pipeline: signature check, idempotent events, amount check, late-payment handling;
  - mock sandbox, end to end;
  - retry after a failure.

  Tests: `tests/integration/payments.test.ts`, `tests/e2e/payments-api.spec.ts`.
- **Partial:** the Idram adapter is written from the public EDP protocol, but it is **UNVERIFIED against Idram's documentation and never run against a real Idram account**.
- **Not done:**
  - the **Telcell** and **bank card (ArCa/vPOS)** adapters are stubs that are always unavailable;
  - refunds through a provider API;
  - no merchant contracts exist yet (see [EXTERNAL_DEPENDENCIES.md](EXTERNAL_DEPENDENCIES.md)).

## Phase 5: Customer accounts — **partial**

- Done:
  - passwordless one-time codes (hashed, 10 minutes, 5 attempts, single use);
  - account page with orders and addresses;
  - email delivery via Resend.
- **Not done:**
  - **no SMS gateway**, so phone sign-in does not work in production;
  - no transactional emails (order confirmation or status changes).

## Phase 6: SEO and analytics — **done / partial**

- Done:
  - canonical and hreflang with x-default = hy;
  - a sitemap of clean URLs only;
  - noindex for filtered and private pages;
  - robots.txt blocking everything in demo mode;
  - JSON-LD for Organization, WebSite, Breadcrumb and Product/Offer, with AggregateRating only from approved reviews;
  - consent-gated GA4, Meta and TikTok with a mapped event set;
  - `purchase` fired once per order.
- Partial:
  - there is no global noindex meta tag in demo mode (robots.txt only);
  - the `purchase` claim is taken even without consent.

## Phase 7: Admin back office — **partial (in progress)**

- Exists:
  - login and roles (OWNER, MANAGER, CONTENT);
  - dashboard;
  - orders (transitions and notes), customers;
  - products (basics, translations, facts with provenance, scent profile, accent, variants, stock adjustment, media by URL);
  - collections, promotions, reviews moderation, home blocks and featured products, CMS pages, brand claims, import review, translations overview;
  - settings (contacts, social, business, SEO, analytics, delivery methods, payment methods);
  - admin users and the audit log.
- **Gaps observed:**
  - no admin screen for **fragrance families** or **scent tags** (tags cannot be created at all);
  - no control to verify `OFFICIAL_DESCRIPTION` or `SCENT_PROFILE` facts, so the official description can never be shown;
  - no upload button, even though `/api/admin/upload` exists;
  - the admin UI is Russian only.
- A JSON catalogue importer exists (`scripts/import-catalog.ts`). It has not been run against real data, and it can silently downgrade a VERIFIED fact to UNVERIFIED when the value is the same but the file says `verified: false`.

## Phase 8: Security hardening — **done / partial**

- Done: nonce CSP and security headers; hashed tokens with `__Host-` cookies; scrypt passwords; a rate limit in Postgres; CSRF layers; upload sniffing; audit log. See [SECURITY.md](../SECURITY.md).
- **Not done:**
  - no 2FA for admin accounts;
  - no WAF or bot protection;
  - no dependency-scanning CI;
  - no cleanup of old `RateLimit`, `AuthChallenge` or session rows.

## Phase 9: Content and data — **not done (blocked)**

- **No official product data.** The official site was unreachable from the build environment. Every seeded value is UNVERIFIED demo data from the task brief or retailer pages (see [PRODUCT_DATA_SOURCES.md](PRODUCT_DATA_SOURCES.md)).
- **No product photos.** All images are generated placeholders.
- **No Armenia assortment, prices or stock.**
- **The legal texts are drafts** and need a lawyer (`legalReviewRequired`).
- **Brand authorisation from Drive Int. AG is not documented**, so no "official" or "authorised" wording is shown.
- **Real delivery zones and prices are not set.**

## Phase 10: Deployment — **partial**

- Done: the free blueprint with migrate + seed on start, the health check and the demo configuration.
- Not done:
  - no confirmed production deploy from this folder is documented here;
  - no backup routine (the free Postgres expires after 30 days);
  - no S3/R2 bucket configured;
  - no custom domain.

## Phase N: Launch — **not done**

Launch checklist. Every item is open:

1. Use a fresh production database. Set `DEMO_MODE=false`, `SEED_DEMO=false`, `PAYMENTS_MODE=live`, `AUTH_CODE_DELIVERY=resend` and `APP_URL` (see [DEPLOYMENT.md](DEPLOYMENT.md#switching-demo--production)).
2. Load the real catalogue with VERIFIED facts, authorised photos, prices and stock.
3. Set up real delivery methods and payment methods.
4. Verify Idram against its docs, register the callback URL, and make one real low-value payment plus a refund.
5. Get the legal pages reviewed and have native speakers proofread hy and it.
6. Configure the S3/R2 bucket, custom domain, Search Console and analytics IDs.
7. Set up a backup routine and, optionally, the external cron for `/api/cron/expire`.
8. Run the e2e suite against the staging deploy, and do a manual test on an iPhone and an Android phone.
