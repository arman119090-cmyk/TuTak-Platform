# Product data sources

**Summary: every product value in this repository is unverified.** The catalogue is a demo that exercises the store. It is not the Armenia assortment.

## What happened

- **The official manufacturer site could not be reached.** `little-joe.com` (Drive Int. AG) was blocked from the build environment by its egress proxy, so no manufacturer page, catalogue PDF or packaging data was read.
- **No Armenia assortment was supplied.** There is no list of which scents, prices and stock will actually be sold.
- **The fallback was the task brief and a few public retailer pages.** Scent names and collection names were taken from the task brief and from third-party retailer listings. These are secondary sources: they may be outdated, US-market-specific or simply wrong.
- **Everything is recorded, not rendered.** Every value is stored with its source and `verification = UNVERIFIED`. Unverified manufacturer facts are **not rendered** (see [PRODUCT_MODEL.md](PRODUCT_MODEL.md#shown-only-when-verified)).

## What the seed creates

`prisma/seed.ts` + `prisma/seed-data/catalog.ts`.

### Always (reference data, `pnpm db:seed`)

| Data | Source / status |
|---|---|
| Fragrance families `fresh`, `sweet`, `fruity`, `woody`, `floral` with names in four locales | The **shop's own taxonomy**, not a manufacturer claim |
| Collections `little-joe`, `little-joya`, `little-pup`, `little-duck` | `RETAILER_LISTING` https://stonercarcare.com/collections/little-joe, `UNVERIFIED`. Only `little-joe` has products; the others are hidden on the storefront because they are empty |
| Brand claims `made-in-italy`, `swiss-company` (Drive Int. AG, Switzerland), `70-countries` | `RETAILER_LISTING` stonercarcare.com, `UNVERIFIED`. **Not rendered** |
| CMS pages delivery, payment, returns, faq, privacy, terms, contact, about (`prisma/seed-data/pages.ts`) | Drafts written for this project. delivery, payment, returns, privacy and terms have `legalReviewRequired = true` and show a "legal review" banner. faq, contact and about have `false` |
| Delivery methods `yerevan-courier` (ER), `armenia-regions` (ten marzer) | **Demo:** active, 1 000 / 2 000 AMD, free from 10 000 / 15 000 AMD. **Non-demo:** created **inactive with price 0**, and must be set in admin |
| Payment methods | COD enabled. Idram, Telcell and card enabled only in demo (sandbox) |
| HERO home block | Copy written for this project |
| Import-review batch `seed-initial` | See below |

### Demo only (`SEED_DEMO=true`, `Product.isDemo = true`, visible only with `DEMO_MODE=true`)

All demo products are created as `Little Joe <scent>` in collection `little-joe`, format `VENT_CLIP`. Each has a demo price (`priceIsDemo`, shown with a DEMO label), arbitrary demo stock and four generated placeholder images (`rights = PLACEHOLDER`).

| Slug | Scent name | Name source | Accent source | Family (placeholder) | Demo price / stock |
|---|---|---|---|---|---|
| `little-joe-new-car` | New Car | `RETAILER_LISTING` https://www.popshelf.com/p/little-joe-car-air-freshener-new-car-scent | task brief | fresh | 2 900 / 40 |
| `little-joe-vanilla` | Vanilla | `TASK_BRIEF` (no URL) | task brief | sweet | 2 900 / 25 |
| `little-joe-cherry` | Cherry | `TASK_BRIEF` | task brief | fruity | 2 900 / 2 |
| `little-joe-black-velvet` | Black Velvet | `TASK_BRIEF` | task brief | — (none) | 3 200 / 0 (sold out) |
| `little-joe-fresh-mint` | Fresh Mint | `TASK_BRIEF` | task brief | fresh | 2 900 / 18 |
| `little-joe-ocean-splash` | Ocean Splash | `RETAILER_LISTING` https://www.walmart.com/ip/892299258 | internal | fresh | 2 500 / 30 |
| `little-joe-blue-raspberry` | Blue Raspberry | `RETAILER_LISTING` https://stonercarcare.com/collections/little-joe | internal | fruity | 2 500 / 12 |
| `little-joe-orange-creamsicle` | Orange Creamsicle | `RETAILER_LISTING` stonercarcare.com | internal | sweet | 2 500 / 9 |
| `little-joe-green-apple` | Green Apple | `RETAILER_LISTING` stonercarcare.com | internal | fruity | 2 500 / 22 |

The demo seed also creates promotions `WELCOME10` (10 %, min 5 000 AMD) and `MINUS500` (−500 AMD, min 3 000 AMD, one use).

The `ProductFact` rows written per demo product are all `UNVERIFIED`:

| Field | Value | sourceType / URL |
|---|---|---|
| `NAME` | the scent name | as in the table above |
| `COLLECTION` | Little Joe | `RETAILER_LISTING` stonercarcare.com |
| `FORMAT` | VENT_CLIP | `RETAILER_LISTING` stonercarcare.com ("clips onto an air vent") |
| `SCENT_PROFILE` | the family slug | `INTERNAL`: "derived from the scent name only. Not manufacturer data" |

**Not seeded on purpose:** EAN, article number, duration, dimensions, official descriptions, scent notes, intensity and the scent axes. Colour names are not seeded either. Accent colours are UI choices.

### Import-review queue

| Batch | Entity / key | Field | Proposed | Source | Reason |
|---|---|---|---|---|---|
| `seed-initial` | Product `*` | `durationDays` | 45 | stonercarcare.com | Retailer claims "up to 45 days". Not from the manufacturer; it must be confirmed per product |
| `seed-initial` | Product `little-joe-ocean-splash` | `articleNumber` | 96403 | walmart.com/ip/892299258 | The number appears in a Walmart title, and it is unclear whether it is the manufacturer article number |
| `seed-initial` | Collection `*` | `assortment` | — | — | The approved Armenia assortment matrix was not supplied |
| `seed-demo` | each demo product | `*` | — | as the name source | Name, collection, format, family, price and stock are unconfirmed placeholders |

## What is UNVERIFIED

**Everything.** Scent names, which scents exist, collection membership, format, fragrance family, colour, all brand claims, prices, stock and images. Even the product name pattern `Little Joe <scent>` is a guess.

## How to verify a value

1. Get the value from a primary source: the manufacturer website, catalogue PDF, price list, a distributor document or the physical packaging.
2. **Product facts:** `/admin/products/{id}` → "Manufacturer facts".
   - Enter the value and choose the **source type**.
   - Paste the **source URL** (or describe the document in the note).
   - Set the status to **VERIFIED** and save. `verifiedAt` and `verifiedBy` are stamped, and the save is audited.
   - The value then appears on the product page and, for EAN and article number, in JSON-LD.

   The form covers article number, EAN, duration, dimensions, colour and format. There is no control yet for official description or scent profile verification (see [PRODUCT_MODEL.md](PRODUCT_MODEL.md#productfact-per-field-provenance)).
3. **Brand claims:** `/admin/claims/{id}` → set VERIFIED. A source URL is required. The claim then appears in the home brand-story block.
4. **Import-review rows:** `/admin/imports` → Accept or Reject. Accepting **does not** apply the value; enter it in the product editor as in step 2.
5. **Replace the demo catalogue** with real products created in admin (not `isDemo`). The demo rows are hidden automatically once `DEMO_MODE=false`.

## What the owner must supply

- **The approved Armenia assortment:** which scents and collections, with SKUs.
- **Per product, from the manufacturer or distributor:** official name in each language, article number, EAN, format, dimensions, duration claim, official description, and scent family and notes. Include a source for each value (URL, PDF page or packaging photo).
- **Retail prices in AMD and opening stock** per SKU.
- **Product photography with written usage rights,** for the kinds PRODUCT, PACKAGING, INSTALLED, DETAIL and LIFESTYLE (see [ASSETS.md](ASSETS.md)).
- **Confirmation or rejection of each brand claim,** with a source.
- **Documented brand authorisation from Drive Int. AG**, before `BRAND_AUTHORIZED=true` is used (see [EXTERNAL_DEPENDENCIES.md](EXTERNAL_DEPENDENCIES.md)).
