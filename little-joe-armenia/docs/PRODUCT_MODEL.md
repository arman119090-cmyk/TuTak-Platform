# Product data model

Source: `prisma/schema.prisma`, `prisma/migrations/20260923105152_init/migration.sql` and `src/lib/catalog.ts`.

## Principle: facts vs commerce

The model keeps two kinds of data strictly apart:

| Kind | Examples | Where | Who is authoritative |
|---|---|---|---|
| **Manufacturer facts** | name, collection, fragrance, colour, article number, EAN, duration, dimensions, official description, scent profile, format | `Product` columns + `ProductTranslation.officialDescription`, each traced in `ProductFact` | Drive Int. AG (manufacturer) or the official distributor |
| **Armenia commercial data** | price, compare-at price, stock, reservations, featured/bestseller/new/gift flags, sort order, publish status, accent colour | `Product` flags, `Variant`, `InventoryMovement` | The shop owner |

A fact is never derived from commercial data, and commercial data is never presented as a manufacturer claim.

## Catalogue entities

| Model | Purpose | Notes |
|---|---|---|
| `Collection` | Little Joe, Little Joya, … | Has its own provenance: `verification`, `sourceUrl`, `sourceType`, `verifiedAt`. `accentColor` is a UI choice. The storefront only lists collections that have visible products (`visibleCollections`) |
| `FragranceFamily` | The shop's own taxonomy (fresh, sweet, fruity, woody, floral) | Not a manufacturer claim (`prisma/seed-data/catalog.ts` header) |
| `ScentTag` + `ProductScentTag` | Free-form scent tags | The seed creates none, and there is no admin screen to create tags |
| `Product` | One scent/SKU family | `status` DRAFT/ACTIVE/ARCHIVED. `isDemo` hides the product unless `DEMO_MODE=true` |
| `Variant` | Sellable unit (SKU, price, stock) | `priceAmd` is integer AMD, and `priceIsDemo` shows a DEMO label |
| `MediaAsset` | Images with rights | See [ASSETS.md](ASSETS.md) |
| `BrandClaim` | "Made in Italy", "Swiss company", … | Four-locale title/body, with provenance |
| `ImportReview` | Queue of unconfirmed values | Accepting a row records a decision only and does not write data (`src/app/admin/imports/actions.ts`) |

### Visibility

Every storefront query uses `visibleProductWhere()` (`src/lib/catalog.ts`): `status = ACTIVE`, the collection is visible, and `isDemo = false` unless `DEMO_MODE`. The sitemap additionally drops all `isDemo` products, even in demo mode (`src/app/sitemap.ts`). Products without a priced active variant are filtered out of listings (`priceAmd !== null`).

## ProductFact: per-field provenance

One row per `(productId, field)` (unique). `field` is a `FactField`: `NAME, COLLECTION, FRAGRANCE, COLOR, ARTICLE_NUMBER, EAN, DURATION, DIMENSIONS, OFFICIAL_DESCRIPTION, SCENT_PROFILE, FORMAT`.

| Column | Meaning |
|---|---|
| `value` | The value as recorded at trace time (string) |
| `sourceType` | `MANUFACTURER_WEBSITE`, `MANUFACTURER_CATALOG_PDF`, `MANUFACTURER_PRICE_LIST`, `DISTRIBUTOR_DOCUMENT`, `PACKAGING`, `RETAILER_LISTING`, `TASK_BRIEF`, `INTERNAL` |
| `sourceUrl` | Link to the source, when there is one |
| `verification` | `UNVERIFIED`, `PENDING_REVIEW`, `VERIFIED`, `REJECTED` |
| `verifiedAt`, `verifiedBy` | Stamped when set to VERIFIED. Kept when value and source are unchanged, reset otherwise |
| `note` | Free text (why, caveats) |

Admin rules (`saveProductFacts` in `src/app/admin/products/actions.ts`):
- Setting `VERIFIED` requires a `sourceType`, and the value must not be empty.
- An EAN must be 8 or 13 digits with a valid check digit.
- `durationDays` must be between 1 and 365.
- Leaving the source empty deletes the trace row. The value stays on `Product` but is untraced and therefore never shown.
- Every save is written to `AuditLog` (`product.facts`).

**Limitation:** the admin facts form covers `ARTICLE_NUMBER`, `EAN`, `DURATION`, `DIMENSIONS`, `COLOR` and `FORMAT` only. There is no admin control yet to mark `OFFICIAL_DESCRIPTION` or `SCENT_PROFILE` as VERIFIED. As a result, the official description can currently never appear on the storefront without a direct database edit.

## "Shown only when VERIFIED"

Implemented in `getProduct()` (`src/lib/catalog.ts`) and the product page (`src/app/[locale]/p/[slug]/page.tsx`):

| Data | Rendered when | Also affects |
|---|---|---|
| EAN | `ProductFact(EAN).verification = VERIFIED` | JSON-LD `gtin13` (only when 13 digits) |
| Article number | `ARTICLE_NUMBER` VERIFIED | JSON-LD `mpn` |
| Duration (days) | `DURATION` VERIFIED | — |
| Dimensions | `DIMENSIONS` VERIFIED | — |
| Official description | `OFFICIAL_DESCRIPTION` VERIFIED | JSON-LD `description` fallback |
| Brand claims | `BrandClaim.verification = VERIFIED` (a source URL is required to set it) | Home "brand story" block (`verifiedBrandClaims`, `src/lib/home.ts`) |
| "Authorised dealer" wording | `BRAND_AUTHORIZED=true` **and** admin setting `business.brandAuthorizationConfirmed` | Footer (`src/components/layout/site-footer.tsx`) |

The following are shown without a VERIFIED fact, because they are either commercial or labelled:

- Collection, family, format and SKU in the facts table.
- Scent profile bars. They appear when the axes are non-null, with a "not confirmed" note unless `SCENT_PROFILE` is VERIFIED.
- `profileDescription` and `usage` text written by the shop.

If a product has no VERIFIED facts at all, the facts table shows a "not confirmed" notice.

## Scent metadata

On `Product`, all nullable. `null` means "not confirmed" and is never treated as zero:

| Field | Range (DB CHECK) |
|---|---|
| `familyId` | FK to `FragranceFamily` |
| `intensity` | 1–5 (`product_intensity_range`) |
| `sweetness`, `freshness`, `woodiness`, `fruity`, `floral` | 0–5 (`product_scent_axes_range`) |
| `scentTags` | via `ProductScentTag` |

`src/lib/domain/scent.ts` scores only the dimensions that are filled in:
- `hasProfile()` is false with no family and no axis, so the finder skips that product.
- `similarity()` returns `null` when two products share no data, so "similar scents" stays empty rather than invented.

## Variants and stock

- **Money columns are integer AMD.** `priceAmd` and `compareAtAmd` are nullable. A variant with `priceAmd = null` is not purchasable. The CHECK is `priceAmd IS NULL OR priceAmd > 0`.
- **Stock is tracked in two columns:** `stockOnHand` (physically in stock) and `reserved` (held by open orders). Available = `stockOnHand − reserved` (`available()` in `src/lib/domain/inventory.ts`).
- **The database enforces the invariants with CHECK constraints:** `stockOnHand ≥ 0`, `reserved ≥ 0`, `reserved ≤ stockOnHand`.
- **Every stock change also writes a ledger row.** `InventoryMovement` records type (`PURCHASE, SALE, RESERVE, RELEASE, CANCEL_RETURN, MANUAL_ADJUSTMENT, REFUND, RETURN_TO_STOCK`), deltas, resulting values, order, actor and note. The details are in [ARCHITECTURE.md § Inventory](ARCHITECTURE.md#inventory--concurrency).
- **`lowStockAt` (default 3)** controls the "only N left" hint on cards.

## Media rights

`MediaAsset.rights`: `PLACEHOLDER` (generated illustration), `UNCONFIRMED` (a real photo with unclear rights) or `AUTHORIZED`. Anything other than `AUTHORIZED` is flagged `isPlaceholder` in the DTO. It gets a "placeholder image" caption in the gallery, and it is excluded from JSON-LD `image` and the home lifestyle section. Per-locale alt text lives in `altHy/altRu/altIt/altEn` and falls back to the product name. Kinds: `PRODUCT, PACKAGING, INSTALLED, DETAIL, LIFESTYLE, HERO`.

## Brand claims

`BrandClaim` has `key`, provenance (`sourceUrl`, `sourceType`, `verification`, `verifiedAt`) and title/body in four locales. The seed stores three claims found on a retailer page (`made-in-italy`, `swiss-company`, `70-countries`) as `UNVERIFIED` + `RETAILER_LISTING`, so none of them render. Admin: `/admin/claims`. VERIFIED requires a source URL (`src/app/admin/claims/actions.ts`).

## Import review

`ImportReview` rows hold `batch, entity, entityKey, field, current, proposed, sourceUrl, sourceType, reason, status (OPEN/ACCEPTED/REJECTED), resolvedBy/At`. They are created by the seed (see [PRODUCT_DATA_SOURCES.md](PRODUCT_DATA_SOURCES.md)). Resolving a row in `/admin/imports` only records the decision, and the admin applies any value manually in the product editor. The rule is that no import silently overwrites a VERIFIED fact. **There is no importer yet:** `pnpm catalog:import` points to a missing `scripts/import-catalog.ts`.

## Translations

All customer-facing catalogue text is in `*Translation` tables keyed `@@unique([entityId, locale])`, `locale ∈ {hy, ru, it, en}`:

| Table | Fields |
|---|---|
| `ProductTranslation` | `name`, `scentDescriptor`, `profileDescription`, `officialDescription`, `usage`, `seoTitle`, `seoDescription` |
| `CollectionTranslation` | `name`, `description`, `seoTitle`, `seoDescription` |
| `FragranceFamilyTranslation` | `name`, `description` |
| `ScentTagTranslation` | `name` |
| `PageTranslation` | `title`, `body` (plain text, never HTML), `seoDescription` |

Smaller entities use locale columns instead of a table: `BrandClaim`, `HomeBlock`, `DeliveryMethod` (`nameHy…`, `etaHy…`) and `MediaAsset` (`altHy…`).

Fallback: `pickT()` picks the requested locale, then `hy`, then `en`, then any row. `pnpm i18n:check` reports ACTIVE non-demo products, visible collections, families and pages that miss a locale.

## Orders snapshot

`Order` copies the customer, address, delivery method name and totals at order time. `OrderItem` copies `productSlug`, `name`, `sku`, `unitAmd`, `quantity` and `lineAmd`. Later catalogue edits therefore never change past orders.
