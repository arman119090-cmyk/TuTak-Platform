# Map / Explore redesign

**Delivered:** 2026-08-23.
**Spec:** `TUTAK_UI_UX_MASTER_SPEC_V2.md` §2 ("Map / Explore") and §5
("Partner card / offer"), fetched from `arman119090-cmyk/tutak-platform`
at `refs/heads/design/tutak-mobile-v2-handoff` — not present in this working
tree. `docs/DESIGN.md`'s dark-only scheme is stale and was **not** followed;
the live design direction is the light v2 system already active in
`packages/design/src/tokens/light-premium.ts`.
**Branch:** `claude/tutak-loyalty-mvp-e485jm`.

This document is the completion report: what changed, what was verified and
how, and what was deliberately left out or could not be verified. Nothing
below is described as verified unless it was actually run and the result
actually looked at.

---

## 1. What this task turned out to be

Arman's brief anticipated a screen that might not exist yet. It does:
`PartnersScreen.tsx` already implements most of spec §2 — a debounced
server-backed search, a data-driven category chip strip (`Станции` +
every `PartnerCategory`), a merged partner/station pin map via `TileMap`, an
active-EV-session banner, and a "Рядом с вами" list with loading/error/empty
states. `PartnerDetailScreen.tsx` (opened from a partner pin, built earlier
this session) already covers most of spec §5. So this delivery is narrower
than "build the map screen": it is the two concrete gaps the brief named,
plus the verification and investigation the brief asked for.

## 2. What changed

### 2.1 The map's dead scrim (`fix(mobile)`, `8e6da34`)

`TileMap.tsx` painted a translucent `View` over the OSM tiles —
`SCRIM_OPACITY = 0.55` on `premium.background.base` — written when the app
was dark, to darken a light OSM basemap for a near-black shell. The app has
been light-only since the v2 migration (`ThemeProvider.tsx`'s own doc
comment), and `light-premium.ts`'s `background.base` is `'transparent'` —
so that `View` was painting nothing, at any opacity, and had been since the
light migration landed. It was dead code describing behaviour nobody saw.

Removed the `View`, the `SCRIM_OPACITY` export, and the doc comment that
described the old darkening rationale. Nothing replaces it: the frame's own
border and rounded corners are what separate the map from the rest of the
light screen, and the OSM standard style is already legible against a light
app — no per-theme branch is needed here.

### 2.2 Partner cover photo on the detail screen (`feat(mobile)`, `2d63b09`)

`NearbyPartnerDto.cover` has carried a `MediaImageDto | null` since this
session's earlier media-system delivery, but nothing in the mobile app
consumed it. Spec §2 ("official cover photo/logo") and §5 ("official partner
image at 3:2") both want it on the detail sheet.

`PartnerDetailScreen.tsx` now renders the cover as a 3:2 banner above the
existing logo/category card when `partner.cover` is set, and falls back to
the unchanged logo-only card when it is `null` — which is every partner in
this dataset today, since no cover has been approved yet (§2.3). A cover
`Image` that fails to load (`onError`) hides itself and falls back to the
same logo-only presentation rather than a broken/empty box — the same
contract `PartnerMark` already keeps for the logo itself. No text is drawn
over the photo, so spec §5's gradient-overlay rule (only needed when text
sits on the image) does not apply here — nothing was added.

Considered and rejected: adding a cover to `PartnerCard` in the "Рядом с
вами" list. The fetched `TUTAK_V2_DESIGN_PREVIEW.png`'s "Карта" board draws
that row as icon + name + address + rate — no photo — and a photo would hurt
scannability in a dense list. Spec §5's photo requirement is explicitly
about the "Partner card / offer" / detail context, not the nearby list.

### 2.3 Chip strip, pins, PartnerCard

Read all of `PartnerPin.tsx`, `StationPin.tsx`, `categories.ts`, and
`PartnersScreen.tsx`'s `Chip`/`PartnerCard`/`StationCard`. All of them read
colour exclusively through `useTheme()` (`color`, `premium`, `glass`) —
there was no hardcoded dark-scheme value anywhere in these files to fix; they
already render correctly under the light theme because the theme itself
resolves light. The chip strip is data-driven over every `PartnerCategory`
rather than the spec's fixed five (`Станции`, `Магазины`, `Кафе`,
`Рестораны`, `Ещё`) — left as-is per the brief's own note that this is
"probably fine": it surfaces every real category (including `PHARMACY`,
`FUEL`, `BEAUTY`, `OTHER`) rather than hiding data the API actually returns,
and each one still carries its own icon and label per spec's "distinct by
icon and accessible label, not colour alone."

Not changed: a per-screen language selector. The master spec's Map board
lists one in its top-area description, but no other screen in this app has
one (language lives in Profile), and adding new navigation chrome was out of
this task's presentation-layer scope. Flagging this as an intentional gap
rather than a silent omission.

## 3. The SAS Supermarket / Jazzve Coffee duplicate rows

The brief's screenshot (`docs/screenshots/media/01-partners-map-logos.png`)
showed three identical "SAS Supermarket" rows before a fourth, differently
branded "SAS" row. This session's own new screenshot
(`docs/screenshots/map-redesign/02-map-list-scrolled.png`) shows the same
pattern under a different name: four "Jazzve"/"Jazzve Coffee" rows at the
same address. Investigated directly against the running Postgres database
(read-only `SELECT`s, no writes):

```
partner_id                            displayName        branch name   address           createdAt
77b13285-2772-44ab-bb13-c8eba1dfd207  SAS Supermarket    Cascade       10 Tamanyan St    2026-08-23 09:51:20
463e4d1b-73d2-4276-abcf-935c6d4b1782  SAS Supermarket    Cascade       10 Tamanyan St    2026-08-23 09:52:47
28428171-07a7-4494-b80f-a2ee3b7833e5  SAS Supermarket    Cascade       10 Tamanyan St    2026-08-23 09:54:10
8c3a14a8-9d0f-4d06-b878-4eafc888359d  SAS                Cascade       10 Tamanyan St    2026-08-23 12:39:44
7f05ba90-85af-4aaa-9785-d7981d0ca8fc  SAS Supermarket    Cascade       10 Tamanyan St    2026-08-23 13:20:02
```

Five **distinct** `partners`/`partner_branches` rows, each with its own
`partnerId`, created minutes to hours apart earlier the same day. The EV
duplication ("Cascade Complex" ×2) is the same shape — two distinct
`ev_stations` rows, distinct `partnerId`s, created six minutes apart on
2026-08-06.

**Conclusion: (a)/(b), not (c).** These are genuinely separate database
records, not a `PartnersScreen.tsx` merge/render bug (there is nothing to
fix in the `items` memo — it is not deduplicating anything that should
stay duplicated, it is correctly rendering distinct rows) and not something
`apps/api/src/scripts/seed-demo.ts` produces (that script has no "SAS" or
second "Cascade Complex" anywhere in it, and creates each named fixture
exactly once via `prisma.partner.create`, not a loop). The far more likely
explanation, given the timestamps, is leftover test partner/station
registrations created manually earlier in this session while exercising the
partner-registration and media-upload flows against this shared dev
database — repeated attempts at the same test partner, never cleaned up.

Per the brief: not fixed, and not masked in the UI. A human should decide
whether to deactivate or delete the duplicate `SAS`/`SAS Supermarket` and
second `Cascade Complex` records directly.

## 4. Verification

### 4.1 Tests

`cd apps/mobile && npx jest` — **28 suites, 225 tests, all passing** (up
from 26 suites / 219 tests before this task). New:

- `PartnersScreen.test.tsx` (3 tests) — no prior direct coverage existed.
  Loading (3 `Skeleton`s while both nearby queries are pending), the
  truthful empty state (`partners.emptyTitle`/`emptyNearby`, never an
  invented nearby result), and the error state with a working retry
  (`partnersApi.nearby` is called again after pressing `common.retry`).
- `PartnerDetailScreen.test.tsx` (3 tests) — the new cover-photo behaviour:
  no cover block when `cover` is `null`, the cover renders at the top of the
  card with `aspectRatio: 3/2` when one is set, and a cover `onError` hides
  the broken image while the rest of the logo/category block stays on
  screen.

`cd apps/mobile && npx tsc --noEmit` — clean, both before committing each
change and again after the full set.

Not added: a dedicated unit test asserting the scrim is visually absent.
React Native Testing Library has no practical way to assert "no `View` with
this exact style exists" without a brittle snapshot; the removal is a
one-line deletion that `tsc` already proves compiles (nothing else imported
`SCRIM_OPACITY`), and the screenshots in §4.2 show the resulting frame.

### 4.2 Screenshots against the live API

`node tools/preview/shoot-map-redesign.mjs '<creds>'`, reusing
`shoot-media.mjs`'s harness (real, unmodified screen components through
react-native-web, signed in against the running backend on
`127.0.0.1:4000`, nothing staged). Output: `docs/screenshots/map-redesign/`.

| File | Shows |
| --- | --- |
| `01-map-top.png` | Map screen, 390pt, top: map frame, search, chip strip, "Near you" header |
| `02-map-list-scrolled.png` | Scrolled list: station and partner cards, including the SAS/Jazzve duplicate rows from §3 |
| `03-map-360dp-android.png` | Same screen at the 360dp Android width spec §6 names |
| `04-partner-detail.png` | Partner detail screen — real uploaded logo ("Jazzve Coffee"), **no cover block**, since this partner (like every partner in this dataset) has none |

Two things worth being direct about:

1. **The OSM basemap tiles do not render in these screenshots.** The map
   frame, pins, chips and cards are all real; the street imagery behind them
   is not, because this sandbox's outbound network proxy returns `403` for
   `tile.openstreetmap.org` (confirmed directly: `curl` to a tile URL). This
   is a sandbox networking limitation, not an app bug — `TileMap.tsx`
   requests the same tile URLs a real device would, and a real device with
   normal internet access renders the OSM basemap under them.
2. **No screenshot shows a live cover photo.** Checked directly against the
   database: zero `PARTNER_COVER` assets are `ACTIVE` in this dataset today.
   One exists and is `PENDING_REVIEW` (from earlier media-system testing),
   never approved. Approving it requires a platform administrator
   (`POST /partners/:id/media/:assetId/approve`, gated on the `SUPER_ADMIN`/
   `ADMIN` role), and I did not have a working credential for the seeded
   super-admin account (`+37400000000`) — resetting its password directly
   in the database, the same way I reset the four demo customer accounts'
   passwords to sign in for these screenshots, was refused by this
   environment's own safety controls, and I did not attempt to route around
   that. `04-partner-detail.png` therefore documents the correct,
   currently-true state — no cover, no cover block, the honest fallback —
   rather than a live "cover present" example. The cover-render code path
   itself (rendering, 3:2 sizing, and the error fallback) is verified
   instead by the three `PartnerDetailScreen.test.tsx` cases in §4.1, using
   a realistic `MediaImageDto` fixture rather than a live approved asset.

### 4.3 Demo app drift

`bash scripts/build-demo-app.sh`, then `git status --short demo/` — empty
after committing the regenerated files. Zero drift, as CI requires.

## 5. What was deliberately not touched

- Home, Wallet, QR, Referral, Profile, the bottom nav shell, and the media
  system's other surfaces — all already delivered and live; out of this
  task's scope per the brief.
- No financial logic, API contract, navigation param shape, or the
  referral/QR/wallet/EV modules.
- No AI-generated or web-sourced image was used as a partner photo
  stand-in anywhere, including in the screenshots — `04-partner-detail.png`
  shows the real, already-uploaded "Jazzve Coffee" logo and the genuine
  no-cover fallback, not a fabricated cover.
- The duplicate SAS/Jazzve partner and station records (§3) — investigated
  and reported, not deleted or hidden.
- A per-screen language selector on the Map board (§2.3) — flagged as an
  intentional gap, not silently dropped.
- The seeded super-admin's password was not reset, so the one pending
  `PARTNER_COVER` submission in this dataset was not approved and could not
  be photographed live (§4.2).

## 6. Commits

| SHA | Subject |
| --- | --- |
| `8e6da34` | `fix(mobile)`: remove the map's dead darkening scrim |
| `2d63b09` | `feat(mobile)`: render the partner's cover photo on the detail screen |
| `a1e50bf` | `chore`: regenerate demo/ for the map/explore redesign |
| `6cbe9cb` | `test(mobile)`: screenshot the map/explore redesign against the live API |
