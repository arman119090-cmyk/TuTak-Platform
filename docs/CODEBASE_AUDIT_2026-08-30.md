# TuTak — codebase bloat/duplication/dead-code audit

Дата: 30 августа 2026

This is the audit Arman asked for once every engineering task on the
platform was done: a pass over the whole monorepo — backend, mobile, admin,
partner, shared packages, docs — looking for dead code, duplication, and
documentation that no longer matches the code. Nothing here is a business
decision; everything deleted was verified zero-reference across the repo
before it was removed, and a few things that looked like candidates were
kept because they turned out to be load-bearing.

## What was fixed

### Documentation (previously)

- `docs/ARCHITECTURE.md`, `docs/DESIGN.md` updated where they contradicted
  the current code (module list, PurchaseIntent, tracing/metrics, the Jako
  mark, roadmap items).
- `docs/ROAMING_CPO_INTEGRATION_2026-08-25.md`, `scripts/demo-README.md`:
  small factual/filename fixes.
- `docs/TUTAK_MASTER_PROJECT_CONTEXT_2026-08-16.md`,
  `docs/NEXT_CLAUDE_TASK.md`: superseded banners added — both were frozen
  at an earlier date and had drifted from the shipped platform.
- `docs/README.md`: regenerated Current/Superseded index.

### apps/api (previously)

- Removed two dead interfaces from `roaming-cpo-provider.interface.ts`
  (`RoamingCpoSessionReport`, `RoamingCpoStationSync`) and the stale comment
  referencing them.
- Removed a dead re-exported constant in `idempotency.service.ts`.
- Consolidated four copies of the Armenian-phone regex (login, register,
  password, OTP DTOs) into one shared `common/validators/armenian-phone.ts`.

### packages/shared-types and packages/i18n

Deleted every export confirmed to have **zero remaining importers** —
verified by parsing the actual `import { ... } from '@tutak/shared-types'`
statements across all 67 files that mention the package (not by grepping
bare symbol names, which produces false positives against same-named
`@prisma/client` enums — see "what looked dead but wasn't" below):

- `dto/auth.ts`: `RefreshRequestDto`, `UpdatePersonalizationConsentRequestDto`
- `dto/partner-branch.ts`: `SetBranchFuelTypeRequestDto`
- `dto/partner.ts`: `PartnerOfferingInputDto`, `ReplacePartnerOfferingsRequestDto`,
  `UpdatePartnerAboutRequestDto`, `CreatePartnerBranchRequestDto`,
  `UpdatePartnerBranchRequestDto`, `UpdatePartnerFuelTypesRequestDto`
- `dto/wallet.ts`: `ReserveBonusRequestDto`, `SettleBonusRequestDto`,
  `ReleaseBonusRequestDto`
- `dto/transaction.ts`: `TransactionHistoryQueryDto`
- `dto/ev.ts`: `CreateEvReservationRequestDto`, `EvReservationDto` (only
  after the mobile `evApi.createReservation`/`myReservations` methods that
  used them were themselves confirmed dead — see below)
- `enums/roles.ts`: `Permission`
- `enums/ev.ts`: `EvReservationStatus` (only after `EvReservationDto` above
  was confirmed dead — it was the one remaining user)
- `enums/locale.ts`, `enums/audit.ts`: deleted whole files
  (`SupportedLocale`/`DEFAULT_LOCALE`/`SUPPORTED_LOCALES`,
  `AuditAction`/`FraudSignalType`) plus their barrel exports
- `packages/i18n/src/index.ts`: dead `translations` const
- Removed the unused `@tutak/i18n` dependency from `apps/admin` and
  `apps/partner` (`package.json`, `next.config.ts`, `tsconfig.json`) — only
  `apps/mobile` actually uses that package.

### apps/mobile

- Deleted `app/theme/tokens.ts` and `app/theme/colors.ts` — an early
  light/dark token set with zero remaining imports; the app now runs
  entirely on `@tutak/design`'s `tutakMobileLightTheme` via `ThemeProvider`.
- Removed dead methods with no caller anywhere in the app or its tests:
  `evApi.createReservation`, `evApi.myReservations` (no reservation screen
  exists), `authApi.refresh` (the real refresh flow lives in
  `httpClient.ts`'s interceptor, called directly via axios — this method
  duplicated it and nothing called it), `usersApi.me`.
- Removed the dead `now` helper and its export from `mockData.ts`, and the
  dead `DEFAULT_CENTRE` re-export from `PartnersScreen.tsx` (the real
  export lives in and is only used from `useApproximateLocation.ts`).
- Consolidated `BalanceCard.tsx`'s private `BonusCompositionOnBrand`
  function into `BonusComposition` via a new `tone?: 'default' | 'onBrand'`
  prop — same restyling (translucent-white track, fixed light-shade labels,
  smaller dimensions), one implementation instead of two near-identical
  ones.
- Extracted `StationPin`'s and `PartnerPin`'s byte-identical `StyleSheet`
  block into a new shared `mapPinStyles.ts`.
- Rewrote `Surface.tsx`'s docblock — it described a dark, near-black glass
  surface with a blue glow, but `ThemeProvider.tsx`'s own docblock confirms
  the v2 release is light-only (`tutakMobileLightTheme`, never the dark
  theme). The doc now describes the light glass/shadow scheme that
  actually renders, in the same reasoning style as `light-premium.ts`.

### apps/admin and apps/partner

- Deleted both apps' dead `StatCard.tsx` — defined, never imported anywhere
  in either app.
- Fixed a real bug: the media/branding preview tiles used a Tailwind class
  `bg-sunken` that doesn't exist in the design system (only
  `--color-surface-sunken` / `bg-surface-sunken` is defined — used
  correctly elsewhere, e.g. `ThemeToggle.tsx`). The tiles were silently
  rendering with no background. Fixed in both
  `apps/admin/.../media/page.tsx` and `apps/partner/.../branding/page.tsx`.
- Extracted the byte-identical `httpClient.ts` (axios instance,
  bearer-auth interceptor, refresh-on-401 retry) and `Providers.tsx`
  (React Query provider) into `@tutak/design/web`: `createHttpClient(authStore,
  apiBaseUrl)` and `Providers`. Each app's local `httpClient.ts` now just
  calls the factory with its own `useAuthStore` and base URL — the two
  `useAuthStore` implementations themselves were **not** merged (see
  below), only the wiring around them.
  - This required removing `rootDir: "."` from `packages/design/tsconfig.json`
    (it forbade the package from typechecking a cross-package import,
    the same `rootDir` constraint `apps/api` already lives with elsewhere)
    and declaring `@tanstack/react-query`, `@tutak/shared-types`, `axios`
    as real dependencies of `@tutak/design` (they were previously implicit).
  - Verified with more than typecheck: both apps' full Jest suites
    (including `admin`'s `httpClient.test.ts`, which exercises the
    401-refresh-and-retry logic end to end) and both apps' actual
    `next build` production builds pass.

## What looked dead but wasn't — caught before deleting

Naive grep-by-symbol-name across this repo produces false positives,
because several shared-types symbols share a name with an unrelated
`@prisma/client` enum imported directly in `apps/api` (which cannot import
`@tutak/shared-types` at all — a `rootDir` constraint). Each of these was
re-verified by tracing the actual import statement, not just the bare name:

- `PartnerBranchQrStatus` — looked dead by name, but is used internally by
  `PartnerBranchQrCodeDto.status`, and that DTO **is** imported by both
  `apps/admin` and `apps/partner`'s `partnersApi.ts`. Kept.
- `MediaAssetKind`, `MediaAssetStatus` — used internally by `MediaAssetDto`,
  which both dashboards' `mediaApi.ts` import. Kept.
- `NotificationChannel` — used internally by `NotificationDto`, which
  `apps/mobile`'s `notificationsApi.ts` imports. Kept.
- `EvReservationStatus` — initially looked dead, but `EvReservationDto`
  (which uses it) was still imported by `apps/mobile/.../evApi.ts` at the
  time. Only became genuinely dead, and was only then deleted, once the
  two `evApi` methods that used `EvReservationDto` were confirmed
  themselves unused and removed in the same pass — see above.

The lesson generalized across the pass: before deleting an export, check
not just "does anything outside this package import it" but "does anything
*inside* the same package still use it as part of a type another importer
depends on."

## What was found but deliberately not touched

Left as flagged recommendations for Arman rather than silent deletions or
unilateral fixes, because they are product decisions or higher-risk
auth-flow changes, not dead code:

- **`authStore`/`AuthGate` consolidation (admin vs. partner).** The two
  dashboards' `useAuthStore` implementations are similar but not
  identical — different device-id storage keys, different persisted
  store names, and the partner store carries extra role-scoping logic
  (`PARTNER_ROLES`, `getPrimaryPartnerId`, `isPartnerOwner`) the admin
  store has no equivalent of. Merging them is a real design decision
  (does admin's `Role` model absorb partner's scoped-permission model, or
  do they stay separate?), not a mechanical extraction like `httpClient`/
  `Providers` was.
- **`mediaApi.revoke`** (admin), **`partnerApi.listStaff`**,
  **`partnerApi.setAllBranches`** (partner) — all three are wired methods
  with a live corresponding API endpoint, but no screen in either
  dashboard currently calls them. They read as unfinished UI (a revoke
  button not yet built, a staff list/branch-assignment screen not yet
  built) rather than dead code to delete — deleting them would delete a
  working API integration a future screen might need. Recommend Arman
  decide whether the corresponding UI should be built or the methods
  removed.

## Verification

Run after every batch of deletions, and again in full at the end, with
Postgres/Redis confirmed up first:

| Package | Typecheck | Lint | Tests | Build |
| --- | --- | --- | --- | --- |
| `packages/shared-types` | ✅ | — | — | — |
| `packages/i18n` | ✅ | — | — | — |
| `packages/design` | ✅ | — | — | — |
| `apps/api` | ✅ (`tsconfig.build.json` + `tsconfig.spec.json`) | ✅ | ✅ 95 suites / 1324 tests | — |
| `apps/mobile` | ✅ | ✅ | ✅ 29 suites / 237 tests | — |
| `apps/admin` | ✅ | ✅ | ✅ 5 suites / 34 tests | ✅ `next build` |
| `apps/partner` | ✅ | ✅ | ✅ 5 suites / 35 tests | ✅ `next build` |

`pnpm install` was re-run after the `@tutak/i18n`/`@tutak/design`
dependency changes; `pnpm-lock.yaml`'s diff is exactly the two removed
`@tutak/i18n` entries plus the three new `@tutak/design` dependency
entries — nothing else moved.

No schema or migration changes were made in this pass, so no migration
drift check was needed.
