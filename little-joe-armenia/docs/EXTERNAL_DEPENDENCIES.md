# External dependencies (still open)

These credentials, contracts, decisions and data cannot be produced in code. Each row says what the code needs and where it plugs in.

## Payments

| Item | Needed from | What the code needs | Where it plugs in |
|---|---|---|---|
| **Idram merchant account** | Idram | `IDRAM_REC_ACCOUNT`, `IDRAM_SECRET_KEY`, and the payment URL if it differs from `https://banking.idram.am/Payment/GetPayment` | env. Adapter: `src/lib/payments/adapters/idram.ts` |
| **Idram merchant documentation** | Idram (issued with the contract) | Confirm the field names (`EDP_*`), the precheck protocol, the checksum formula and field order, the success-only notification behaviour and the expected `OK` response. **The current adapter is UNVERIFIED** | Adapter + a unit test for the checksum. If the host changes, update CSP `form-action` in `src/proxy.ts` |
| Idram callback URL registration | Owner, in the Idram merchant cabinet | `https://<domain>/api/payments/callback/idram` | — |
| **Telcell merchant contract + API documentation** | Telcell | Shop ID and key, request signing and callback format | Implement `start()`/`parseCallback()` in `src/lib/payments/adapters/pending.ts` (`telcellAdapter`). Nothing else changes |
| **Bank card acquiring** (ArCa / bank vPOS) | An Armenian acquiring bank | Contract, API endpoint, credentials, docs (register order, status check, callback or return flow) | `cardAdapter` in `pending.ts`. Env `CARD_ACQUIRER_*` already exists |
| Refund process | Owner + providers | Decide manual vs API refunds. The app only records the `REFUNDED` status | Admin orders |

## Communication

| Item | Needed from | Code |
|---|---|---|
| **SMS gateway** for phone sign-in codes | An Armenian SMS provider (contract + API) | Add a delivery branch in `deliver()` and allow PHONE in `channelAvailable()` (`src/lib/domain/customer-auth.ts`). Phone sign-in does not work in production without it |
| **Email provider (Resend)** | Resend account + a **verified sending domain** | `RESEND_API_KEY`, `EMAIL_FROM`, `AUTH_CODE_DELIVERY=resend`. Only sign-in codes are emailed; there are no order-confirmation emails yet |

## Infrastructure

| Item | Code |
|---|---|
| **S3-compatible bucket** (for example Cloudflare R2) with public read or a public domain | `STORAGE_DRIVER=s3`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL` (its host is automatically allowed for `next/image`) |
| Custom domain + DNS | `APP_URL` (see [DEPLOYMENT.md](DEPLOYMENT.md#custom-domain)) |
| Database plan decision | The free Postgres expires after 30 days, so either upgrade or dump and recreate (see [DEPLOYMENT.md](DEPLOYMENT.md#backups)) |

## Marketing and SEO

| Item | Where |
|---|---|
| GA4 measurement ID | `/admin/settings` → analytics |
| Meta Pixel ID | same |
| TikTok Pixel ID | same |
| Google Search Console verification token | `GOOGLE_SITE_VERIFICATION` env |
| OG image, title suffix | `/admin/settings` → SEO |
| Social profile URLs | `/admin/settings` → social (only `https://` links are shown) |

## Legal and business

| Item | Where |
|---|---|
| **Legal entity details** (legal name, tax ID/ՀՎՀՀ, address, contacts, hours) | `/admin/settings` → business, contacts |
| **Legal review** of delivery, payment, returns, privacy and terms (all four languages) | `/admin/pages`. These pages carry `legalReviewRequired = true` and show a banner until they are reviewed |
| Consumer-law points: return period, delivery liability, cash-on-delivery terms, data retention | Page texts. The code has no automatic data deletion |
| **Brand authorisation from Drive Int. AG** (written, stating the scope for Armenia and online sales, and the use of the brand name, logo and character artwork) | Then `BRAND_AUTHORIZED=true` **and** `/admin/settings` → business → "brand authorisation confirmed". Until then, no "official" or "authorised" wording appears |

## Catalogue data

| Item | Where |
|---|---|
| **Official product data:** names, article numbers, EAN, format, dimensions, duration, official descriptions, scent family and notes, with sources | `/admin/products/{id}` → facts (VERIFIED with a source). See [PRODUCT_DATA_SOURCES.md](PRODUCT_DATA_SOURCES.md) |
| **Product photos with written usage rights** (PRODUCT, PACKAGING, INSTALLED, DETAIL, LIFESTYLE) | See [ASSETS.md](ASSETS.md) |
| **Armenia assortment**, **retail prices (AMD)**, **opening stock** | Admin products → variants, stock adjustment |
| **Delivery zones, prices, free-delivery thresholds, ETAs** (Yerevan + marzer) | `/admin/settings` → delivery methods. Outside demo they are seeded inactive at 0 AMD |
| Confirmation or rejection of the brand claims (Made in Italy, Swiss company, 70+ countries) | `/admin/claims` |

## Language

| Item | Notes |
|---|---|
| **Native proofreading of Armenian (`hy`)** | UI: `src/i18n/messages/hy.ts`. Content: CMS pages, home blocks, delivery names, family names in the seed. Armenian is the default locale and x-default, so it matters most |
| **Native proofreading of Italian (`it`)** | `src/i18n/messages/it.ts` + the same content |
| Russian and English review | Recommended, lower risk |
