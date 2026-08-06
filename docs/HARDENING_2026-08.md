# Backend hardening — August 2026

Follow-up to `docs/AUDIT_2026-08.md`. Scope was explicitly **no new
functionality**: close the risks the audit proved, make the ledger
authoritative, and put a test suite and CI in place before further feature
work. Everything below is verified against a real PostgreSQL 16 database.

---

## 1. Critical vulnerabilities fixed

### B1 — Negative amounts minted unlimited points (critical)

`@IsNumberString()` accepts `"-1000000"`, `"1e40"`, `"NaN"` and `"Infinity"`.
A negative `bonusAmountToApply` turned `amount.minus(bonus)` into an addition,
so a 10 000 AMD payment produced an accrual base of 1 010 000 and paid out
101 000 points. Repeatable at will.

Closed at three independent layers, because one layer is a single point of
failure:

| Layer | Mechanism |
| --- | --- |
| DTO boundary | `IsMoneyString` — regex `^\d{1,14}(\.\d{1,4})?$`, optional `allowZero: false` |
| Domain | `parseMoney` / `parsePositiveMoney` — rejects negative, non-finite, over-scale, over-range |
| Database | `CHECK` constraints on every monetary column |

Every `@IsNumberString` on a monetary field is gone; zero remain.

### B2 — The ledger could not reproduce a balance (critical)

`reserve()` and `settleReservation()` each wrote a `REDEMPTION_*` **DEBIT**
for the same spend, so summing debits double-counted every redemption.
`balanceAfter` meant "available + pending" in accruals and "available"
everywhere else. The ledger was decorative — reconciliation was impossible.

Reworked; see §2.

### B3 — Idempotency keys were globally unique (high)

`Transaction.idempotencyKey` was `@unique` across all users. Two consequences:
replaying another account's key returned **that account's transaction** —
amount, partner and all — and squatting a key turned a victim's later payment
into a silent no-op.

Now `@@unique([userId, idempotencyKey])`, and `findByIdempotencyKey` takes the
user id. The migration drops the old index after de-duplicating any historical
collisions (keeping the earliest row).

### B4 — Deactivation and locking had no effect (high)

`buildRequestUserClaims` only checked that the user row existed. An
administrator responding to live fraud pressed "Deactivate" and the attacker
kept transacting until the access token expired — then minted a fresh one from
an un-revoked refresh token, indefinitely.

- `buildRequestUserClaims` now throws `UnauthorizedException` on
  `!isActive`, `deletedAt`, or an unexpired `lockedUntil`. It runs on every
  authenticated request, so the current access token dies on its next use.
- `AdminService.setActive` is transactional and revokes every non-revoked
  refresh token on deactivation.

### B5 — Money invariants were unrepresentable only by convention (high)

Eleven `CHECK` constraints now make bad state impossible to store, whatever
future code does:

`transactions_amounts_non_negative`, `wallets_balances_non_negative`,
`bonus_lots_amounts_sane`, `bonus_reservations_amount_positive`,
`bonus_allocations_amount_positive`, `bonus_ledger_amount_non_negative`,
`bonus_ledger_delta_matches_direction`, `ev_sessions_amounts_non_negative`,
`ev_connectors_pricing_sane`, `ev_cdrs_totals_non_negative`,
`partners_accrual_rate_bounded`.

### Additional defects found and fixed during the pass

- **EV meter readings could go down.** `reportMeterValue` accepted any value,
  so a caller could reduce the bill after the energy was delivered. Readings
  are now validated and monotonic.
- **A failed EV stop left the connector `CHARGING` forever.** The bay became
  permanently unusable and the partner silently lost the revenue. The catch
  path now restores the connector to `AVAILABLE` and marks the session
  `INVALID`, transactionally.
- **Rollback after settlement lost the customer's points.** The QR and EV
  catch blocks called `releaseReservation`, which throws on an already-settled
  hold; the error was logged and swallowed, so the customer's points stayed
  spent against a transaction that ended up `FAILED`. See §3.
- **Stranded reservations.** A process dying between reserve and settle left
  points in `reserved` indefinitely — invisible and unrecoverable without a
  manual database edit. A sweep now releases them (§4).

---

## 2. Bonus Ledger reworked into the source of truth

**Entry kinds are now split into two families**, and the distinction is
load-bearing:

- **VALUE** entries change what the wallet holds in total — `ACCRUAL_*`,
  `REDEMPTION_*`, `EXPIRY`, `REVERSAL`.
- **TRANSFER** entries move points between buckets without creating or
  destroying any — `RESERVE_HOLD`, `RESERVE_RELEASE`, `PENDING_PROMOTION`
  (all new), carrying the new `LedgerDirection.NEUTRAL`.

**Each entry now records its signed effect per bucket** via new columns
`availableDelta`, `pendingDelta`, `reservedDelta`, with the invariant:

```
availableDelta + pendingDelta + reservedDelta
  =  +amount  (CREDIT)  |  -amount  (DEBIT)  |  0  (NEUTRAL)
```

Replaying those deltas reproduces the wallet exactly. That is asserted after
every single money operation in the test suite.

**`balanceAfter` has one meaning everywhere**: total outstanding points
(available + pending + reserved) after the entry was applied.

**One write path.** All ledger writes go through a private `writeLedger`
primitive that reads the wallet the caller just updated, checks the entry's
own invariant before persisting, and computes `balanceAfter` itself — so the
entry and the wallet cannot disagree.

**Redemption is recorded exactly once**, at settlement, and attributed to what
the points were spent on (`REDEMPTION_EV_CHARGING` vs
`REDEMPTION_QR_PAYMENT`) by looking up the transaction type.

---

## 3. Rollback correctness

New compensating actions on `BonusEngineService`:

- **`reverseSettlement(reservationId, reason)`** — undoes a settled spend:
  restores the exact lots the spend consumed (so the returned points keep
  their original expiry), credits `availableBonus`, decrements
  `lifetimeSpent`, and writes a `REVERSAL` CREDIT. Idempotent: a second call
  finds the existing `REVERSAL` entry and does nothing, so a retried rollback
  cannot mint points.
- **`compensateReservation(reservationId, reason)`** — the rollback entry
  point for the sagas. Dispatches on state: `ACTIVE` → release, `SETTLED` →
  reverse, `RELEASED`/`EXPIRED` → no-op. Callers no longer have to know how
  far the saga got.
- **`reverseAccrualLot(lotId, reason)`** — claws back an accrual whose
  transaction did not complete. Takes back only what is still unspent, so it
  can never drive the wallet negative.

Both the QR and EV sagas now compensate the reservation **and** the accrual on
failure.

---

## 4. Stuck-state sweeps

`releaseExpiredReservations()` returns holds whose window elapsed without
settling, wired to a 5-minute cron alongside the existing promotion and expiry
sweeps. This is what makes the reserve/settle pair crash-safe.

`promotePendingLots` and `expireLots` now re-read the lot **inside** the
transaction (expiry under `Serializable`), closing a snapshot race where a
concurrent reservation could make the sweep decrement an amount that had
already moved.

---

## 5. Tests

**141 tests, all passing.** Two suites, deliberately separated.

### Unit — 55 tests, no external dependency

| File | Covers |
| --- | --- |
| `src/common/utils/money.spec.ts` | negatives, `NaN`, `±Infinity`, `1e40`, over-scale, over-range, exact boundary at `99999999999999.9999`, zero policy, decimal precision vs IEEE 754 |
| `src/common/validators/is-money-string.validator.spec.ts` | every value the replaced `@IsNumberString` accepted, plus non-string inputs and the `allowZero: false` variant |

### Integration — 86 tests against real PostgreSQL

Nothing below the controller layer is mocked. The properties under test —
transactional atomicity, `Serializable` conflict detection, `CHECK`
constraints, unique indexes, FIFO ordering by `expiresAt` — live in the
database; a mocked Prisma client would assert the mock and pass while
production corrupted balances.

| File | Tests | Covers |
| --- | --- | --- |
| `test/bonus-engine.int-spec.ts` | 46 | accrual, reserve, settle, release, compensate, reverse, promotion, expiry, stranded-hold sweep, manual adjustment, and the database constraints themselves |
| `test/qr-payments.int-spec.ts` | 18 | full QR saga, accrual on the cash portion only, single-use vs static codes, per-user idempotency, same-user replay, post-settlement rollback |
| `test/ev-charging.int-spec.ts` | 14 | start/meter/stop, CDR, bonus application, monotonic metering, IDOR on stop, double stop, post-settlement rollback with connector recovery |
| `test/account-state.int-spec.ts` | 8 | deactivation, soft delete, lock expiry, refresh-token revocation, idempotent role grants, no `passwordHash` in admin listings |

### Regression protection (requirement 7)

The mechanism is property-based, not a list of remembered numbers. Every
integration test ends with `assertWalletIntegrity`, which asserts four
properties at once:

1. No bucket is negative.
2. Every ledger entry's deltas agree with its own direction.
3. Replaying all deltas reproduces the wallet exactly.
4. Lots and active reservations back the cached balances
   (`available` = Σ AVAILABLE lots, `pending` = Σ PENDING lots,
   `reserved` = Σ ACTIVE reservations).

A list of expected numbers only catches the cases someone thought to write
down; these properties catch an arithmetic change that is wrong in a scenario
nobody anticipated.

**Verified by deliberately breaking the code**, then reverting:

| Mutation | Result |
| --- | --- |
| `settleReservation` stops tracking `lifetimeSpent` | **8 tests fail** |
| `reserve` writes ledger deltas that contradict the wallet move | **22 tests fail** |
| `parseMoney` drops the negative check (the original B1 exploit) | **12 tests fail** |

Additionally, `test/setup/global-setup.ts` runs
`VALIDATE CONSTRAINT bonus_ledger_delta_matches_direction` on the freshly
created CI database before any test runs. That constraint ships `NOT VALID`
in long-lived databases (see §7); on a database built from scratch it must
hold universally, so this proves no code path can write an entry whose deltas
contradict its direction.

---

## 6. CI — `.github/workflows/ci.yml`

Runs on every push to any branch and on every pull request, with PostgreSQL 16
and Redis 7 service containers:

1. `pnpm install --frozen-lockfile`
2. `pnpm --filter @tutak/api prisma:generate`
3. **Lint** — `pnpm lint`
4. **Typecheck** — `pnpm typecheck` (source *and* tests)
5. **Unit tests** — `pnpm --filter @tutak/api test:unit`
6. **Integration tests** — `pnpm --filter @tutak/api test:int`
7. **Build** — `pnpm build` (API, admin, partner)

ESLint did not exist in this repository at all; `pnpm lint` would have failed
in all four apps. A single flat config now covers the workspace. It is
deliberately narrow — the rules kept are the ones that catch defects, not
formatting opinions, because a linter that mostly reports style noise trains
everyone to ignore it including on the run where it finally reports something
that moves money. The backend additionally enforces
`no-floating-promises`, `await-thenable`, `no-misused-promises` and
`require-await`: a money operation whose promise is never awaited commits out
of order, escapes its surrounding transaction, and reports success before the
write has happened.

Current state: **0 errors, 2 warnings** (both `no-explicit-any` in the
exception filter, where the framework boundary genuinely is untyped).

Note: `pnpm --filter @tutak/api test:int` also fixed a latent flaw in the test
setup itself. Jest only honours `maxWorkers` at the top level of a
multi-project config; with it nested under a project the suites ran in
parallel against one database and a worker's `TRUNCATE` deadlocked against
another's open transaction.

---

## 7. Remaining risks

Stated plainly, because each is a real limitation rather than a
future nice-to-have.

**1. `bonus_ledger_delta_matches_direction` is `NOT VALID` on existing
databases.** 48 ledger rows in the development database were written before
the delta columns existed: their deltas are zero while their amount is not,
and the old semantics cannot be reconstructed reliably — that inability is
precisely the defect this work fixes. `NOT VALID` enforces the rule on every
insert and update from now on while grandfathering those rows, rather than
silently deleting a ledger. CI databases are created from scratch and do run
`VALIDATE CONSTRAINT`. **Before production launch**, either accept a ledger
whose first 48 rows are not replayable, or delete them deliberately and run
`VALIDATE CONSTRAINT` in a migration.

**2. Saga compensation is best-effort, not guaranteed.** If the process dies
*during* a rollback, the compensating action never runs. The reservation sweep
recovers holds; a settled-then-orphaned spend is not recovered automatically.
A durable outbox would close this, but that is new infrastructure and was
out of scope.

**3. Reservation and accrual are separate transactions from the transaction
row.** The saga is correct under failure because it compensates, not because
it is atomic. Making the whole redemption one database transaction would be
stronger, but the accrual currently spans an external partner lookup.

**4. Restoring an expired lot.** Releasing or reversing a hold puts points
back into their original lot even if that lot's expiry has since passed; the
lot then sits `AVAILABLE` with a past `expiresAt` until the next hourly expiry
sweep debits it. Self-healing within an hour, and preferable to granting the
points a fresh lifetime — but the customer briefly sees a balance they cannot
keep.

**5. No load or property-based fuzzing.** Concurrency is covered by one
targeted test (two simultaneous holds against the same balance). Real
contention at scale is untested.

**6. Referral, notifications and analytics have no tests.** They do not move
money directly, so they were left out of this pass, but
`ReferralService` does award points on `transaction.completed`.

**7. Authorisation is tested only where it intersects money** (QR issuance
scope, EV session ownership, account state). The guards and RBAC layer have no
dedicated suite.

**8. `POST /ev/sessions/:id/meter-values` remains callable by a client.**
Validation now bounds it, but in production only an authenticated charge point
should be able to report telemetry. Left as-is because restricting it changes
behaviour rather than hardening it.

---

## Files changed

**Schema and migrations**
- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260806145900_add_ledger_entry_kinds/migration.sql` *(new — enum additions must be their own transaction in PostgreSQL)*
- `apps/api/prisma/migrations/20260806150000_harden_money_invariants/migration.sql` *(new)*

**Money handling**
- `apps/api/src/common/utils/money.ts`
- `apps/api/src/common/validators/is-money-string.validator.ts` *(new)*
- `apps/api/src/modules/qr-payments/dto/redeem-qr.dto.ts`
- `apps/api/src/modules/qr-payments/dto/issue-qr.dto.ts`
- `apps/api/src/modules/ev-charging/dto/start-session.dto.ts`
- `apps/api/src/modules/wallet/dto/manual-adjustment.dto.ts`

**Domain**
- `apps/api/src/modules/wallet/bonus-engine.service.ts` *(rewritten)*
- `apps/api/src/modules/wallet/bonus-scheduler.service.ts`
- `apps/api/src/modules/qr-payments/qr-payments.service.ts`
- `apps/api/src/modules/ev-charging/ev-sessions.service.ts`
- `apps/api/src/modules/ev-charging/ocpi/noop-ocpi-adapter.service.ts`
- `apps/api/src/modules/transactions/transactions.service.ts`
- `apps/api/src/modules/users/users.service.ts`
- `apps/api/src/modules/admin/admin.service.ts`
- `apps/api/src/main.ts`

**Tests** *(all new)*
- `apps/api/jest.config.js`, `apps/api/tsconfig.spec.json`
- `apps/api/test/setup/{global-setup,jest-setup,harness,fixtures,invariants,test-database}.ts`
- `apps/api/src/common/utils/money.spec.ts`
- `apps/api/src/common/validators/is-money-string.validator.spec.ts`
- `apps/api/test/{bonus-engine,qr-payments,ev-charging,account-state}.int-spec.ts`

**Tooling**
- `.github/workflows/ci.yml` *(new)*
- `eslint.config.mjs` *(new)*
- `package.json`, `apps/api/package.json`
- `apps/mobile/src/{data/stores/authStore.ts,presentation/components/BalanceCard.tsx,presentation/screens/settings/SettingsScreen.tsx}` — unused imports and parameters flagged by the new linter
