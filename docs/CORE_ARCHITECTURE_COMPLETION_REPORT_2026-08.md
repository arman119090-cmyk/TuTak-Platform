# Core business architecture — completion report

Branch: `claude/tutak-loyalty-mvp-e485jm`. Companion document to
`docs/CORE_ARCHITECTURE_MIGRATION_2026-08.md`, which holds the inspection
findings, the legacy-conflict classification table, and the architectural
decisions made before any code changed. This report is the spec's own
required step 38/39 output: what was actually built, what was verified, and
what is still open — not "all done."

---

## A. Repository analysis

Covered in full in `docs/CORE_ARCHITECTURE_MIGRATION_2026-08.md` §1
("What the inspection found"). Summary: the partner domain was a flat
entity with a single `isActive` boolean and no approval flow; the QR
purchase flow was fully synchronous with no confirm step and accrued on
the *paid* portion, not gross; the referral engine was a flat one-time
1000 AMD reward with no cascade and no green/black split; a real,
tested, double-entry ledger already existed but the QR path did not post
to it by default; EV charging was independent of all of the above and
untouched by this work.

## B. Legacy conflict report

Full classification table in `docs/CORE_ARCHITECTURE_MIGRATION_2026-08.md`
§2 (14 rules, each marked KEEP / SUPERSEDED / MIGRATE / N/A). Nothing was
marked REMOVE LATER — the old `POST /qr/redeem` path is explicitly kept
running (see §3 of that document) rather than scheduled for removal, since
tonight's instructions were additive-first.

## C. Implementation summary

One shared architecture for the standard purchase flow, built additively
alongside the existing QR path, per spec §1-16:

- **Partner domain** (§2-3): onboarding state machine
  (`PENDING_APPROVAL → ACTIVE/REJECTED`, plus `SUSPENDED`), a
  partner-owner-settable `maxBonusPaymentPercent` (0-100, defaults to
  100 — no universal cap), and a `PartnerIntegration` extension point
  (`QR_PURCHASE/WEBSITE/API/POS/EV_CHARGING/OCPI`) with website URLs
  never auto-trusted (`websiteVerifiedAt` stays null until a human
  verifies).
- **PurchaseIntent flow** (§7-9): customer creates an intent with the full
  gross amount and a bonus amount 0..max; the commercial terms
  (negotiated rate, bonus cap) are snapshotted onto the intent at creation
  and never re-read from the partner afterward; staff confirm or reject
  within a configurable window (3 minutes by default), swept and expired
  automatically if nobody acts; confirm/reject/expire are all idempotent
  conditional-`updateMany` claims, the same pattern the rest of the
  codebase already uses for exactly this reason.
- **Referral engine rewrite** (§5-6, §18-20): attribution is captured once,
  at registration, and is immutable afterward (unique constraint on
  `refereeUserId`); a USER referrer earns a recurring, uncapped 20%-of-pool
  green bonus on every future eligible purchase; a PARTNER referrer earns
  the same share but only as a settlement-ledger credit, never a wallet
  bonus. The separate Referral Challenge (first 3 friends to individually
  reach 10 000 AMD cumulative, qualification order not invite order, 1000
  AMD to both sides) evolved from the old flat one-time reward code.
- **Pool distribution** (§12): `pool = grossAmount × negotiatedRateBps`,
  split 20% green / 30% deferred / 20% referrer / 30% TuTak, always computed
  from the full gross amount, never the post-bonus remainder.
- **Deferred bonus lots** (§13-16): a `DeferredBonusLot` model, separate
  from `BonusLot`'s time-based sweep, with a 3-month window and 54 000 AMD
  *cumulative* confirmed turnover requirement (never a monthly minimum).
  One purchase advances every existing open lot before creating its own new
  one; a purchase never counts toward its own newly-created lot.
- **Settlement ledger** (§22-24): reuses the existing double-entry
  `LedgerAccount`/`LedgerTransaction`/`LedgerPosting` core rather than
  building a parallel ledger. Contribution and bonus-redemption
  compensation are always two separate `LedgerTransaction`s, never netted.
- **Centralized configuration** (§37): every numeric parameter the spec
  fixes lives in `AppConfig.purchasePolicy`, asserted to sum correctly at
  boot (`assertPoolSplitSums`), not hardcoded anywhere in the services that
  use them.

## D. Files changed

Prisma schema: `apps/api/prisma/schema.prisma` (+495/-228 lines) — new
enums/models listed in full in §E below. New migration:
`apps/api/prisma/migrations/20260816000000_core_business_architecture/`.

New modules/files:
- `apps/api/src/modules/purchase-intents/` — service (502 lines),
  controller, module, 2 DTOs.
- `apps/api/src/modules/wallet/deferred-bonus-lot.service.ts` (135 lines).
- `apps/api/src/modules/partners/partner-integrations.service.ts` +
  `.controller.ts`, `dto/apply-partner.dto.ts`,
  `dto/reject-partner.dto.ts`, `dto/update-commercial-settings.dto.ts`,
  `dto/create-integration.dto.ts`.
- `apps/api/test/purchase-intents.int-spec.ts` (26 new tests, 680 lines).

Modified: `referral.service.ts` (rewritten — 361 lines), `referral.listener.ts`,
`referral.module.ts`, `partners.service.ts`, `partners.controller.ts`,
`partners.module.ts`, `bonus-engine.service.ts` (new `BonusEntryType`
values wired into `VALUE_TYPES`), `wallet.module.ts`, `configuration.ts`
(+`purchasePolicy`), `admin.service.ts` (`ROLE_RANK`/`PARTNER_SCOPED_ROLES`
for `PARTNER_MANAGER`), `role-permissions.ts`, `auth.module.ts`,
`auth.service.ts` (referral attribution routed through
`ReferralService.createAttribution`), `sweeps.jobs.ts`/`sweeps.module.ts`
(two new sweeps), `app.module.ts`.

Test files updated for the new referral model:
`referral-abuse.int-spec.ts`, `adversarial-probe.int-spec.ts`,
`phone-verification.int-spec.ts`, `outbox.int-spec.ts`, `alerting.int-spec.ts`,
`sweeps.int-spec.ts`, `test/setup/harness.ts` (registered
`PurchaseIntentsModule`).

Shared packages updated so the vocabulary stays in sync across the
monorepo (`vocabulary-drift.spec.ts` enforces this at CI time):
`packages/shared-types/src/enums/bonus.ts` (+`ACCRUAL_DEFERRED`,
+`REDEMPTION_PARTNER_PURCHASE`), `packages/shared-types/src/enums/transaction.ts`
(+`PARTNER_PURCHASE`), and hy/ru/en labels in `packages/i18n/src/locales/`.

## E. Database changes

New enums: `PartnerStatus`, `PartnerIntegrationType`,
`PartnerIntegrationStatus`, `ReferrerType`, `DeferredBonusLotStatus`,
`ReferralChallengeParticipantStatus`, `PurchaseIntentStatus`.

New values on existing enums: `RoleName.PARTNER_MANAGER`,
`PermissionName.PURCHASE_INTENT_CONFIRM`,
`BonusEntryType.ACCRUAL_DEFERRED`/`.REDEMPTION_PARTNER_PURCHASE`,
`TransactionType.PARTNER_PURCHASE`, four new `AuditAction.PURCHASE_INTENT_*`
values.

New models: `PartnerIntegration`, `DeferredBonusLot`,
`ReferralChallengeParticipant`, `PurchaseIntent`.

Modified: `Partner` (+`maxBonusPaymentPercent`, +`status`, `isActive` kept
in sync by `PartnersService` so every existing read site is unaffected);
`ReferralCode` (`userId`/`partnerId` both nullable — a code now belongs to
either a user or a partner); `ReferralInvite` (+`referrerType`,
+`referrerPartnerId`, `referrerUserId` now nullable and doc-marked
deprecated rather than removed, so historical rows are never rewritten).

All additive. Nothing existing was dropped, renamed, or made non-nullable.
Applied via `prisma migrate diff` (non-interactive) → hand-placed
migration file → `prisma migrate deploy`, to both the real dev database and
a scratch database used to validate the diff first — `prisma migrate reset`
was never used (blocked by Prisma's own AI-safety guard, and correctly so:
this is not a decision to make unattended).

## F. New APIs

`PurchaseIntentsController` (`/purchase-intents`):
`POST /` (create), `GET /:id`, `GET /?partnerId=&status=` (partner's
queue, `PURCHASE_INTENT_CONFIRM`), `POST /:id/confirm`, `POST /:id/reject`.

`PartnersController` additions: `POST /partners/apply` (self-service
onboarding), `POST /partners/:id/approve`, `POST /partners/:id/reject`
(both `PARTNER_MANAGE` + platform-admin-only), `PATCH
/partners/:id/commercial-settings` (partner-scoped + OWNER-tier-only,
checked in the controller since `PARTNER_MANAGE` alone does not
distinguish OWNER from MANAGER/STAFF).

`PartnerIntegrationsController` (`/partners/:partnerId/integrations`):
`GET /`, `POST /`, `POST /:integrationId/verify-website` — the extension
point only, per the spec's explicit instruction not to build full
implementations tonight.

## G. Business-rule confirmation (concrete references, not "all done")

- Single-level referral only, no 2nd/3rd level:
  `referral.service.ts` `resolveReferrer` returns exactly one attribution
  per user, resolved once from `ReferralInvite`, with no recursive lookup
  anywhere in the file — verified by
  `purchase-intents.int-spec.ts` › "pool base and split" › "credits the
  user referrer recurring green bonus."
- Commercial snapshot frozen at creation, immune to later partner changes:
  `purchase-intents.service.ts:151-152` (`negotiatedRateBps`,
  `maxBonusPaymentPercent` copied onto the row at `create()`) — verified by
  `purchase-intents.int-spec.ts` › "commercial snapshot" › "confirm() uses
  the rate frozen at creation."
- Gross-amount base, never the post-bonus remainder:
  `purchase-intents.service.ts:253` (`intent.grossAmount.times(...)`) —
  verified by "computes the pool from the full gross amount" test.
- 20/30/20/30 split, referrer share to TuTak when absent:
  `purchase-intents.service.ts:254-257`, `363` (`tutakBase.plus(referrer ?
  0 : referrerShare)`) — verified by "splits the pool 20/30/20/30" and
  "routes the referrer share to TuTak revenue when the customer has no
  referrer."
- Partner referrer gets ledger credit only, never a wallet bonus: no code
  path in `postContributionLedger` ever calls `bonusEngine.accrue` for a
  `type: 'PARTNER'` referrer — verified by "credits a partner referrer only
  via the settlement ledger."
- Deferred lot: 3 months / 54 000 AMD cumulative, never monthly:
  `deferred-bonus-lot.service.ts:44` checks `progressTurnover` against
  `requiredTurnover` with no date-window subdivision — verified by "unlocks
  in a single purchase... no monthly minimum."
- One purchase advances all existing lots before creating its own, and
  never counts toward the one it creates:
  `purchase-intents.service.ts:282-292` calls `advanceExistingLots` before
  `createLot`, and `createLot` starts `progressTurnover` at zero —
  verified by "advances every existing open lot before creating the new
  one" and "never counting the purchase toward" its own lot.
- Referral Challenge: qualification order not invite order, exactly 3
  slots: `referral.service.ts` `tryRewardChallengeSlot` counts `REWARDED`
  rows and claims the slot with a conditional `updateMany` at qualification
  time, not at `createAttribution` time — covered by
  `referral-abuse.int-spec.ts` (pre-existing suite, rewritten for this
  model).
- Settlement ledger: contribution and redemption compensation always two
  entries: `purchase-intents.service.ts` `postContributionLedger` and
  `postRedemptionCompensation` are always two separate
  `LedgerService.post()` calls — verified by "posts the contribution and
  the bonus-redemption compensation as two separate, unnetted entries."
- Staff role restriction: only OWNER may change `maxBonusPaymentPercent`:
  `partners.controller.ts:207-209` — verified by three tests in
  "staff-role restriction."
- FastCharge/OCPI untouched: no file under
  `apps/api/src/modules/ev-charging/` appears in this diff; the full
  pre-existing EV suite (`ev-charging.int-spec.ts`,
  `ev-cdr-reconciliation.int-spec.ts`) passed unmodified in every full-suite
  run below.

## H. Tests run/passed/failed

Full backend suite (`npx jest --selectProjects integration unit`), run to
completion multiple times during this session as fixes landed:

- First full run after implementation: 1 pre-existing test-harness gap
  (`sweeps.int-spec.ts` missing the two new `SweepDependencies` fields in
  its hand-built mock) — fixed.
- Second full run: 2 failures surfaced — `outbox.int-spec.ts` exercised the
  *old* flat one-time referral reward via `ReferralInvite.status`, which no
  longer exists under the new Challenge model (rewritten to drive
  `ReferralChallengeParticipant` instead); `vocabulary-drift.spec.ts`
  caught that `@tutak/shared-types` and the three i18n locale files had not
  been updated for the two new `BonusEntryType` values and the new
  `TransactionType` value (fixed).
- Third full run: **58 test suites, 673 tests, all passed.**
- New `purchase-intents.int-spec.ts` (26 tests covering the PurchaseIntent
  lifecycle, concurrency/idempotency, commercial snapshot, gross-amount
  base, pool split, referrer rules, deferred-lot rules including multi-lot
  progression and the no-monthly-minimum property, settlement-entry
  separation, and staff-role restriction) — **26/26 passed** on first run
  against the real database once a stale test-database migration state was
  reconciled (see Technical debt, below).
- **Combined final run, with `purchase-intents.int-spec.ts` included:
  59 test suites, 699 tests, all passed, 0 failed.**

Typecheck (`npm run typecheck` — `tsc --noEmit` against both
`tsconfig.build.json` and `tsconfig.spec.json`): clean, no errors.

Lint (`npm run lint` — eslint over `src`/`test`): one unused-import error
found and fixed (`ForbiddenException` imported but not used in
`purchase-intents.service.ts`); clean after.

## I. FastCharge regression status

**Untouched and passing.** No file under `ev-charging/` was modified.
`ev-charging.int-spec.ts` and `ev-cdr-reconciliation.int-spec.ts` both pass
in every full-suite run recorded in §H, using the exact same charging-session
payment flow and OCPI adapter selection as before this work began.

## J. Security / financial risk classification

- **No double-spend / no double-credit under concurrency**: verified
  directly — `purchase-intents.int-spec.ts` fires two concurrent `confirm()`
  calls at the same intent and asserts the pool was paid exactly once
  (`lifetimeEarned` unchanged by the second call, exactly one
  `partner.contribution` ledger transaction).
- **No unbalanced ledger postings possible**: `LedgerService.post()`
  refuses to write anything unless debits equal credits, enforced in code
  before any row is written and by a DB-level balancing trigger on
  `LedgerTransaction`/`LedgerPosting`, unchanged by this work.
- **No retroactive rate changes**: the commercial snapshot test in §G is
  the direct proof; a partner cannot retroactively change what an
  already-created intent will settle for.
- **No new authorization holes**: `PurchaseIntentsController` reuses the
  existing `assertPartnerScope`/`hasPartnerScope` helpers exactly as every
  other partner-scoped controller does; `commercial-settings` adds an
  explicit OWNER-tier check beyond the permission system because
  `PARTNER_MANAGE` alone does not distinguish OWNER from MANAGER/STAFF (the
  same class of gap flagged in `docs/AUDIT_2026-08-B.md` §H5, closed here
  proactively rather than left to a future audit).
- **Residual risk, not closed by this work**: `PurchaseIntentsController`
  has no mobile UI wired to it yet, so it is reachable only via direct API
  calls until a client exists — not a vulnerability, but worth noting it is
  not yet exercised end-to-end from a real client.

## K. Unresolved business decisions (all in one place)

Reproduced from `docs/CORE_ARCHITECTURE_MIGRATION_2026-08.md` §4:

1. Domain/website-verification method for `PartnerIntegration` (spec §3) —
   no technical method specified; `websiteVerifiedAt` stays null until a
   human decides how verification will actually work.
2. Referral Challenge funding source (spec §20) — the architecture is
   built (rewards post via `ACCRUAL_PROMOTION`), but nothing auto-charges
   a partner or draws from the 20/30/20/30 pool. Someone has to decide
   where this 1000+1000 AMD comes from before it is real money moving.
3. Staff amount editing on `PurchaseIntent` confirm (spec §26) — not built,
   consistent with the existing QR flow having none either; flagged rather
   than assumed.
4. What happens to a partner's positive settlement balance on offboarding
   — pre-existing open item in `PARTNER_TERMS.md`, unchanged.

## L. Unresolved legal/accounting items (all in one place)

1. Whether an expired `DeferredBonusLot`'s released value should be
   recognized as TuTak revenue at expiry (spec §16) —
   `TODO: LEGAL / ACCOUNTING REVIEW REQUIRED` at
   `deferred-bonus-lot.service.ts:118-123`. Implemented only as a
   `DEFERRED → EXPIRED` state transition; no automatic revenue posting.

## M. Technical debt

- The old `POST /qr/redeem` path is deliberately left running unchanged
  alongside the new `PurchaseIntent` flow (see migration doc §3). No mobile
  UI has been wired to the new flow yet — that is explicitly next-session
  work, not a defect in what was built tonight.
- The test database (`tutak_test`) had drifted from the migration file
  during development: `migrate deploy`'s by-name skip behavior meant an
  earlier, incomplete version of the migration got recorded as "applied"
  against it, so `TransactionType.PARTNER_PURCHASE` and
  `BonusEntryType.REDEMPTION_PARTNER_PURCHASE` were silently missing from
  its enums even though `prisma migrate status` reported it as fully
  up to date. Found only when the new `purchase-intents.int-spec.ts`
  exercised those two values for the first time — no earlier suite touched
  them. Fixed by hand-applying the two missing `ALTER TYPE ... ADD VALUE`
  statements and reconciling the recorded checksum, the same
  already-established pattern used twice earlier for the real dev
  database. Documented here because it is a property of this Prisma
  workflow worth remembering, not a one-off mistake: **`migrate deploy`
  does not re-validate a migration's content once its name is recorded as
  applied** — regenerating a migration file's SQL after it has already run
  once requires manual reconciliation, on every database it was applied
  to, not just the one being worked in at the time.
- `Referral.ReferralInvite.referrerUserId` stays nullable and
  doc-marked-deprecated rather than removed, so no historical row is ever
  rewritten — a genuine, intentional migration cost rather than debt to
  pay down later.

## N. Git branch / commit / working-tree status

Branch: `claude/tutak-loyalty-mvp-e485jm`. This work is layered on top of
the already-committed migration-plan document
(`docs: migration plan for the core business architecture spec`,
commit `e318bf7`). All implementation described above is committed in one
follow-up commit, `0414085` ("feat(core): implement core business
architecture spec..."), 44 files changed. Working tree is clean as of that
commit. Nothing has been pushed to the remote by this session — push
status should be confirmed against `git status`/`git log origin/...` at
the moment this report is read, not assumed from this document.
