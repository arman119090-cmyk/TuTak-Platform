# Partner settlement cycle — collections, the biweekly check, and real Earnings data

**Delivered:** 2026-08-24.
**Spec:** `docs/REFERRAL_COMMISSION_MODEL_RU.md` §2/§7 — TuTak↔partner
settlement is periodic netting of one `PARTNER_PAYABLE` balance (TuTak's
discount-compensation obligation against the partner's commission
obligation), roughly every two weeks, by manual bank transfer. A prior
session found and explained the gap: `PayoutEngineService` already built the
TuTak→partner direction with full concurrency/idempotency rigor; the
partner→TuTak direction had no structured record at all
(`RefundEngineService.warnIfPartnerNowOwesUs` only ever fired a human-facing
alert), nothing tracked whether a partner's settlement window had elapsed,
and the partner Earnings page's "Daily settlements" table read from a
card-payment pipeline (`Settlement`/`SettlementService`) that stays empty in
production because `CARD_PAYMENTS_ENABLED` is unset
(docs/LAUNCH_READINESS_2026-08-16.md) — a QR-only partner saw "Nothing
settled yet" while real commission/discount activity was happening under
them.
**Branch:** `claude/tutak-loyalty-mvp-e485jm`.

This document is the completion report: what was built, what was verified
and how, the two deliberate design decisions the brief asked to be reasoned
about in writing, and what was left out of scope. Nothing below is described
as verified unless it was actually run and the result actually looked at.

---

## 1. What shipped

| Layer | What |
| --- | --- |
| Schema | `Partner.lastSettledAt` (nullable `DateTime`, set by a confirmed payout or a recorded collection); new `PartnerCollection` table (mirrors `Payout`'s shape: amount, bank reference, ledger transaction link, recorder, idempotency key); `AuditAction.PARTNER_COLLECTION_RECORDED` |
| API | `POST /payouts/collections` (`PAYOUT_MANAGE`) — record a partner's bank transfer paying down what they owe; `GET /payouts/partners/:partnerId/collections` (partner-scoped read); `GET /purchase-intents/activity/daily?partnerId=` (partner-scoped read) — real confirmed-purchase activity, grouped by day |
| Sweeper | `partner-settlement.biweekly-check` — same BullMQ-scheduler + Redis-advisory-lock pattern as every other sweep in `sweeps.jobs.ts`; read-only, admin-facing alert only |
| Admin dashboard | `payouts` page: a "Record a collection" form (amount + bank reference, shown only when the selected partner actually owes TuTak) and a "Collections" table, mirroring the existing payout request/list conventions |
| Partner dashboard | `earnings` page: new "QR purchase activity" table (real data, always shown) and "Collections" table (their own transfers to TuTak); the legacy "Daily settlements" table now only renders when it actually has rows |
| Tests | 13 new API integration tests for `PartnerCollectionService`, 9 for `PartnerSettlementCheckService`, 4 new for `PurchaseIntentsService.dailyActivityForPartner`, 1 sweep-table assertion updated; 3 new admin `page.test.tsx` tests for the collection form; 4 new partner `page.test.tsx` tests for the Earnings page |

### Files touched

**Backend (`apps/api`)**
- `prisma/schema.prisma` — `Partner.lastSettledAt`, `PartnerCollection` model, `AuditAction.PARTNER_COLLECTION_RECORDED`
- `prisma/migrations/20260824075933_partner_collections_and_last_settled/migration.sql` — new, additive-only (nullable column, new table, new enum value)
- `src/modules/payouts/partner-collection.service.ts` — new
- `src/modules/payouts/partner-settlement-check.service.ts` — new
- `src/modules/payouts/dto/record-partner-collection.dto.ts` — new
- `src/modules/payouts/payout-engine.service.ts` — `confirmPaid` now also stamps `Partner.lastSettledAt`
- `src/modules/payouts/payouts.controller.ts` — collection endpoints
- `src/modules/payouts/payouts.module.ts` — wires the two new services
- `src/modules/purchase-intents/purchase-intents.service.ts` — `dailyActivityForPartner`
- `src/modules/purchase-intents/purchase-intents.controller.ts` — `GET activity/daily`
- `src/modules/sweeps/sweeps.jobs.ts` — the new sweep row + dependency
- `src/modules/sweeps/sweeps.module.ts` — wires `PartnerSettlementCheckService` into the sweep-dependency factory
- `test/partner-collection.int-spec.ts` — new
- `test/partner-settlement-check.int-spec.ts` — new
- `test/purchase-intents.int-spec.ts` — new `dailyActivityForPartner` describe block
- `test/sweeps.int-spec.ts` — new sweep's stub + assertion
- `test/alerting.int-spec.ts` — updated `SweepDependencies` fixture shape

**Admin dashboard (`apps/admin`)**
- `src/lib/api/financeApi.ts` — `PartnerCollection`, `partnerCollections`, `recordCollection`
- `src/app/(dashboard)/payouts/page.tsx` — collection form + table
- `src/app/(dashboard)/payouts/page.test.tsx` — 3 new tests

**Partner dashboard (`apps/partner`)**
- `src/lib/api/financeApi.ts` — `PartnerCollection`, `ActivityDay`, `collections`, `dailyActivity`
- `src/app/(dashboard)/earnings/page.tsx` — real activity table, collections table, conditional legacy table
- `src/app/(dashboard)/earnings/page.test.tsx` — new, 4 tests

---

## 2. The two decisions the brief asked to be reasoned about

### 2.1 Dual control on `PartnerCollectionService.record` — not applied, deliberately

`PayoutEngineService.confirmPaid` enforces a two-person rule: the admin who
confirms a payout must not be the admin who requested it, because a single
compromised session can otherwise drain a partner's balance to an external
account and mark the theft settled, with every record left behind agreeing
it was legitimate.

A collection does not have that shape. Recording one does not move a single
dram out of the platform — the money already arrived, by bank transfer,
before an admin ever opens this screen. The worst a single bad or careless
entry can do is misstate the books (claim a transfer landed that did not,
or for the wrong amount), which is a real problem — which is why it is
still gated on `PAYOUT_MANAGE` (the same permission as everything else that
touches a partner's ledger balance) and audited
(`AuditAction.PARTNER_COLLECTION_RECORDED`, actor + amount + reference
recorded) — but it is not the class of harm the two-person rule exists to
stop. `AcquirerSettlementService.record`, the platform's other "an operator
attests money already arrived" endpoint, makes the identical call for the
identical reason and is the shape `PartnerCollectionService` was modelled
on, not `PayoutEngineService.confirmPaid`.

Concurrency safety is not weakened by this: the `FOR UPDATE` lock + balanced
ledger posting + idempotency-key discipline is identical to the payout
engine's. What's absent is only the *second human*, not the transactional
rigor.

### 2.2 Partner-facing notification for the biweekly check — out of scope for this pass

The biweekly sweep (`PartnerSettlementCheckService`) fires only
`AlertsService.fire(...)`, the same admin-facing mechanism
`RefundEngineService.warnIfPartnerNowOwesUs` already uses for the mirror
case. No notification reaches the partner dashboard.

Reasoning: the partner dashboard has no notification center for a financial
event today. `NotificationsModule` exists and is wired, but it is
customer-scoped (wallet/bonus/referral events into the mobile app) — there
is no precedent anywhere in this codebase for a partner-facing financial
notice, and building that channel (a new notification type, a partner-side
read/unread surface, a decision about email vs. push vs. in-app) is a
separate, larger piece of plumbing than "make sure a human finds out a
settlement is overdue." The brief's own instruction was to lean toward the
narrower scope when the alternative requires new plumbing beyond what
already exists, so this pass stops at admin-only. An admin already has every
partner's balance and history one click away in the payouts dashboard; what
was missing — and what this closes — is being told to go look, not a new
way for a partner to be told.

### 2.3 A related decision: how "due" is computed

The brief was explicit that a single platform-wide calendar date is the
wrong model — settlement is periodic *per partner*, from that partner's own
last real settlement. `Partner.lastSettledAt` is the mechanism: it is
`null` until the first payout confirmation or collection ever touches that
partner (treated as immediately due, so a new partner is never silently
skipped), and is reset by either `PayoutEngineService.confirmPaid` or
`PartnerCollectionService.record` — whichever direction actually zeroes
some of the balance. The sweep itself still runs on a fixed daily schedule
(`0 6 * * *` Asia/Yerevan, alongside `retention.prune` at 04:00 and
`reconciliation.nightly` at 03:00) so that no partner's own 14-day
anniversary is missed by more than a day, but *which* partners get an alert
on any given run is entirely a function of each partner's own clock, not the
calendar date.

---

## 3. Money-movement discipline for the new collection endpoint

Same rigor as `payout-engine.service.ts`, checked line by line against it:

- **Idempotency**: `IdempotencyService.run` keyed on `partner-collection:<actorId>`, with a durable fallback lookup (`PartnerCollection.recordedByUserId_idempotencyKey` unique index) for the crash-between-two-transactions case, exactly mirroring `Payout.requestedByUserId_idempotencyKey` and `PayoutEngineService.findByKey`.
- **Row locking**: `SELECT balance FROM ledger_accounts WHERE id = ... FOR UPDATE` inside the same `$transaction` that both claims the row and posts the ledger entry, so two concurrent collections against the same partner cannot together collect more than what is actually owed — proven by `never lets concurrent collections together exceed what is owed` in `partner-collection.int-spec.ts`.
- **Balanced posting, one transaction**: `CREDIT PARTNER_PAYABLE` / `DEBIT PLATFORM_BANK`, both inside the row that describes the collection, via `LedgerService.post`.
- **Rejection, not clamping**: a collection larger than what is owed throws `ConflictException` — same posture as `requestPayout` refusing to overdraw what a partner is owed.
- **No economics touched**: the collection engine only ever reads and reduces an existing `PARTNER_PAYABLE` balance; it does not compute, does not know about, and cannot change the 2/3/1/0.5/0.5/3 split or `bonusAccrualRateBps`/`paymentCommissionRateBps`.

---

## 4. The Earnings page fix — where the numbers actually come from

`PurchaseIntentsService.dailyActivityForPartner` reads confirmed
`PurchaseIntent` rows (`status: CONFIRMED`, grouped by `confirmedAt`'s UTC
day) and reports, per day: `grossAmount` (sum of `grossAmount`),
`discountGivenAmount` (sum of `bonusAmountRequested` — the same figure
`postRedemptionCompensation` credits `PARTNER_PAYABLE` with), and
`commissionOwedAmount` (sum of `poolAmount` — the same figure
`postContributionLedger` debits `PARTNER_PAYABLE` with). `netAmount =
discountGiven - commissionOwed`, which reproduces doc §2's own worked
example exactly: 5,000 − 1,200 = 3,800 — pinned as a test assertion, not
just an example in a comment.

Deliberately excludes the partner's own referral-share income (when this
partner is the terminal `PARTNER` link in *another* purchase's chain) — that
credit lands in this partner's `PARTNER_PAYABLE` balance too, but it has no
`grossAmount` of its own on this partner's rows to report against, and
folding it in would make the gross/discount/commission columns stop adding
up to any single purchase a reader could point at. It still shows up in the
balance and payout history, just not itemised in this table.

The legacy "Daily settlements" table (`SettlementService`, gated on
`CARD_PAYMENTS_ENABLED`) is kept, not removed — it now renders only when it
actually has rows, so a partner who does have real card-payment history
still sees it, and a QR-only partner sees the real table instead of an
empty state.

---

## 5. Verification

### 5.1 API (`apps/api`)

Command per the brief: `cd apps/api && npx jest` (the plain command —
`--selectProjects` bypasses `jest.config.js`'s `maxWorkers: 1` guard against
the shared test database). Confirmed directly this session: an earlier
attempt at scoping a run to a couple of files with
`--selectProjects integration test/foo.int-spec.ts` silently ran the *entire*
integration suite instead — `--selectProjects` greedily swallows a following
bare filename as a second (bogus) project name unless separated with `--`
(`--selectProjects=integration -- test/foo.int-spec.ts` scopes correctly).
Cost real time chasing what looked like cross-test contamination before the
cause turned out to be a CLI-parsing quirk, not a bug in this pass's code —
worth remembering for the next session that reaches for a scoped run.

- `npx tsc --noEmit -p tsconfig.build.json && npx tsc --noEmit -p tsconfig.spec.json` — clean.
- `npx eslint "src/modules/payouts/**/*.ts" "src/modules/purchase-intents/**/*.ts" "src/modules/sweeps/**/*.ts" test/partner-collection.int-spec.ts test/partner-settlement-check.int-spec.ts test/sweeps.int-spec.ts test/alerting.int-spec.ts test/purchase-intents.int-spec.ts` — clean.
- `npx jest` (full suite, both `unit` and `integration` projects, `maxWorkers: 1`, against a real freshly-migrated Postgres + Redis): **82 test suites passed, 82 total; 1173 tests passed, 1173 total; 0 failed.** Includes every pre-existing suite (nothing regressed) plus every new one this pass added — `partner-collection.int-spec.ts` (13 tests), `partner-settlement-check.int-spec.ts` (9 tests), `purchase-intents.int-spec.ts`'s new `dailyActivityForPartner` block (4 tests) — and the two suites updated for the new `SweepDependencies` shape (`sweeps.int-spec.ts`, `alerting.int-spec.ts`).

### 5.2 Admin dashboard (`apps/admin`)

- `npx tsc --noEmit` — clean.
- `npx eslint .` — clean.
- `npx jest` — **5 test suites passed, 5 total; 32 tests passed, 32 total; 0 failed** (3 of those tests are new, exercising the collection form).

### 5.3 Partner dashboard (`apps/partner`)

- `npx tsc --noEmit` — clean.
- `npx eslint .` — clean.
- `npx jest` — **4 test suites passed, 4 total; 26 tests passed, 26 total; 0 failed** (a new `earnings/page.test.tsx`, 4 tests).

---

## 6. Deliberately out of scope

- **Partner-facing settlement-due notification** — see §2.2.
- **Dual control on collections** — see §2.1.
- **Referral-share income in the daily-activity table** — see §4; it is real income for the partner but does not belong to *this* partner's own purchase rows.
- **Auto-transfer from the biweekly check** — the brief was explicit this must stay read-only/notify-only; nothing in `PartnerSettlementCheckService` calls `PayoutEngineService` or `PartnerCollectionService`. Turning "due" into an actual transfer stays a human action through the existing, already-audited endpoints.
- **Touching `SettlementService`/the card-payment pipeline itself** — untouched, still correct for the card-payment path it serves if `CARD_PAYMENTS_ENABLED` is ever turned on.
- **Mobile app (`apps/mobile`)** — out of scope per the brief; not touched.
- **`demo/` regeneration** — not required per the brief.
