# Partner public profile — map logo + about/offerings

**Delivered:** 2026-08-23.
**Spec:** Arman's request, translated: "I wanted each partner on the map to
have their own avatar... tapping it takes you straight to their page, where
you see the public information they wrote about themselves." Pinned down by
two follow-ups (both quoted in full in the task brief) — the map pin shows
the partner's own logo, falling back to the category icon; the partner
dashboard gets a form for a public "about" text plus an optional priced
products/services list, visible on the partner's page in the app, explicitly
not a marketplace ("Полноценный маркетплейс... сейчас НЕ строим"), and
explicitly no admin review for this text, unlike partner logos/covers.
**Branch:** `claude/tutak-loyalty-mvp-e485jm`.

This document is the completion report: what was built, what was verified
and how, and what was deliberately left out. Nothing below is described as
verified unless it was actually run and the result actually looked at.

---

## 1. What shipped

| Layer | What |
| --- | --- |
| Schema | `Partner.about` (nullable text, capped 2000 chars at the DTO boundary); new `PartnerOfferingItem` table (name, optional description, `Decimal(18,4)` price, `displayOrder`) |
| DTOs | `about`/`offerings` on `PartnerPublicDto` only — `NearbyPartnerDto` stays lean, per the existing discipline |
| API | `PATCH /partners/:id/about`, `PUT /partners/:id/offerings` — OWNER-only, no review step, live immediately; `GET /partners/:id` now returns both |
| Mobile | `PartnerPin` renders the partner's own logo (circular), category icon as fallback; `PartnerDetailScreen` fetches the full profile and renders about/offerings |
| Partner dashboard | New `/profile` page — about textarea, offerings table editor |
| Tests | 18 new DTO unit tests, 14 new API integration tests, 12 new mobile component tests (4 pin + 8 detail-screen), 6 new partner-dashboard tests |
| Screenshots | 3, against a live API, real data set up through the real OTP/role-grant flow |

### Commits

| SHA | Subject |
| --- | --- |
| `3088641` | `feat(api)`: partner public profile — about text and an offerings list |
| `0b16f54` | `test(api)`: partner profile unit + integration coverage |
| `aff7f43` | `feat(mobile)`: map pin shows the partner's own logo, detail screen shows the profile |
| `1356038` | `test(mobile)`: map pin logo/fallback and detail screen profile coverage |
| `53fd6d9` | `feat(partner)`: a page to edit the public profile — about text + offerings |
| `aa688c6` | `chore`: regenerate demo/ for the partner public profile |

---

## 2. Schema and DTO shapes, and why

### 2.1 `Partner.about`

A nullable `String` column, no `@db.VarChar` length — this schema has never
used one; every other free-text field (`displayName`, `legalName`) is capped
purely at the DTO boundary with `class-validator`, and `about` follows the
same convention (`UpdatePartnerAboutDto`, `@MaxLength(2000)`). 2000 characters
is a short "about us" paragraph — well past `ApplyPartnerDto`'s 200-char
`legalName`, since this is prose rather than a business name, short of
anything that would make the partner page unreadable.

Placed on `Partner`, not `PartnerBranch` — the same reasoning `logoAssetId`/
`coverAssetId` already established: a chain's public identity is one thing,
not one per shop front.

### 2.2 `PartnerOfferingItem`

```prisma
model PartnerOfferingItem {
  id           String   @id @default(uuid())
  partnerId    String
  name         String
  description  String?
  price        Decimal  @db.Decimal(18, 4)
  displayOrder Int      @default(0)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  partner Partner @relation(fields: [partnerId], references: [id], onDelete: Cascade)

  @@index([partnerId])
  @@map("partner_offering_items")
}
```

- **Its own table**, not a JSON column on `Partner` — a real relation is what
  makes "a real marketplace could be added on top of this later" actually
  true: a stable per-row id, an index on `partnerId`, and a shape a future
  `PurchaseIntent.offeringId` FK could point at without a redesign. A JSON
  blob would have to be migrated into exactly this shape the day a real
  "buy this" flow gets built, which is the outcome Arman's "чтобы потом было
  легко это добавить" was explicitly asking to avoid.
- **`price` is `Decimal(18, 4)`** — this schema's one money type, matching
  every other monetary column (`Wallet.availableBonus`, `Transaction.amount`,
  etc.), not a new type invented for this feature. AMD is implicit, same as
  everywhere else in this app — no currency column.
- **`displayOrder`, not `createdAt` ordering** — documented in-schema: a
  partner reordering their list (best-seller first) is an expected edit, and
  `createdAt` cannot express "move item 3 first" without rewriting
  timestamps. `PartnersService.replaceOfferings` writes it as the submitted
  array's own index, so "save the list in the order you want it shown" *is*
  reordering — no separate reorder endpoint exists or is needed.
- **Cascade-deletes with the partner** — same as every other partner-owned
  child row in this schema.
- **Nothing references a row here from `PurchaseIntent`/`Transaction`** — by
  design. This is a read-only listing; there is no stock, no cart, no
  "order this" affordance anywhere it renders.

### 2.3 DTOs (`packages/shared-types/src/dto/partner.ts`)

```ts
export interface PartnerOfferingDto {
  id: string;
  name: string;
  description: string | null;
  price: string;
}

export interface PartnerOfferingInputDto {
  name: string;
  description?: string | null;
  price: string;
}

export interface ReplacePartnerOfferingsRequestDto {
  offerings: PartnerOfferingInputDto[];
}

export interface UpdatePartnerAboutRequestDto {
  about: string | null;
}
```

`about: string | null` and `offerings: PartnerOfferingDto[]` were added to
**`PartnerPublicDto` only** — not `NearbyPartnerDto`. The task brief was
explicit about this discipline (the nearby/map projection is intentionally
lean because it is returned for every branch in a search radius), and it
holds: nothing about a partner's about text or product list is useful on a
map pin or a list row, only on the detail page, which is exactly where
`PartnerDetailScreen` now fetches it from.

---

## 3. API

### 3.1 Endpoints

- `PATCH /partners/:id/about` — body `{ about: string | null }`. `null` (or
  a whitespace-only string) clears it back to no "about" section.
- `PUT /partners/:id/offerings` — body `{ offerings: PartnerOfferingInputDto[] }`,
  a **full replacement**, not per-item add/update/delete. Chosen over
  fine-grained CRUD because — as the task brief itself anticipated — a small
  business's product list does not need per-row optimistic-concurrency
  control, and "submit your whole list, in the order you want it" is simpler
  to implement correctly on both the API and the dashboard form than
  reconciling partial adds/removes/reorders. Capped at 50 rows.
- Both are gated `assertPartnerScope` + `assertPartnerOwner` — **OWNER-only**,
  the same tier `PATCH :id/commercial-settings` and the brand-media submit
  endpoints already use. This was a judgement call, not something the brief
  pinned down explicitly: I treated a partner's public-facing identity (what
  a customer reads about the business) as the same class of decision as its
  commercial settings and its logo/cover, all three already OWNER-gated on
  this codebase, rather than opening it to MANAGER/STAFF. A MANAGER/STAFF
  operator gets `ForbiddenException("Only the partner owner may ...")`
  rather than a silent no-op.
- **No admin review** on either endpoint — the write reaches the public
  projection (`GET /partners/:id` for anyone) the instant it commits. This
  is the one explicit, load-bearing difference from `PUT :id/logo`/`:id/cover`,
  and it is exactly what Arman confirmed: a partner's own text carries no
  impersonation risk the way an uploaded image does.
- Money validated with the existing `IsMoneyString({ allowZero: false })` at
  the DTO boundary and re-checked with `parseMoney` in the service — the
  same belt-and-braces pattern every other monetary DTO in this codebase
  already follows, not a new validator.

### 3.2 `GET /partners/:id`

Unchanged route, unchanged controller method. `PartnersService.PUBLIC_FIELDS`
now selects `about` and an ordered `offerings` relation; `toPublicDto` maps
`PartnerOfferingItem[]` down to `PartnerOfferingDto[]` (dropping `partnerId`/
`displayOrder`/timestamps, the same discipline the rest of that method
already applies to the partner row itself). The owner's own full-record view
(`findByIdOrThrow`, reached when the caller has scope on the partner) also
now includes the `offerings` relation so the dashboard can read its own
current list back — its pre-existing raw-Prisma-row shape for that path
(logo/cover as raw asset ids, not resolved `MediaImageDto`s) was left alone;
that is a pre-existing inconsistency in this codebase, not something this
task introduced or was asked to fix.

---

## 4. Mobile

### 4.1 Map pin (`PartnerPin.tsx`)

Now takes `name`/`logoUrl` and renders them through `PartnerMark`, which
gained two small, additive capabilities:

- **`circular?: boolean`** — `radius.full` instead of `PartnerMark`'s usual
  rounded-square treatment. Every other caller (list cards, the detail
  header) is unaffected; only the pin opts in, since Arman's confirmed ask
  was specifically "a small circular avatar".
- **`fallback?: React.ReactNode`** (+ `fallbackBackgroundColor`) — lets a
  caller supply its own no-logo content instead of `PartnerMark`'s generic
  neutral mark. The pin passes the existing category `Ionicons`, on the
  disc's own selected/unselected background (`fallbackBackgroundColor:
  "transparent"`), so a missing logo still reads as "this pin has no logo
  yet" rather than as a mismatched second fallback square drawn behind an
  already-circular disc.

Both call sites — `PartnersScreen.tsx`'s marker `useMemo` and
`PartnerDetailScreen.tsx`'s own mini-map — now thread `name`/`logoUrl`
through from `NearbyPartnerDto`, which already carried `.logo` from the
media-system delivery. No API change was needed for this half of the work.

### 4.2 Partner detail screen (`PartnerDetailScreen.tsx`)

Now calls `partnersApi.get(partner.partnerId)` on mount — the exact pattern
`CreatePurchaseIntentScreen` already established: the trusted nav-param
`NearbyPartnerDto` renders immediately (distance, the mini-map coordinate,
the logo/cover block — everything it already carried cheaply), and the
fetched `PartnerPublicDto` adds only what was never on that param: `about`
and `offerings`. Both render conditionally — no "About" section for a `null`
about, no "Products & services" section for an empty list — matching this
screen's existing "don't render an empty section" discipline for the cover
photo. Offerings render as plain rows (`ListRow`: name, description, price
via `formatAmd`) with no "add to cart"/"order" affordance, since there is no
marketplace behind them yet.

---

## 5. Partner dashboard

New `/profile` page (`apps/partner/src/app/(dashboard)/profile/page.tsx`),
linked from the sidebar between Branding and Integrations. OWNER-gated the
same way `/branding` is (`isPartnerOwner`), with the same "here's why you
can't" message for a non-owner rather than a page that only fails on submit.

Two independent forms, each its own `Surface`/save button:

- **About** — a `Textarea`, seeded once from the fetched value (guarded so a
  background refetch never overwrites an in-progress edit), `PATCH`es on
  save.
- **Offerings** — a local, freely-editable draft list (`useState`, seeded
  once the same way) rendered as a `Table`: add/remove rows, edit
  name/description/price inline, `PUT`s the whole array on "Save changes".
  The save button disables — with an inline explanation — while any row is
  missing a name or a valid, greater-than-zero price, mirroring the server's
  own `IsMoneyString({ allowZero: false })` rule so an owner sees the problem
  before submitting rather than after a 400.

No new design-system primitives were needed — `Field`/`Textarea`/`Input`/
`Table`/`Th`/`Td`/`Tr`/`Button`/`Surface`/`PageHeader` from `@tutak/design/web`
already covered this shape.

---

## 6. Verification

### 6.1 Automated

| Suite | Result |
| --- | --- |
| `apps/api` — new DTO unit tests (`partner-profile.dto.spec.ts`) | 18/18 pass |
| `apps/api` — new integration tests (`partner-profile.int-spec.ts`) | 14/14 pass |
| `apps/api` — full suite (`unit` + `integration`) | _see §6.4_ |
| `apps/mobile` — full `jest` | 234/234 pass (29 suites), including the 4 new `PartnerPin` cases and 8 new `PartnerDetailScreen` about/offerings cases |
| `apps/partner` — full `jest` | 22/22 pass (3 suites), including the 6 new `/profile` cases |
| `apps/partner` — `next build` | Clean; `/profile` listed as a static route |
| `pnpm typecheck` (7 packages) | Clean |
| `npx eslint apps packages tools` | Clean |
| `npx prisma migrate status` | No drift, before and after the full run |
| `bash scripts/build-demo-app.sh` + `git status --short demo/` | Regenerated and committed; clean after |

### 6.2 Coordination with the other running suite

`ps aux | grep jest` showed another full API suite (pid 11410) already
running when this task started, matching the brief's warning. I ran only
scoped single-file tests (`npx jest path/to/one-file --selectProjects ...`)
alongside it throughout the implementation. Before running my own full
suite, I checked that process again: it had made **zero CPU progress over a
20-second window** and held **no active connection to `tutak_test`**
(`pg_stat_activity` showed nothing from it), 55+ minutes after it started —
a suite this size normally finishes in single-digit minutes, judging by how
fast the scoped runs above completed. I judged it stalled rather than
genuinely in-flight and ran my own full suite rather than waiting
indefinitely; I did not kill the other process, since it is not mine to
kill and might still be watched by whoever started it.

### 6.3 Live screenshots (`tools/preview/shoot-partner-profile.mjs`)

New script, same harness pattern as `shoot-map-redesign.mjs` (real,
unmodified screen components through `react-native-web` against the running
API), extended to also *set up* its own data first:

1. Registers a fresh customer through the real `register/request-otp` →
   `verify-otp` flow, reading the code from the API process's own stdout
   log (`console-sms.provider.ts`'s dev behaviour) — no seeded password
   guessed or reset.
2. Signs in as the seeded admin (`+37400000001`) the same way.
3. Admin grants the fresh customer `PARTNER_OWNER` of **Jazzve** — a seeded
   partner that already has a real, previously-**ACTIVE** (admin-approved)
   logo and a real branch, via `POST /admin/users/roles`. Reusing it means
   the map pin's logo in these shots is a genuinely approved asset from
   earlier work, and the only new write is the about/offerings call.
4. Re-authenticates (JWT `partnerScopes` are baked in at issuance) and, as
   owner, calls `PATCH :id/about` and `PUT :id/offerings` for real.
5. Fetches `GET /partners/nearby` and `GET /partners/:id` to confirm the
   customer-visible shape, then shoots three screens.

Output in `docs/screenshots/partner-profile/`:

| File | Shows |
| --- | --- |
| `01-map-with-logo-pin.png` | Map screen — pins now render partner logos (confirmed by inspecting the pixels: one pin is Natali Pharm's real seeded "NP" logo, not a fallback) |
| `02-partner-detail-profile.png` | Jazzve's detail screen — header logo, mini-map pin (both the real, circular "J" logo image), stats, address |
| `03-partner-detail-profile-scrolled.png` | Same screen, scrolled — **About** section with the real saved text, **Products & services** with all three saved offerings (name, description, `formatAmd`-formatted price), no purchase affordance |

Verified by inspecting cropped pixels of the pin (`sharp`, not just "the
screenshot didn't error"): the mini-map pin is a fully circular disc with
the partner's real logo image inset inside it, and the "About"/"Products &
services" text on screen is character-for-character what the setup script
wrote through the real API, not placeholder copy.

### 6.4 API full-suite result, and the shared-database flakiness behind it

Three full `--selectProjects unit integration` runs were attempted against
`tutak_test` over the course of this task, from two different sessions (this
one, and another session in this same shared environment that started its
own full run partway through — the exact collision the task brief warned
about, twice, on the same day). None of the three is a clean, collision-free
number:

| Run | Result | Notes |
| --- | --- | --- |
| 1st (this session) | Killed at an 8-minute artificial timeout | The underlying `jest` process had almost certainly already finished (see below) — the timeout fired on Jest's own post-run hang, and a `\| tail -250` in the same pipeline lost the buffered output when the pipe was killed. Not a real failure, just lost output. |
| 2nd (this session) | **1125/1146 pass** — 21 failed, in `media-system.int-spec.ts`, `purchase-intents.int-spec.ts`, `money-rounding.int-spec.ts`, `refund-clawback-deep.int-spec.ts` | Both of this feature's new files pass cleanly (`partner-profile.int-spec.ts` 14/14, `partner-profile.dto.spec.ts` 18/18) |
| 3rd (the other session's run, started while this one's 2nd was still settling) | **1131/1146 pass** — 15 failed, all in `money-rounding.int-spec.ts`, one via an explicit `deadlock detected` on the fixture-truncating `TRUNCATE` | A *different* subset of failures than run 2 |

Every failure across both real runs is inside `media-system`,
`purchase-intents`, `money-rounding`, or `refund-clawback-deep` — none of
which this task touched, none of which mention `about`, `offering`, or
`PartnerOffering` anywhere in their source (checked directly). The specific
tests that fail change between runs, and the errors are uniformly foreign-key
violations ("references a user/partner that was truncated out from under
it") or an outright Postgres deadlock on the shared `TRUNCATE ... CASCADE`
every suite's `beforeEach` runs — the signature of two processes truncating
and repopulating the same `tutak_test` database at once, not of a logic bug.
Both runs also printed Jest's own "did not exit one second after the test
run has completed" warning, which is what made the first stalled process (and
this session's own 2nd run, briefly, before it was confirmed complete) look
hung rather than finished: the actual test run for a full pass here takes
five-to-six minutes; the process then sits alive without exiting.

**What this task is and isn't claiming**: the code this feature added or
touched (`PartnersController`, `PartnersService`, two new DTOs, the schema
migration) is exercised end-to-end by `partner-profile.int-spec.ts`,
which passed identically in both real runs. The pre-existing flakiness in
four unrelated suites is a real, reproducible property of running the full
integration suite in this shared, multi-session sandbox — not something this
task introduced, and not something this task's scope covers fixing. A
maintainer re-running the full suite with exclusive access to `tutak_test`
(no other session mid-run against it) would be the way to get a genuinely
clean number; neither of this session's attempts had that condition.

---

## 7. Deliberately left out / follow-up decisions

- **No admin review for `about`/offerings** — confirmed explicitly by Arman;
  not a gap.
- **No purchase/cart/checkout on offerings anywhere** — confirmed explicitly
  not in scope; the schema is shaped so it *could* be added later
  (`PartnerOfferingItem`'s own table, stable ids) without redesigning this
  delivery.
- **OWNER-only, not MANAGER/STAFF** — a judgement call (§3.1), following the
  existing precedent set by commercial-settings and brand media. If Arman
  wants a MANAGER to be able to edit the public profile without full OWNER
  rights, that is a one-line change to both endpoints' `assertPartnerOwner`
  calls (drop to `assertPartnerScope` alone, or introduce a narrower check)
  plus loosening the dashboard's `isPartnerOwner` gate — flagged here rather
  than guessed at.
- **The pin's logo is not literally cropped to a circle when the underlying
  asset is itself a rounded square** (§4.1, §6.3) — the *disc* is circular
  and the logo sits inset inside it, matching how the existing seeded brand
  assets in this dataset already look (rounded-square marks, not photos).
  This reads correctly in the screenshots; a perfectly circular clip of the
  image itself was not attempted, since `PartnerMark`'s existing convention
  for logos elsewhere in the app is the same soft-square treatment, only
  the *pin's own frame* needed to become circular per Arman's ask.
- **The shared `tutak_test` database's cross-session flakiness (§6.4)** — not
  fixed, not this task's scope, and not new: two other agents collided on it
  earlier the same day per the task brief, and this session hit the same
  thing twice more while verifying. Worth a maintainer's attention (e.g. a
  lock/queue around who may run the full integration suite at a time) but
  orthogonal to the partner-profile feature.
- **No screenshot of the partner dashboard's new `/profile` page** — verified
  instead by its own 6 component tests plus a clean `next build`. Taking a
  live browser screenshot of it would have required either a seeded
  partner-dashboard password (not available, and guessing/resetting one was
  avoided per the same discipline used for the mobile screenshots) or
  building out a full password-set flow for a throwaway account, which felt
  like scope creep for a page whose behaviour is already covered by tests
  that exercise the real component against a mocked API client.
