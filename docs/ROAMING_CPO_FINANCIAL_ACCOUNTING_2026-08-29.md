# Roaming-CPO frozen-rate financial accounting

Completes `docs/ROAMING_CPO_INTEGRATION_2026-08-27-SECURITY.md`'s Problem 2:
that pass shipped the capability model (a `ROAMING_CPO` connector can no
longer fake a session) but deliberately left `stop()` failing closed for
every such session, because nothing yet froze a rate to bill at or knew how
to complete one from a trusted source. This pass completes that saga.

## The shape of the problem

An app-initiated `ROAMING_CPO` session cannot be billed the way every other
EV session is. `EvSessionsService.stopOnce()`'s internal path bills from
`session.energyKwh`, populated by `reportMeterValue` as the customer
charges — but `reportMeterValue` has always refused any reading, customer
or operator, for a `ROAMING_CPO` session (Problem 2, 2026-08-27): the CPO's
own meter is the only trustworthy source, and it does not answer
synchronously at Stop. It answers minutes to hours later, as a CDR, the
same way a *walk-in* roaming session already gets corrected against one
(`EvCdrReconciliationService.reconcileOne`).

Two more things make an app-initiated session different from that existing
walk-in path, though:

1. **Two rates need to survive from Start to whenever the CDR arrives.**
   TuTak buys at `Partner.evWholesaleRatePerKwh` and resells at
   `EvStation.standardRetailRatePerKwh`, and either can change on the
   partner/station row at any time. A session must bill at what those rates
   *were* the moment it started, never what they've since become.
2. **There is no bill yet to correct.** The walk-in path corrects an
   already-billed `Transaction`/`EvCdr` pair. An app-initiated session has
   neither until its first (and only) CDR arrives — this is the first time
   either row is created, not a correction of one.

## What shipped

### Freezing the rate at `start()`

`EvSessionsService.start()` now does two new things for a `ROAMING_CPO`
connector, in addition to the existing capability gate (Problem 2):

- Refuses to start at all if `EvStation.standardRetailRatePerKwh` is null —
  failing closed here, rather than freezing a null `completeAppInitiatedSession`
  would later have nothing to bill with.
- Snapshots `EvStation.standardRetailRatePerKwh`,
  `Partner.evWholesaleRatePerKwh` and `Partner.evMarginReferralCapPerKwh`
  onto three new nullable `EvSession` columns
  (`stationRetailRatePerKwh`/`wholesaleRatePerKwh`/`marginReferralCapPerKwh` —
  null for an `INTERNAL` session, which still bills from
  `EvConnector.pricePerKwh` at Stop) at the moment the bay is claimed. A
  later change to either the station's tariff or the partner's contract
  never reaches back into a session already in flight.

### Parking at Stop instead of failing closed

`stopOnce()` no longer refuses a `ROAMING_CPO` session outright. It rejects
applying bonus points (the final cost isn't known yet, so `bonusToApply <=
cost` can't be checked), then hands off to `stopRoamingSession`, which:

1. Claims the stop (`stoppedAt`), the same idempotent-claim idiom the
   internal path already uses.
2. Sends the remote stop command if the connector has an `ocpiEvseUid` —
   logged, not thrown, on failure: the CPO may well have stopped delivering
   energy regardless of whether its API call succeeded, and a CDR that never
   arrives is exactly what the give-up path below is for.
3. Frees the connector and moves the session to a new terminal-but-pending
   `EvSessionStatus`, `AWAITING_SETTLEMENT`.

### Billing once the CDR arrives

`EvCdrReconciliationService`'s existing `ev.reconcile-roaming-cdrs` sweep
now runs a second loop, alongside its original one, over every
`AWAITING_SETTLEMENT` session. `completeAppInitiatedSession` mirrors
`reconcileOne`'s claim/fetch/give-up shape exactly (same
`RECONCILE_CLAIM_STALE_AFTER_MS` claim window via a new `settlingAt`
column, same `MAX_FETCH_ATTEMPTS` ceiling via a new `settlementAttempts`
column, same critical alert on give-up, latched by a new
`settlementGivenUpAt` column so a given-up session is never retried again)
but *completes* a bill rather than correcting one:

- Reads the three frozen rate columns (never the live `EvStation`/`Partner`
  rows).
- Bills `energyKwh × stationRetailRatePerKwh` against the CPO's own
  reported energy — never the CPO's own reported cost, which only matters
  to the walk-in correction path.
- Computes the margin split via `RoamingCpoSettlementService.computeMargin`
  (reused unchanged — a static method call, no new dependency): the capped
  pool splits through the standard six-leg referral rule, the slice above
  the cap is pure platform revenue.
- Applies the same self-dealing suppression the internal EV path and the
  walk-in roaming settlement both already apply: an unverified-phone or
  affiliated (self-dealing) customer still gets the session billed and the
  partner still gets paid wholesale — TuTak's own margin accounting is
  never gated on customer eligibility — but the customer-facing bonus/
  referral split is suppressed, with the whole pool kept as revenue instead.
  This mirrors the walk-in settlement's own `eligible` fallback, not the
  internal path's stricter "skip the whole pool" behaviour.
- Creates the `Transaction` and the (now fully-populated, `NOT_APPLICABLE`)
  `EvCdr` row — the first and only time either exists for this session —
  atomically alongside the wallet accrual, deferred lot, referral chain
  credit and ledger posting below.

## The double-entry ledger: `EV_ROAMING_RECEIVABLE`

Every other purchase path in this codebase either has the customer pay a
partner directly (the partner account is *debited* — they owe TuTak a
commission) or has TuTak itself already holding the money (a card capture,
a wallet spend). An app-initiated roaming session is the one path where
TuTak is genuinely owed money by the customer *and* genuinely owes money to
the partner (the wholesale cost) in the same transaction — the reverse of
the commission model's shape.

`postEvRoamingSettlementLedgerIdempotent` posts accordingly:

- **CREDIT** the partner's `PARTNER_PAYABLE` account for the wholesale
  amount (TuTak now owes them for energy delivered — this account's
  balance goes *negative* under this ledger's `balance += debit − credit`
  convention, the mirror image of the commission model's positive "partner
  owes TuTak" balance).
- **CREDIT** `BONUS_LIABILITY` for the customer-facing green + deferred +
  user-referrer shares (when eligible and non-zero).
- **CREDIT** each partner-referrer's own `PARTNER_PAYABLE`.
- **CREDIT** `PLATFORM_REVENUE` for TuTak's own residual plus the uncapped
  revenue slice.
- **DEBIT** a new global `EV_ROAMING_RECEIVABLE` account for the sum of
  every credit above — by construction, not independently computed against
  `cost`, so it balances regardless of rounding. That sum happens to equal
  the retail cost exactly (wholesale + capped margin + uncapped margin =
  wholesale + margin = retail), which the accounting suite's ledger test
  checks directly.

**What `EV_ROAMING_RECEIVABLE` was not, as of this pass**: a collection
mechanism. Nothing here drained it — no stored-value wallet top-up, no
card-capture wiring into this flow. It existed so the ledger stayed honest
about what had actually happened (TuTak genuinely owing the partner, and
genuinely owed by the customer) rather than silently unbalanced or silently
pretending the receivable didn't exist.

**Update, 2026-08-29 (same day, following task)**: it now has one. See
`docs/ROAMING_CPO_PREPAID_BALANCE_2026-08-29.md` — a customer prepaid
balance, funded through a `BankTopUpAdapter` (no real bank connected yet;
the No-op adapter honestly refuses every top-up), spent automatically by
`CustomerBalanceService.collectFromBalance` the moment a session settles.
This account's balance still grows for any customer with no funded prepaid
balance — collection is all-or-nothing and opt-in (the customer has to have
topped up), never a guarantee — but it is no longer strictly one-directional
the way it was when this section was first written.

## Tests

`apps/api/test/ev-roaming-financial-accounting.int-spec.ts`: rate freezing
and its immutability against a later tariff change, the missing-retail-rate
failure at Start, the full CDR-completion happy path with a ledger-balance
assertion, self-dealing suppression, the retry-then-give-up path (with its
critical alert and the given-up session never being retried again), and
double-sweep race safety. `apps/api/test/ev-roaming-capability.int-spec.ts`
replaced its now-stale "stop always fails closed" test with one asserting
the actual `AWAITING_SETTLEMENT` contract, plus a bonus-rejection test and
a second-stop-race test.

`AWAITING_SETTLEMENT` is also a customer-visible session status, so it was
added to `@tutak/shared-types`' `EvSessionStatus` and given a label in all
three locale files — caught by the existing
`src/config/vocabulary-drift.spec.ts` regression test the moment the enum
value was added to the Prisma schema.

## Migration

`20260830000000_ev_roaming_financial_accounting`: purely additive — one new
`EvSessionStatus` value, one new `LedgerAccountType` value, three new
nullable/defaulted `EvSession` columns, one index. Verified via a fresh
`migrate deploy` (`prisma migrate diff --exit-code` against `schema.prisma`
afterward: "No difference detected") and an upgrade path (every prior
migration, then this one alone on top).
