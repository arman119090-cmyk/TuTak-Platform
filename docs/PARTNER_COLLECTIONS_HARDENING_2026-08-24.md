# Partner collections hardening — unique bank transactions, maker-checker, and an honest settlement clock

**Delivered:** 2026-08-24.
**Base commit:** `1e7b5216498e6ef72ae1e8cec2bd49014254ab86` (`feat: partner→TuTak collections, biweekly settlement check, real Earnings data`).
**This pass's commit:** `eebca03e5afd613498c2f8b3d041fa9cad1f8e05` (`fix(payouts): unique bank-transaction control and maker-checker on partner collections`).
**Branch:** `claude/tutak-loyalty-mvp-e485jm`.

This is a financial-integrity hardening pass against `PartnerCollectionService`
and `PartnerSettlementCheckService`, following up an external security review
of the commit above. The review found two confirmed defects (confirmed again
here, independently, by reading the code before touching it — see "What was
verified before anything was changed" below):

1. **No real uniqueness control on a collection's bank reference.** `bankReference`
   was a free-text string, checked only for non-emptiness. Idempotency was
   scoped to `(recordedByUserId, idempotencyKey)`, which is a per-admin retry
   guard, not a "has this real bank transfer already been claimed by anyone"
   guard. The same real transfer could be recorded a second time — reducing a
   partner's recorded debt and crediting `PLATFORM_BANK` a second time — by
   using a fresh idempotency key or having a different admin key it in.
2. **`lastSettledAt` reset unconditionally.** `PartnerCollectionService.execute`
   and `PayoutEngineService.confirmPaid` both set `Partner.lastSettledAt =
   new Date()` after *any* collection or payout, regardless of amount. A 1
   AMD payment against a 500,000 AMD debt reset the biweekly-overdue clock
   for the full remaining 499,999 AMD, because `PartnerSettlementCheckService`'s
   candidate query filters on `lastSettledAt` *before* it ever looks at the
   live balance.

Both are fixed below. Nothing else changed: no referral economics, QR flows,
wallet rules, or unrelated modules were touched.

---

## What was verified before anything was changed

Per the brief's own instruction, the two defects were re-confirmed against
live source at the start of this pass, not assumed from the summary:

- `apps/api/src/modules/payouts/partner-collection.service.ts` (pre-change):
  `bankReference` was `params.bankReference.trim()` with only a
  `if (!bankReference) throw BadRequestException(...)` guard — no uniqueness
  anywhere. The only unique index touching this table was
  `partner_collections_recordedByUserId_idempotencyKey_key`. Confirmed exactly
  as described.
- Line `await tx.partner.update({ where: { id: partnerId }, data: {
  lastSettledAt: new Date() } });` inside `execute()`, unconditional on
  amount, and the identical pattern inside `PayoutEngineService.confirmPaid`.
  Confirmed exactly as described.

Nothing in the summary had gone stale by the time this pass started.

---

## Problem 1 — unique bank-transaction control

### What changed

- `PartnerCollection.bankTransactionId` (nullable `String`) — the bank
  statement's own external transaction id. `bankReference` is unchanged and
  stays a free-text label (a partner-facing description, never the
  uniqueness key — it never was, even before this pass).
- Normalization, in `apps/api/src/common/utils/bank-reference.ts`:
  **trim the edges, strip all internal whitespace, uppercase.** Reasoning: a
  bank statement's transaction id is routinely copy-pasted from a PDF or a
  banking portal, which introduces incidental whitespace both at the edges
  and — because statements are often rendered in fixed-width blocks — in the
  middle (`"FT 23150 000123"`). Its case carries no meaning the way a
  password would, and different banks' exports are not guaranteed to agree on
  it. So two admins who type the same id with different spacing or casing
  must still collide, not silently create two rows.
- **Database-level uniqueness**: `@@unique([currency, bankTransactionId])` on
  `partner_collections` — a real Postgres unique index
  (`partner_collections_currency_bankTransactionId_key`), not an application
  check. Scoped by `currency` for the same reason
  `partner_collections_recordedByUserId_idempotencyKey_key` and every
  platform ledger account's own uniqueness are scoped the way they are:
  there is one `PLATFORM_BANK` account per currency, and a transaction id is
  only unique within the statement of the account it landed in. Postgres
  treats two `NULL`s as distinct under a standard unique index, so legacy
  rows with no `bankTransactionId` (below) never collide with each other or
  with a real one.

### The migration

`prisma/migrations/20260824120000_partner_collection_dual_control_and_bank_txn_id/migration.sql`.

- **`bankTransactionId`**: added **nullable**, and **never backfilled**. Every
  row that predates this migration was recorded under the old single-step
  flow, which never captured a bank statement's own transaction id — there is
  nothing true to backfill it with, and inventing a value would fabricate
  part of the audit trail this whole migration exists to make honest. NOT
  NULL is enforced going forward at the DTO (`RecordPartnerCollectionDto`)
  and service (`PartnerCollectionService.record`) boundary instead, the same
  pattern this codebase already uses for `Payout.confirmedByUserId` (see that
  column's own migration comment).
- **`status`** (new `CollectionStatus` enum, `PENDING`/`CONFIRMED` — Problem 2):
  added nullable, **backfilled to `CONFIRMED` for every existing row** (true:
  every pre-migration row was posted immediately by the old single-step
  flow), then made `NOT NULL`, then given a `DEFAULT 'PENDING'` for any future
  ambiguous insert to fail safe (unconfirmed, unposted) rather than land as
  already-settled. This is the "nullable-then-backfill" pattern, chosen here
  (rather than "leave it null forever") because unlike a bank statement's
  transaction id, "was this already posted" is something every existing row's
  own `ledgerTransactionId` already answers with certainty — backfilling only
  writes down what was already true.
- `confirmedByUserId` / `confirmedAt`: added nullable, never backfilled — same
  reasoning as `Payout.confirmedByUserId`'s own precedent.
- `AuditAction.PARTNER_COLLECTION_CONFIRMED` added via `ALTER TYPE ... ADD
  VALUE`, the same pattern the prior migration used for
  `PARTNER_COLLECTION_RECORDED`.

Verified: `npx prisma migrate deploy` applies cleanly against the existing dev
database (which already held the prior migration's schema), `npx prisma
migrate status` reports "Database schema is up to date!" with no drift, and
`npx prisma generate` regenerates the client without error.

---

## Problem 2 — maker-checker (dual control) on collections

Mirrors `PayoutEngineService.requestPayout`/`confirmPaid` as closely as the
domain allows, reusing the existing `payouts.dualControl` config flag (no new
flag invented).

### Lifecycle, dual control on (the default)

1. **`record`** (the maker step) creates a `PENDING` `PartnerCollection` row
   only. No ledger posting, no balance change. A best-effort (unlocked, not
   authoritative) check against the current balance rejects an obviously
   oversized entry immediately, purely for operator feedback — the
   authoritative check happens at confirmation.
2. **`confirm`** (the checker step) must be called by a *different* admin.
   Confirming your own pending collection is rejected with
   `ForbiddenException`, the same check `PayoutEngineService.confirmPaid`
   already enforces, gated the same way behind `payouts.dualControl`.
3. Confirmation is one database transaction that, in order:
   - **Claims** the pending row (`updateMany({ where: { id, status: PENDING
     } })`) — mirrors `confirmPaid`'s own claim exactly, so a repeated
     confirmation (sequential or concurrent) cannot double-post. A sequential
     re-confirmation after the row is already `CONFIRMED` is caught by an
     earlier status check and reads as `BadRequestException`, matching
     `confirmPaid`'s own "already resolved" behaviour; a genuine race for the
     claim produces one winner and one `ConflictException` loser.
   - **Re-checks the amount owed under a row lock** (`SELECT balance ... FOR
     UPDATE`) — not just at record time. The balance can move between record
     and confirm (a second collection, a purchase, a refund), so this is the
     authoritative check.
   - **Posts the balanced ledger transaction** (`DEBIT PLATFORM_BANK` /
     `CREDIT` the partner's `PARTNER_PAYABLE` — the same two accounts the
     original single-step version already used) and saves
     `ledgerTransactionId`.
   - **Writes the `PARTNER_COLLECTION_CONFIRMED` audit record inside the same
     transaction** — a deliberate divergence from the mirrored precedent
     (`PayoutEngineService.confirmPaid`'s own caller writes its audit record
     in the controller, afterwards). The brief required atomicity here
     specifically: a controller-level failure between the service call
     returning and a controller-side audit call would otherwise leave a
     posted collection with no audit trail, and a retried request could
     otherwise produce a second audit row for one collection. Moving the
     write inside the transaction closes both.
   - If the balance re-check fails, the whole transaction rolls back — the
     claim, the posting, and the audit write all undo together, leaving the
     collection exactly `PENDING`, with no ledger transaction and no audit
     row. Proven directly in `partner-collection.int-spec.ts`.

### Lifecycle, dual control off

`record` posts immediately, in one step — the original design, preserved
exactly in shape. Problem 1's database-level uniqueness constraint and the
existing `(recordedByUserId, idempotencyKey)` idempotency guarantee are still
fully enforced; nothing about them is conditional on the flag. This is a
deliberate divergence from `Payout`, which always requires a separate confirm
call and only toggles the self-check: a collection has no realistic in-flight
moment to confirm later (an operator either has a bank statement in front of
them or does not), so "dual control off" here means "back to one step," not
"confirmation becomes optional." Covered by its own suite,
`partner-collection-single-step.int-spec.ts`, which boots a second app
instance with `PAYOUT_DUAL_CONTROL=false` (the flag is read once at boot, not
per request).

### Admin dashboard

`apps/admin/src/app/(dashboard)/payouts/page.tsx`: the "Record a collection"
form gained a "Bank transaction ID" field (required, alongside the existing
free-text "Bank reference"). The Collections table gained a Status column
(pending/confirmed badge, same visual language as the Payouts table's own
status badge) and a Confirm button for `PENDING` rows — disabled, with an
explanation, when the signed-in admin is the one who recorded it, exactly
mirroring the existing payout Confirm button's own self-request handling.
Nothing beyond that was redesigned.

---

## Problem 2b — `lastSettledAt` reflects the real balance, not any activity

### The fix

`Partner.lastSettledAt` no longer means "the last time a payout was confirmed
or a collection was recorded." It means **the start of the partner's current
settlement cycle** — the last time their `PARTNER_PAYABLE` balance actually
*crossed zero*, in either direction:

- non-zero → zero: a real, full settlement. (The sweep already skips a
  zero balance regardless of this timestamp, so this mostly keeps the clock
  honest for the next time the balance moves.)
- zero → non-zero: a fresh debt or credit was just born, and its own 14-day
  clock starts now — not whenever the partner happened to last be settled.

This is enforced in exactly **one place**: `LedgerService.applyNetDeltas`, the
shared tail of `post()` and `reverse()` — the sole write path for every
account balance in the system (`ledger_accounts.balance` is never touched
directly anywhere else; this was checked by grep across `apps/api/src` before
relying on it, and is also asserted implicitly by every suite's own
`assertLedgerIntegrity` helper). Concretely: after each `PARTNER_PAYABLE`
account's balance is moved by `UPDATE ... SET balance = balance + delta` (the
same lock-free statement as before — see the performance note below), the
method reconstructs the pre-move balance as `updated - delta` at zero
additional cost, and writes `Partner.lastSettledAt = now()` only when
`isZero()` differs between the two.

Reasoning from the balance itself, rather than from "a payout was confirmed"
or "a collection was recorded," is what closes the actual gap: no matter
which of purchases, refunds, referral commissions, EV CDR reconciliation,
payouts, or collections moves a `PARTNER_PAYABLE` balance, the clock is kept
honest by the same code, and no future balance-changing code path can forget
to call it.

**Both prior explicit call sites were removed**: the unconditional
`tx.partner.update({ lastSettledAt: new Date() })` in
`PartnerCollectionService`'s (former) single execute path and in
`PayoutEngineService.confirmPaid` are gone. (`confirmPaid`'s posting doesn't
even touch `PARTNER_PAYABLE` — it moves `BANK_CLEARING` → `PLATFORM_BANK`;
the partner's balance actually changed back at `requestPayout`, which is
where the clock now correctly resets if that payout fully drains the
balance, and where it resets again — forward, not backward — if the payout
later fails and `markFailed`'s reversal reintroduces the debt.)

### Every `PARTNER_PAYABLE`-touching path, audited

Grepped for every module that references `LedgerAccountType.PARTNER_PAYABLE`:
`purchase-intents.service.ts`, `payout-engine.service.ts`,
`partner-collection.service.ts`, `ev-charging/ev-cdr-reconciliation.service.ts`
(referral-commission clawback on CDR reconciliation), `refund-engine.service.ts`,
`referral.service.ts`, `reconciliation.service.ts`, `settlement.service.ts`,
`qr-payments/qr-ledger-mirror.service.ts`. Every one of them reaches the
balance only via `this.ledger.post(...)` or `this.ledger.reverse(...)` — none
of them calls `prisma.ledgerAccount.update` directly (the only two call sites
of that anywhere in `apps/api/src` are inside `ledger.service.ts` itself).
None of them, before or after this pass, wrote to `Partner.lastSettledAt`
directly — that was already true (only the two removed call sites above ever
did), and remains true: `lastSettledAt` is now written from exactly one
place, full stop.

### A performance note, found by the concurrency test that already existed

The first version of this fix issued its own `SELECT ... FOR UPDATE` to read
the previous balance before moving it. That is real double-locking on top of
what `UPDATE` itself already takes, and `ledger.int-spec.ts`'s existing
20-concurrent-postings test — which happens to target a `PARTNER_PAYABLE`
account — started timing out against Prisma's interactive-transaction pool as
a direct result. The fix: Postgres's `UPDATE` already returns the *new*
balance, and the method already knows the delta it applied, so
`previous = updated - delta` requires no separate lock and no separate round
trip at all. Every account, `PARTNER_PAYABLE` included, still moves through
exactly the same lock-free `SET balance = balance + delta` it always has.

### Cycle behaviour, proven in tests

- A 1 AMD collection against a 500,000 AMD debt does not move
  `lastSettledAt` (still non-zero → non-zero), and the sweep still reports it
  overdue at day 14+ (`partner-settlement-check.int-spec.ts`, "is not reset
  by a 1 AMD partial collection against a much larger debt").
- A full settlement to zero resets the cycle (same file, "resets the cycle
  on a full settlement to zero").
- A new debt appearing after a full settlement gets a clean, fresh cycle
  rather than inheriting the old settlement date (same file, "starts a
  clean, fresh cycle when a new balance appears after a full settlement").
- The zero-crossing mechanism itself, independent of any collection or
  payout, is proven directly against `LedgerService` in `ledger.int-spec.ts`'s
  new "PARTNER_PAYABLE zero-crossing" describe block: sets the clock on
  zero→non-zero, leaves it alone on non-zero→non-zero, resets it on
  non-zero→zero (both via `post` and via `reverse`), and never touches it for
  a transaction with no `PARTNER_PAYABLE` leg at all.
- One pre-existing test's premise no longer holds and was rewritten rather
  than patched around: `partner-settlement-check.int-spec.ts` previously
  asserted that a partner who had "never settled" (`lastSettledAt` null) was
  immediately overdue the moment any balance existed. Under the old design
  that was true because nothing but a payout/collection ever touched the
  column; under the new design a brand-new debt now gets a real cycle-start
  timestamp the instant it is born, so it correctly is *not* instantly
  overdue — the old test's premise was actually the bug this pass fixes,
  applied one level up. A new test in its place, "still treats a genuinely
  unknown cycle start (null `lastSettledAt`) as immediately due," proves the
  one case that legitimately keeps the null-is-overdue fallback alive: a
  partner whose balance predates this whole mechanism, for whom there is no
  true cycle-start date to know.

---

## Files changed

**Backend (`apps/api`)**
- `prisma/schema.prisma` — `CollectionStatus` enum; `PartnerCollection.bankTransactionId` / `.status` / `.confirmedByUserId` / `.confirmedAt`; `@@unique([currency, bankTransactionId])`; `AuditAction.PARTNER_COLLECTION_CONFIRMED`; `Partner.lastSettledAt` docblock rewritten for its new semantics.
- `prisma/migrations/20260824120000_partner_collection_dual_control_and_bank_txn_id/migration.sql` — new.
- `src/common/utils/bank-reference.ts` — new; `normalizeBankTransactionId`.
- `src/modules/ledger/ledger.service.ts` — `post`/`reverse` share a new `applyNetDeltas`, which owns the `PARTNER_PAYABLE` zero-crossing → `lastSettledAt` logic for every caller in the system.
- `src/modules/payouts/partner-collection.service.ts` — rewritten: `record` (maker, PENDING or single-step by config), `confirm` (checker), Problem 1's uniqueness enforcement, `listForPartner` extended with the confirming admin.
- `src/modules/payouts/payout-engine.service.ts` — `confirmPaid` no longer sets `lastSettledAt` directly; docblock explains why.
- `src/modules/payouts/partner-settlement-check.service.ts` — docblock updated to describe the new clock semantics; no behavioural change (still read-only, still re-reads the live balance).
- `src/modules/payouts/dto/record-partner-collection.dto.ts` — `bankTransactionId`.
- `src/modules/payouts/payouts.controller.ts` — `bankTransactionId` threaded through; new `POST /payouts/collections/:id/confirm`.
- `test/partner-collection.int-spec.ts` — substantially rewritten for the pending→confirmed lifecycle, Problem 1's uniqueness, Problem 2's dual control.
- `test/partner-collection-single-step.int-spec.ts` — new; dual-control-off suite with its own harness.
- `test/partner-settlement-check.int-spec.ts` — new "reflects the real balance" describe block; one pre-existing test rewritten (see above).
- `test/ledger.int-spec.ts` — new "PARTNER_PAYABLE zero-crossing" describe block.
- `test/setup/fixtures.ts` — `createStaffUser`, for tests that call `PartnerCollectionService.confirm` directly and need a real `User` row for the audit FK.

**Admin dashboard (`apps/admin`)**
- `src/lib/api/financeApi.ts` — `PartnerCollection` gains `status`/`bankTransactionId`/`confirmedByUserId`/`confirmedByName`; `recordCollection` takes `bankTransactionId`; new `confirmCollection`.
- `src/app/(dashboard)/payouts/page.tsx` — bank transaction id field; Collections table status column and Confirm button.
- `src/app/(dashboard)/payouts/page.test.tsx` — updated call-site assertions; two new tests for the confirm button (a different admin can use it; the recorder cannot).

---

## Verification

Run from `apps/api` unless noted. **Plain `npx jest`** throughout — never
`--selectProjects`, which bypasses `jest.config.js`'s `maxWorkers: 1` and
causes spurious deadlocks against the shared test database.

| Command | Result |
| --- | --- |
| `npx tsc --noEmit -p tsconfig.build.json` | Clean, no errors. |
| `npx tsc --noEmit -p tsconfig.spec.json` | Clean, no errors (covers `test/**/*.int-spec.ts` too). |
| `npx eslint .` | Clean, no errors, no warnings. |
| `npx prisma migrate status` | `Database schema is up to date!` — no drift, both this migration and the one before it applied cleanly against the existing dev database (`npx prisma migrate deploy` before that: `The following migration(s) have been applied: 20260824075933_partner_collections_and_last_settled, 20260824120000_partner_collection_dual_control_and_bank_txn_id`). |
| `npx jest` (full suite, both `unit` and `integration` projects, all 65 `*.int-spec.ts` files plus every `*.spec.ts`) | **`Test Suites: 83 passed, 83 total` · `Tests: 1199 passed, 1199 total`**, 312.8s. Zero failures — the entire pre-existing suite (payouts, collections, settlement, ledger, refunds, sweeps, and everything else) stayed green alongside every new test this pass added. |

Then, from `apps/admin`:

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | Clean, no errors. |
| `npx eslint .` | Clean, no errors, no warnings. |
| `npx jest` | `Test Suites: 5 passed, 5 total` · `Tests: 34 passed, 34 total`. |

One honest caveat on the full API run: after printing its final summary, the
process logged `Jest did not exit one second after the test run has
completed... Consider running Jest with --detectOpenHandles`. This is a
process-exit warning about a lingering open handle (most likely a
Redis/BullMQ connection some sweep-related module leaves open — the same
class of thing `SweepsHeartbeatService`'s own "sweep schedule(s) missing from
Redis — re-applying" log lines in this run point at, from the harness's Redis
module), not a test failure — the summary line above it already reported
every suite and every test passing, exit code 0. It was already present
before this pass's own suites ran (visible interleaved with pre-existing
suites like `sweeps.int-spec.ts`, `alerting.int-spec.ts`, and
`production-boot.int-spec.ts` in the same run) and is not something this
pass introduced or investigated further, since it does not affect test
correctness.

---

## Explicit confirmations the brief asked for

- **Duplicate external bank transaction IDs are blocked at the database
  level, not just in application code.** The constraint is
  `partner_collections_currency_bankTransactionId_key`, a real Postgres
  unique index created in the migration (`CREATE UNIQUE INDEX
  "partner_collections_currency_bankTransactionId_key" ON
  "partner_collections"("currency", "bankTransactionId")`) and visible in
  `\d partner_collections` on the running database. The application-level
  `isBankTransactionCollision` check exists only to translate the resulting
  `P2002` into a clear `ConflictException` — the constraint itself is what
  actually stops the second row from ever being written, including from two
  processes racing each other (proven under `Promise.allSettled` in both
  `partner-collection.int-spec.ts` and `partner-collection-single-step.int-spec.ts`).
- **A partial payment no longer suppresses an overdue residual-debt alert.**
  See "Cycle behaviour, proven in tests" above — the 1 AMD-against-500,000
  test is the direct reproduction of the original defect, now passing.

## Limitations left deliberately out of scope

- **Manual entry, not a bank integration.** `bankTransactionId` is typed in
  by an admin reading a bank statement, exactly like `bankReference` already
  was — this pass adds a uniqueness *constraint* on that manual entry, not an
  API integration with any bank or acquirer. An admin who transcribes an id
  incorrectly (a typo, not a duplicate) will simply record a collection under
  a wrong-but-unique id; nothing here can detect that a transcription is
  *wrong*, only that it is not a *repeat*. Real bank-statement reconciliation
  (matching recorded collections against an actual statement feed) is a
  separate, larger piece of work this pass does not attempt.
- **No cancel/reject path for a mistaken `PENDING` collection.** If an admin
  records a `PENDING` collection with a wrong `bankTransactionId`, there is
  currently no way to withdraw it — it sits `PENDING` forever (harmlessly:
  nothing has posted), and that specific transaction id is reserved by that
  row's presence. A checker who spots a mistake can simply decline to confirm
  it, which is safe, but there is no explicit "this was a mistake, mark it
  dead" affordance. Adding one is a reasonable next step but was judged
  outside this pass's brief ("no redesign beyond what's needed to close these
  two defects").
- **The partner-facing Earnings page's own collections list is unchanged.**
  `apps/partner/src/lib/api/financeApi.ts`'s `PartnerCollection` type does
  not surface the new `status`/`bankTransactionId`/confirming-admin fields —
  the brief scoped UI changes to "the admin dashboard's payouts/collections
  page only." A partner currently cannot tell from their own dashboard
  whether a listed collection is `PENDING` or `CONFIRMED`; this is additive
  and low-risk to add later if wanted.
- **`PayoutEngineService` was not given the same `PENDING`/`confirm` split
  it already has** — it already had one. Only `payout-engine.service.ts`'s
  `confirmPaid` was touched, and only to remove its now-redundant explicit
  `lastSettledAt` write.
