# Media system — partner branding and customer avatars

**Delivered:** 2026-08-23.
**Spec:** `TUTAK_V2_MEDIA_SYSTEM_SPEC.md` (Arman, decision recorded 2026-08-21;
both halves — partner logos/covers *and* customer avatars — confirmed for this
pass on 2026-08-23).
**Branch:** `claude/tutak-loyalty-mvp-e485jm`.

This document is the completion report. It states what was built, what was
verified and how, and — in §9 — what was deliberately left out or is known not
to be exercised. Nothing below is described as verified unless it was actually
run and the result actually looked at.

---

## 1. What shipped

| Layer | What |
| --- | --- |
| Schema | `MediaAsset` + four-state lifecycle, nullable owner pointers, immutable brand snapshots on `PurchaseIntent` and `Transaction`, five new `AuditAction` values |
| Storage | Provider-independent `MediaStorage` with three backends and a production boot guard |
| Processing | `sharp`-based validation, EXIF stripping, SVG rasterisation, derivative generation |
| Delivery | Public immutable brand URLs; signed, per-viewer, re-authorised avatar URLs |
| API | 8 new routes; owner-submits / administrator-publishes; every mutation audited |
| DTOs | Media on 8 response shapes, consent-gated on the referral one |
| Mobile | Real logos on every customer-facing surface §1 names, plus the Profile avatar control |
| Partner dashboard | `/branding` — submit, preview, see what is awaiting review |
| Admin dashboard | `/media` — the approval queue |
| Tests | 83 new (58 unit, 25 integration), plus 2 mobile |
| Screenshots | 15, all against a live API with real uploaded files |

### Commits

| SHA | Subject |
| --- | --- |
| `3d3a567` | `feat(api)`: MediaAsset model, brand snapshots and media audit actions |
| `534dca8` | `feat(api)`: media storage, image pipeline, upload/approval endpoints and DTO media |
| `ff5e82c` | `test(api)`: media system unit + integration coverage |
| `f106609` | `feat(mobile)`: real logos and avatars on every customer-facing surface |
| `d15c97d` | `feat(partner,admin)`: branding page and the brand-media approval queue |
| `92de355` | `fix(api,mobile)`: serve media cross-origin, and centre the brand blocks |
| `4987ea1` | `fix(design)`: let the dashboards load images from the API origin |

---

## 2. Data model

`apps/api/prisma/migrations/20260823092437_media_assets_and_brand_snapshots/`

### `MediaAsset`

Immutable metadata plus opaque, server-minted storage keys. The bytes are never
in PostgreSQL and the source of truth is never a caller-supplied URL, per
spec §2.

- `kind`: `USER_AVATAR` | `PARTNER_LOGO` | `PARTNER_COVER`
- `status`: `PENDING_REVIEW` | `ACTIVE` | `REPLACED` | `REVOKED`
- `storageKey` / `displayKey` / `thumbnailKey` — all `@unique`, all minted by
  `mintMediaKeys` from 16 random bytes, none derived from the subject's id
- `width` / `height` / `mimeType` / `byteSize` — of the *display* derivative
- `sha256` — of the bytes as uploaded (forensics, not content addressing)
- `uploadedByUserId`, `approvedByUserId`, and the four lifecycle timestamps

**`REPLACED` versus `REVOKED` is the load-bearing distinction.** Replacement is
the ordinary rebrand: the old asset stays publicly deliverable forever, which is
the entire mechanism behind §2.2's historical snapshots. Revocation is the
control for a file that must stop being shown at all — a wrong logo, an
offensive one, one uploaded from a compromised account — and a revoked asset is
refused everywhere, including on the historical rows that snapshotted it. Those
rows keep their snapshotted display name and fall back to the neutral mark,
which is the honest outcome.

### Guards the schema language cannot express

Written directly into the migration, following the precedent of
`partners_commission_rate_on_grid`:

- `media_assets_subject_matches_kind` — an asset belongs to exactly one subject,
  and that subject matches its kind
- `media_assets_approval_stamped` — anything past `PENDING_REVIEW` says when it
  got there
- `media_assets_one_active_per_partner_kind`, `..._one_pending_per_partner_kind`,
  `..._one_active_avatar_per_user` — partial unique indexes, so "the partner's
  logo" and "the submission an administrator is approving" are never ambiguous

### Backfill safety

Every added column is nullable or has a default, and **nothing is backfilled**:

| Column | Pre-migration rows | Why |
| --- | --- | --- |
| `User.avatarAssetId` | `NULL` | An avatar is optional forever; the fallback is unchanged behaviour |
| `User.avatarConsentReferralList` | `false` | Consent that was not given is not consent |
| `Partner.logoAssetId` / `coverAssetId` | `NULL` | Every existing partner renders the neutral mark, exactly as before |
| `PurchaseIntent.brandDisplayName` / `brandLogoAssetId` | `NULL` | Resolver falls back to the partner's live name and a null logo |
| `Transaction.brandDisplayName` / `brandLogoAssetId` | `NULL` | Same |

The last two are the interesting ones. A pre-migration transaction is **not**
backfilled with the partner's current logo, because that would assert the
partner had that logo at a time when it demonstrably did not. It gets the
partner's current *name* (which is what the customer needs to recognise the row)
and a null logo. Covered by an integration test.

The migration applied cleanly to a `tutak_test` database dropped and recreated
from zero, immediately before the 827-test integration run in §7.

---

## 3. Storage, and how production is gated

`apps/api/src/infrastructure/media/`

`MediaStorage` is deliberately tiny — `put`, `get`, `delete`, keyed by an opaque
string. No buckets, no ACLs, no presigning, no listing. Every policy question
(who may read this, what URL a client is handed, how long it lives) is the API's
and lives in `MediaDeliveryService`. That is what makes the test fake a faithful
stand-in rather than an approximation.

| Driver | Where | Notes |
| --- | --- | --- |
| `MemoryMediaStorage` | Tests | Spec §3.2's in-memory fake. Copies buffers in and out — sharp hands back pooled memory |
| `LocalDiskMediaStorage` | Local dev, demo stack | Write-then-rename; keys re-validated and resolved paths asserted inside the root. **Never a static mount** — the only way out is the authorised delivery route |
| `S3MediaStorage` | Production | SigV4 over `fetch`, no AWS SDK. See §9 for what is and is not verified about it |

### The production guard

`MediaStorageModule` refuses to boot `NODE_ENV=production` unless
`MEDIA_STORAGE_DRIVER=s3` with all five credentials and `MEDIA_PUBLIC_BASE_URL`
set. Same shape and same discipline as `SmsModule` and `PushModule`.

The failure it prevents is quieter than a missing carrier and much worse to find
late: production on local disk looks completely healthy. Uploads succeed. The
image comes back — from the replica that handled the upload. Then the load
balancer picks the other replica and half the partner logos on the network are
404s, and a database restore makes it *every* logo, because the bytes were never
in anything that gets backed up.

**Demo mode is deliberately not exempt**, unlike the acquirer and the carrier.
Those are exempt because a demonstration has no contract with a bank or a telco
and faking them costs nothing. Object storage has no such excuse: a bucket costs
cents, and the demo's own images vanishing on the next redeploy would be visible
to precisely the audience the demo exists for.

### Environment variables

```
MEDIA_STORAGE_DRIVER=local|s3|memory        # default local; production must be s3
MEDIA_STORAGE_LOCAL_ROOT=.media-storage     # local driver only
MEDIA_STORAGE_S3_ENDPOINT=
MEDIA_STORAGE_S3_REGION=us-east-1
MEDIA_STORAGE_S3_BUCKET=
MEDIA_STORAGE_S3_ACCESS_KEY_ID=
MEDIA_STORAGE_S3_SECRET_ACCESS_KEY=
MEDIA_STORAGE_S3_FORCE_PATH_STYLE=true      # MinIO/Ceph need it; AWS accepts it
MEDIA_PUBLIC_BASE_URL=                      # required in production
MEDIA_SIGNED_URL_TTL_SECONDS=43200          # 12h
```

`.media-storage/` is gitignored: it holds real uploaded logos and avatars.

---

## 4. Image handling

`MediaImageService` is the only place an untrusted upload is touched.

**Format is decided by inspecting the bytes.** The filename and the declared
`Content-Type` are ignored entirely — the MIME check at the controller is a
courtesy, not a control. A `.png` that is really a PDF, HTML or a ZIP fails to
parse and is rejected; a `.png` that is really a JPEG is accepted as a JPEG.

Rejected: animated formats (`pages > 1` — an animated logo is not a still one,
and the extra frames are an easy place to hide a second image), anything under
16×16, anything over 50 megapixels, anything that will not parse, and SVG for a
customer avatar.

**Decompression bombs are refused by pixel count, not byte count.** PNG will
encode a 30 000 × 30 000 single-colour canvas into a few kilobytes; decoding it
allocates gigabytes. That is a one-request denial of service against a process
holding database connections, and it sits comfortably inside the 5 MB limit. The
unit suite includes a ~90 MP bomb that is asserted to be under the byte ceiling
before being asserted to be rejected.

**SVG is rasterised, never served.** Spec §3.1 permits a partner to *supply*
SVG and forbids the public app from rendering untrusted SVG — a format that can
carry `<script>`, external references and entity expansion has no business
reaching a browser from user input. It is decoded to pixels and re-encoded as
PNG/WebP; the markup is neither stored nor served.

**Everything is re-encoded.** Passing validated original bytes through would
preserve every trailing byte, ancillary chunk and polyglot trick the parser
tolerated. Re-encoding from decoded pixels means what is stored is a picture and
nothing else. EXIF (including GPS), ICC, XMP and IPTC are dropped — sharp strips
all of it unless `withMetadata()` is called, and nothing here calls it — but
EXIF *orientation* is applied first, so a phone photo does not arrive on its
side.

**Shapes.** A brand mark is `contain`-ed onto a square canvas, never cropped:
the platform does not get to decide which third of somebody's wordmark matters.
A face is `cover`-ed, because a portrait letterboxed in a circle looks broken.
Covers are 16:9. Output is WebP, except a logo whose source has alpha, which
becomes PNG (spec §3.1's "preserve transparency for a PNG logo where useful").

---

## 5. API surface

### Delivery

| Route | Auth | Cache |
| --- | --- | --- |
| `GET /v1/media/brand/:assetId/:variant` | Public. `ACTIVE` or `REPLACED` partner media only | `public, max-age=31536000, immutable` |
| `GET /v1/media/private/:assetId/:variant` | Signed URL **and** a fresh authorisation check per request | `private, max-age=300` |

`variant` is `display` or `thumb`. The `original` derivative is retained so a
future change to display sizes can be re-derived without asking every partner to
re-upload, but it is not a delivery target — no client has a use for the
largest, least-processed artefact the platform holds.

The brand route is cacheable forever because **the asset id is the version**: a
partner replacing its logo mints a new id and every DTO starts returning that
one, so the bytes behind a given URL genuinely never change.

The private route's signature is an HMAC (derived from the JWT access secret,
domain-separated) over the asset, the variant, the expiry **and the viewer it
was issued to**, with length-prefixed inputs so no two field splits collide.
Binding the audience is the part that matters: without it, a URL legitimately
issued to a consenting referee's Level-1 referrer could be pasted anywhere and
would keep working for everyone.

The signature is necessary but never sufficient. Every hit re-runs the full
authorisation check against the database, so **withdrawing consent invalidates
already-issued URLs immediately** rather than whenever they happen to expire.
Verified end to end (§6, §7).

### Mutations

| Route | Who |
| --- | --- |
| `PUT /v1/users/me/avatar` | The authenticated user, for themselves. No `:userId` exists anywhere in that controller |
| `DELETE /v1/users/me/avatar` | Same. Idempotent |
| `PATCH /v1/users/me/avatar-consent` | Same. Default `false` |
| `PUT /v1/partners/:partnerId/logo` | Partner OWNER (→ `PENDING_REVIEW`) or platform admin (→ `ACTIVE`) |
| `PUT /v1/partners/:partnerId/cover` | Same |
| `POST /v1/partners/:partnerId/media/:assetId/approve` | Platform administrator only |
| `DELETE /v1/partners/:partnerId/logo` \| `cover` | Platform administrator only. Revokes, retains derivatives |
| `GET /v1/partners/:partnerId/media` | Partner-scoped or admin |
| `GET /v1/admin/media/pending` | Platform administrator only |

`@RequirePermissions(PARTNER_MANAGE)` is never sufficient on its own here, for
the reason `partner-scope.ts` documents: PARTNER_OWNER holds that permission
too, so gating approval on it alone would let an owner approve their own
submission and defeat the entire two-party rule. Every admin-only route also
calls `assertPlatformAdmin`.

An asset id belonging to another partner returns the same 404 as a nonexistent
one — confirming that a stranger's id exists is a small leak with no upside.

Every mutation writes an `AuditLog` row through the existing `AuditService`:
`MEDIA_ASSET_UPLOADED`, `_APPROVED`, `_REPLACED`, `_REVOKED`,
`MEDIA_AVATAR_CONSENT_CHANGED`.

### Write ordering

Bytes first, row second. A crash between them leaves three orphaned objects
nobody references — a few kilobytes, invisible to every user. The reverse order
would leave a committed `MediaAsset` whose derivatives do not exist: a broken
image on a partner card, with a database insisting everything is fine. If the
row insert fails, the objects are deleted on the way out; if *that* fails too,
the orphan is logged and accepted, because failing the caller's upload over
unreachable garbage would be the wrong trade.

### DTOs

`packages/shared-types/src/dto/media.ts` defines `MediaImageDto`,
`PartnerBrandDto`, `MediaAssetDto`, `PartnerMediaDto`. Extended:

- `AuthenticatedUserDto` — `avatar`, `showAvatarInReferralList`
- `PartnerPublicDto`, `NearbyPartnerDto` — `logo`, `cover` (current brand;
  §4 explicitly permits the live brand on a directory card)
- `TransactionDto`, `PurchaseIntentDto`, `BonusLedgerEntryDto`, `EvSessionDto` —
  `partnerBrand`, the operation's own snapshot
- `ReferralInviteDto.referee.avatar` — present **only** under consent

Nothing in any of these can hold a storage key; the types have nowhere to put
one. `apps/api` cannot import `@tutak/shared-types` in its build (`rootDir`,
TS6059 — the same constraint that forces `modules/partners/geo.ts` to keep its
own category list), so `media.contracts.ts` mirrors them and
`media.contracts.spec.ts` compiles both trees at once and fails on drift.

### Brand snapshots

`PurchaseIntent` freezes `brandDisplayName` + `brandLogoAssetId` at creation,
alongside the commercial snapshot it already took and for the same reason.
`TransactionsService.create` stamps them at the one choke point every money
operation already passes through; a refund or reversal passes the source
operation's snapshot explicitly rather than re-reading today's brand.

Both columns are display-only. **No financial code path reads them**, and no
financial logic was changed by this work.

---

## 6. Screenshots

`docs/screenshots/media/`. All against a live API on a real Postgres, with
files a partner actually uploaded through the real endpoints. Nothing staged in
the harness.

| File | Shows |
| --- | --- |
| `01-partners-map-logos.png` | Directory list — a real "SAS" logo directly above three older partners with none, showing the neutral fallback. Both §6 items in one frame |
| `02-partner-detail-logo.png` | Partner detail card, real logo at 72pt |
| `03-home-recent-operations.png` | Home recent operations |
| `04-transaction-history.png` | Full history — three distinct real logos, each from its own operation's snapshot |
| `05-wallet-source-rows.png` | Wallet ledger rows |
| `06-purchase-preview.png` | QR purchase preview |
| `07-purchase-awaiting.png` | Pending purchase state, real logo and brand name |
| `08-profile-avatar.png` | Profile: real avatar, replace/remove, consent switch, privacy note |
| `09-referral-l1-consent-on.png` | **Davit H. (consented) shows his photo; Mariam G. (has one, did not consent) shows the fallback — same list, same screen** |
| `10-referral-l1-consent-off.png` | The same list after Davit withdraws consent — both fall back |
| `11-fallback-390pt-iphone.png` | An account with no avatar, 390pt |
| `12-fallback-360dp-android.png` | The same, 360dp |
| `13-fallback-partners-360dp.png` | Partner list with no logos, 360dp |
| `14-partner-branding.png` | Partner dashboard: live logo, cover awaiting review, both badges |
| `15-admin-media-queue.png` | Admin queue: two submissions with previews, metadata and approve controls |

Regenerate with `tools/preview/shoot-media.mjs` and
`tools/preview/shoot-media-dashboards.js`.

---

## 7. Verification

### §6 gate, item by item

| Requirement | Result | Where |
| --- | --- | --- |
| A customer can upload, replace and remove **only their own** avatar | PASS | int-spec ×4; live run; `08-profile-avatar.png` |
| A partner OWNER cannot publish without approval | PASS | int-spec; live run (403 on self-approve; pending logo absent from the public DTO) |
| A partner OWNER cannot edit another partner's media | PASS | int-spec ×2; live run (403 on cross-partner upload and approve) |
| Invalid / disguised / over-limit / metadata-bearing images rejected or safely processed | PASS | 13 unit cases + 6 live: PDF-as-PNG, HTML-as-JPEG, ZIP, GIF, animated WebP, sub-16px, 90 MP bomb, >5 MB (413), SVG-as-avatar; EXIF+GPS asserted absent from all three derivatives |
| Missing/failed image has a visible fallback at 360dp and 390pt | PASS | `11`, `12`, `13`, and `01` |
| Partner logo on every §1 surface | PASS — all 13 | §8 table |
| Historical snapshot survives a rebrand | PASS | int-spec ×2; live run — logo v1 on the intent and its transaction, v2 on the directory card, old asset `REPLACED` and still serving bytes |
| L1 avatar only with consent; no L2/L3 exposure | PASS | int-spec ×5; live run; `09`/`10` |
| Full API/mobile/partner/admin tests pass, including migrations and authorisation | PASS | below |

### Test results

| Suite | Result |
| --- | --- |
| `apps/api` unit | **250 passed**, 16 suites (58 new) |
| `apps/api` integration | **827 passed**, 60 suites (26 new), on a database dropped and recreated from zero — which is also the migration-from-scratch check |
| `apps/mobile` jest | **219 passed**, 26 suites (217 before, +2) |
| `apps/mobile` `tsc --noEmit` | clean |
| `apps/partner` build / typecheck / jest | clean / clean / **16 passed** |
| `apps/admin` build / typecheck / jest | clean / clean / **29 passed** |
| `apps/api` `tsc` (build + spec configs) | clean |
| ESLint over `apps`, `packages`, `tools` | **0 errors, 0 warnings** |
| `scripts/build-demo-app.sh` drift | **0 files** |

The only lint output in the repository comes from `.claude/worktrees/` — other
agents' scratch worktrees, pre-existing and untouched by this work.

### Live end-to-end run

A 63-assertion script drove the real HTTP API on a real Postgres: upload,
submit, approve, revoke, replace, avatar upload/replace/remove, consent on/off,
signature tampering, audience swapping, purchase intent, confirmation, rebrand,
and direct DB assertions on statuses, audit rows and the uniqueness invariant.
**63 passed, 0 failed.**

---

## 8. §1 surface coverage

| §1 surface | State | Where |
| --- | --- | --- |
| Catalogue / map card | Done | `PartnersScreen` → `PartnerCard` |
| Partner detail | Done | `PartnerDetailScreen` |
| QR purchase preview | Done | `CreatePurchaseIntentScreen` |
| Pending purchase | Done | `PurchaseIntentStatusScreen` |
| Confirmed purchase | Done | same |
| Rejected purchase | Done | same |
| Expired purchase | Done | same |
| Home recent operations | Done | `HomeScreen` |
| Full transaction history | Done | `TransactionHistoryScreen` |
| Wallet source rows (partner source) | Done | `WalletScreen`, resolved via `sourceTransactionId` |
| Charging session history | Done | `EvHistoryScreen` |
| Charging session detail | Done | `EvSessionScreen` |
| Customer-visible refund/reversal rows | Done | `REFUND` rows in the history list, carrying the source operation's snapshot |

Rows with no partner behind them — a manual adjustment, an expiry, a referral
reward — keep their direction glyph. Inventing a business for them would be
worse than a glyph.

`PartnerMark` and `UserAvatar` were **not** rewritten. Both already accepted an
optional URL and already fell back to the tinted Jako mark; what changed is that
real values now reach them, which is exactly what their docblocks anticipated.

---

## 9. Deliberate decisions, and what is *not* verified

Written plainly, because the useful half of a completion report is this section.

### Two bugs found by looking at a screenshot, not at code

Both are fixed, both now have regression coverage, and both are worth recording
because neither was findable by reading:

1. **`helmet()` defaults `Cross-Origin-Resource-Policy` to `same-origin`.** The
   API serves images embedded by three separate origins. Every logo and avatar
   fetched with a 200 and was then discarded by the browser, so every surface
   fell back to the neutral mark and looked, very convincingly, like a feature
   nobody had wired up. Nothing in the API, the DTOs or the tests was wrong.
   The media routes now set CORP explicitly. This gives nothing away: CORP
   governs embedding, not reading — reading still needs CORS, which these routes
   do not grant.
2. **The dashboards' CSP had `img-src 'self' data: blob:`** with no remote host,
   on the reasoning that an image URL is an exfiltration channel. Correct while
   no image came from a remote host. The API origin is now allowed — it is
   already an allowed `connect-src`, so no new destination is opened.

A third, cosmetic: `Surface` nests its children under a full-width fill, so
`alignItems: 'center'` set on the Surface centres that fill and leaves content
flush left. Pre-existing, invisible while the mark was a placeholder, obvious
the moment a real logo landed in it. Fixed on the partner detail card and the
three Surface-wrapped PurchaseIntent states.

### The S3 driver has never spoken to a real bucket

There is no S3-compatible endpoint and no credentials in the environment this
was written in, by design. What **is** verified is the signing arithmetic —
against AWS's own published `get-vanilla` canonical-request/string-to-sign
vector, plus payload-hash and signed-header cases. What is **not** verified is a
round trip. Treat the first deployment that sets `MEDIA_STORAGE_DRIVER=s3` as
the integration test: check `/health`'s reported driver and do one upload before
trusting it with a partner's public identity.

### Every §1 surface is covered, but two are not in the screenshot set

All thirteen surfaces §1 names carry the brand, including charging-session
detail — `EvSessionScreen` reads the same `/ev/sessions/me` endpoint the history
list does, so `partnerBrand` was already in the payload.

The EV surfaces and the confirmed/rejected purchase states are **not
photographed**, because the seeded scene has no live charging session and a
confirmed intent redirects past its own screen. Their code paths are identical
to the ones that are photographed (same component, same DTO field, same
resolver) and the rejected/confirmed states are covered by the integration
suite, but "verified by screenshot" is a claim only the ten screens in §6 have
earned.

### The offline demo shows no images, on purpose

The mock adapter replaces the transport, not a CDN. `MOCK_BRANDS` carries real
partner *names* with `logo: null`, and the avatar upload echoes back the URI the
picker produced. Inventing a URL would produce precisely the broken image §6
forbids. The names are the part that matters offline: the demo exercises the
snapshot code path end to end, so a history row reads "Ջազվե" rather than
"QR_PAYMENT".

### Judgement calls not spelled out in the spec

- **A revoked asset is refused on historical rows too.** §3.3 says to retain
  record-needed derivatives rather than hard-delete, and they are retained — but
  revocation exists for a file that must stop being shown, so it stops being
  shown everywhere. History keeps the snapshotted name and falls back to the
  neutral mark. An ordinary rebrand is an approval, not a revocation, and leaves
  history fully intact.
- **Signed URLs rather than bearer-token image routes.** The consumers are
  `<Image>` tags in React Native and two Next.js dashboards, none of which can
  attach an Authorization header to an image fetch without every call site
  reimplementing image loading — which is what §4's "one reusable component"
  rule exists to prevent. A signed URL is an authorised delivery path in the
  sense the spec means, and the per-request re-authorisation makes it strictly
  *more* responsive to a revoked permission than a 15-minute bearer token.
- **The `original` derivative is never delivered**, only retained.
- **No reject action** in the admin queue. The API has none either: a wrong
  submission is superseded by the partner's next upload, and an administrator
  declining to press approve is already the refusal. Taking a *published* asset
  down is the separate, heavier revocation.
- **An administrator cannot set a customer's avatar.** Nothing about running
  this platform requires that ability, and the ability to do it is the ability
  to abuse it.
- **A second partner submission supersedes the first** rather than queueing
  both, so an approval is never ambiguous about which file was looked at.
- **Consent is a separate control from the upload**, default off. Uploading a
  photo of yourself and agreeing to appear in someone else's list are two
  decisions; bundling them would make the second something that happened to the
  customer rather than something they chose.
- **`expo-image-picker`** added to `apps/mobile` (pinned to the SDK version) and
  stubbed for the preview harness with an obviously synthetic flat-colour image
  — a screenshot of the harness should never be mistakable for a real person's
  photograph.

### Explicit non-goals, honoured

No social feed, no public profiles, no avatar browsing or search. No AI-generated
or scraped partner imagery — every logo in the screenshots is a server-rendered
wordmark created for this test data. No image bytes in any financial payload or
ledger metadata. No direct browser or mobile write access to a bucket.
