# TuTak — financial core audit, August 2026

Scope: the money. Bonus lifecycle, ledger atomicity, idempotency, concurrency,
the charging lifecycle, partner accounting, and recovery from interruption.

Method: attack the running code with the two things the existing suites never
did — **operations in flight at the same time**, and **numbers that do not
divide evenly**. Every finding below was reproduced by a test that failed
before the fix and passes after it. Nothing here was concluded by reading
alone.

State audited: `ff96a6a`, 446 integration tests passing. State after:
`9e02396`, 506 integration tests passing.

---

## Summary

| | Found | Fixed | Verified by test |
| --- | --- | --- | --- |
| Critical | 3 | 3 | yes |
| High | 4 | 4 | yes |
| Medium | 1 | 1 | yes |
| Not fixed — see §Blockers | 2 | — | — |

Two rounds. The first attacked the money paths; the second attacked
authorization by object id, database-level enforcement, and whether a failure
reaches a human. F-7 and F-8 come from the second — see §Round two.

The financial core proper — payments, settlement, refunds, payouts,
reconciliation — held everything thrown at it. Its claims are conditional
updates, its arithmetic rounds explicitly, and its concurrency was already
tested. **Every defect found was in the loyalty and EV paths**, which are
older, and which had drifted from the conventions the financial core
established later.

---

## Critical

### F-1 — Two customers could start a charging session on the same connector

`EvSessionsService.start` read the connector's status outside the
transaction, then set `CHARGING` unconditionally inside it. Two customers
tapping the same charger at the same moment both passed the check and both
got a session.

*Consequence:* two people billed for one cable, two accruals against one
delivery of electricity, and a connector whose status is whatever the last
writer set.

*Root cause:* read-then-write across a transaction boundary. The check and
the claim were separate statements.

*Fix:* the claim is a conditional `updateMany` inside the transaction —
`AVAILABLE → CHARGING`, refused when zero rows match. A confirmed reservation
may additionally claim a bay held in `RESERVED` for it. This is the same
pattern the QR code flip already used correctly.

*Proof:* `concurrency-probe.int-spec.ts` › "gives a connector to exactly one
of two racing customers" — returned 2 successful starts before, 1 after.

### F-2 — A double-tapped stop billed twice and then corrupted the record

`stop()` checked `status !== CHARGING` on an unlocked read outside any
transaction, and the EV path has no idempotency key. Both requests created a
transaction, reserved and settled the customer's points, and issued a remote
stop to the charger. The second failed only at the very end, on the CDR's
unique index on `sessionId`.

*Consequence:* the financial outcome was saved by that index — by accident,
and only after real side effects had already happened, including a second
`stopRemoteSession` to physical hardware. Worse, the loser's cleanup then
called `releaseConnector`, which stamped `INVALID` over the session the
winner had already completed: a charge the customer paid, the CDR recorded
and the partner will be settled for, filed under a status saying it never
happened.

*Root cause:* the guard was incidental (a unique index three layers down)
rather than an explicit claim, and the compensating path assumed it was the
only writer.

*Fix:* `stop()` claims the session before doing anything that costs money, by
stamping `stoppedAt` — the one column that is null exactly while a session is
stoppable. `releaseConnector` now only invalidates a session still in
`CHARGING`, so no failure path can walk back a terminal state. A crash
between the claim and the billing transaction leaves the session `CHARGING`
with a stop time, which `ev.expire-stale-sessions` closes.

*Proof:* `concurrency-probe.int-spec.ts` › "bills exactly once when two stops
race" (2 transactions before, 1 after) and "leaves the connector free and the
session closed after a race" (`INVALID` before, `COMPLETED` after).

### F-3 — A charging session at a fractional tariff could not be stopped at all

`energyKwh` is `Decimal(10,3)`, `pricePerKwh` is `Decimal(10,2)`; their
product is five decimal places. `parseMoney` refuses more than four — so the
guard written to protect the ledger from bad *input* rejected the platform's
own arithmetic.

*Consequence:* 25.123 kWh at 100.25 AMD/kWh returns
`transaction amount supports at most 4 decimal places`. The customer's car is
charged, the bay is occupied, and every stop attempt returns 400. After F-2's
fix the session is invalidated and the partner simply loses the revenue.

*Root cause:* no rounding step between computation and persistence on the EV
path. The financial core rounds explicitly at every equivalent point; the EV
path never did, and whole numbers hid it — 25 × 100 is exact.

*Fix:* `roundCharge` (half up) and `roundIssued` (down) in
`common/utils/money.ts`, applied to the EV cost and to both accrual sites.
The split is not arbitrary: what the customer pays rounds half up, which is
the retail convention; what the platform issues as a liability rounds down,
so a rounding step never makes the platform owe more than the rate says. Both
match what `payment-engine` and `settlement` already do.

*Proof:* `money-rounding.int-spec.ts` › "bills a fractional meter reading at
a fractional tariff" — threw before, returns `2518.5808` after.

---

## High

### F-4 — An accrual on a fractional amount failed the payment that earned it

Same root cause as F-3, different site: `amount × bps ÷ 10⁴` is up to eight
decimal places. A QR payment of 1234.5678 at 333 bps threw
`accrual amount supports at most 4 decimal places` from inside the saga,
failing the whole redemption and compensating it.

*Fix:* `roundIssued` at both accrual sites. A sub-0.0001 accrual now rounds
to zero and the purchase completes, rather than the purchase failing.

*Proof:* `money-rounding.int-spec.ts` › two cases, both throwing before.

### F-5 — A roaming start discarded the CPO's session id

`startRemoteSession` returns `ocpiSessionId`; the code checked `accepted` and
dropped the id. `stop()` then addressed the remote session as
`session.ocpiCdrId ?? session.id` — and `ocpiCdrId` was never written
anywhere, so it always sent our local id, which the CPO has never seen.

*Consequence:* a remote stop that matches nothing on the CPO's side. The bay
keeps delivering energy after the customer has been billed and walked away.

*Not currently reachable:* no station carries an `ocpiEvseUid`, and the noop
adapter is wired unless OCPI credentials are set. Fixed anyway, because it is
wrong wherever it is reachable and the fix is three lines.

*Verification:* the change is covered by the existing EV suites passing;
**the roaming path itself is NOT VERIFIED against a real CPO** — see
Blockers.

---

## Medium

### F-6 — A failed redemption consumed the merchant's invoice permanently

When a QR redemption failed *after* the code had been flipped, the saga
compensated the points and marked the transaction FAILED, but left the code
`REDEEMED` against a payment that never happened.

*Consequence:* no money is lost or duplicated, but the invoice can never be
paid. The merchant reissues it at the till while the customer watches, and to
the customer it looks like the app took their money.

*Fix:* the catch block returns the code to `ACTIVE`, conditioned on
`redeemedTransactionId` matching this attempt — so only the request that
consumed the code can return it, and a losing concurrent request can never
un-redeem the winner's legitimate payment.

*Proof:* `crash-recovery.int-spec.ts` › "leaves the QR code unredeemed so the
customer can try again" — threw `QR code is not active` before.

---

## What was attacked and held

Recorded so the next audit does not repeat it. Each of these is a test that
was written expecting to find something and did not.

| Probe | Result |
| --- | --- |
| Two settles racing the same reservation | Exactly one; wallet correct |
| Two releases racing the same reservation | Exactly one; no points minted |
| Two reversals racing the same settlement | Idempotent |
| Two reservations claiming more than the balance | Exactly one |
| Two sweeps promoting the same pending lot | Exactly once |
| Two sweeps expiring the same lot | Exactly once; no negative balance |
| Two QR redemptions racing one code | Exactly one; loser's points returned |
| Same idempotency key sent twice in parallel | One transaction |
| Meter reading after the session is billed | Refused; bill unchanged |
| Meter reading lower than one recorded | Refused |
| Identical reading repeated | No-op, not an error |
| Session abandoned and swept | Billed nothing, bay freed, cannot be stopped later |
| Session stopped with no reading at all | Bills zero, frees the bay |
| One CDR per session, agreeing with the transaction | Holds |
| Reservation started by a stranger | Refused |
| Reservation consumed twice | Refused |
| Hold abandoned by a dead process | Returned by the sweep, to its original lots, keeping its expiry |
| Hold still inside its window | Left alone |
| Settled hold | Not disturbed by the sweep |
| Saga interrupted after the points were spent (QR and EV) | Points returned, transaction FAILED, bay freed |
| Ledger replay after a mixed run of successes and failures | Reconstructs the wallet exactly |
| Full partner life rebuilt from postings alone | Matches stored balances to the hundredth |
| Refund landing after the payout | Payable goes correctly negative; books balance |
| Every ledger transaction | ≥2 postings, netting to zero |

Refunds, settlement, payouts and reconciliation were probed and already had
thorough concurrency coverage of their own — over-refund at the database
level, two workers racing one payment, requester-confirms-own-payout, drift
detection and payout blocking. Nothing new was found there.

---

## Blockers — not fixed, and why

### B-1 — The roaming CDR loop is unbuilt · NOT VERIFIED

`OcpiAdapter.fetchCdr` is declared and **called from nowhere**. The platform
bills from meter values reported to its own API. For a roaming session the
authoritative energy figure is the CPO's settled CDR, which is never fetched,
so a roaming session would be billed on a client-reported number that nothing
external corroborates.

This is an incomplete integration, not a defect in running code — no CPO is
connected and no station carries an `ocpiEvseUid`. Building it is a feature:
fetch the CDR, reconcile it against the local session, and post an adjustment
where they differ. **It must exist before any roaming station goes live**,
and until it does, the request's section 3 — delayed, duplicate,
out-of-order and missing CDRs from a provider — is untestable because there
is no inbound CDR path to test.

### B-2 — The EV stop path has no idempotency key · partially mitigated

F-2 makes a concurrent double-stop safe, and a sequential one was already
refused. But unlike the QR path, the EV stop accepts no client-supplied
idempotency key, so a client that retries after a timeout cannot be told
"this is the same request" — it is told the session cannot be stopped, which
is correct but indistinguishable from a genuine error. Adding a key to the
EV DTO is small and was not done here because it changes an API contract the
mobile app depends on, which is more than an audit should change unasked.

---

## Round two: production readiness

A second pass over the areas the first did not reach — authorization by
object id, database-level enforcement, and whether a money failure reaches a
human. Two more defects, both variants of ones already fixed, in places those
fixes did not touch.

### F-7 (High) — A cleanup path could hand away a bay that was charging

`EvReservationsService.cancel` and `expireStaleReservations` both selected
their target outside the transaction and then wrote the connector to
`AVAILABLE` unconditionally. A customer plugging in at minute fourteen of a
fifteen-minute hold — exactly when people hurry — starts a session inside the
window between that select and that write, and the release then sells the
next customer a cable that is already delivering energy to this one's car.
The sweep also stamped `EXPIRED` on a hold that had just been fulfilled,
recording that the customer never turned up for a session they were charging
on.

*Fix:* both releases conditional on the bay still being `RESERVED`; the sweep
expires only a hold still `CONFIRMED`, and frees the bay only if that
succeeded.

*Proof:* `reservation-race.int-spec.ts`. Worth noting how: the first version
raced the two calls with `Promise.allSettled` and **passed**, which proved
nothing — that interleaving is not reliably produced. The state the stale
read actually creates is now constructed directly, which fails before the fix
and passes after.

### F-8 (High) — A rollback that itself failed was silent

`compensateReservation` and `reverseAccrualLot` were wrapped in
`.catch(logger.error)`. When one fails, the customer's points stay spent
against a transaction marked FAILED — and **nothing else on the platform will
find it**. Reconciliation sees a consistent ledger, because the points really
were spent. The expiry sweep only returns holds that are still *active*. The
sole record was a log line.

*Fix:* both sagas fire a critical alert. That is exactly the contract
`AlertsService` exists for, and it is safe inside a catch block because it
never throws.

*Proof:* `crash-recovery.int-spec.ts` › "tells a human, because nothing else
will find it" — asserts both the alert and that the customer really is short,
so the alert is not belt-and-braces.

### Also in round two

- **IDOR sweep.** Every route taking an id was enumerated (20 of them) and
  the ones not already covered elsewhere were attacked as the wrong customer
  and the wrong partner: notifications, charging sessions, meter values,
  reservations, transaction history. **All nine passed first time — nothing
  found.** Per-user scoping is consistently applied.
- **Database enforcement.** 21 CHECK constraints, all `VALID` rather than
  `NOT VALID` — including `wallets_balances_non_negative`, which means no
  code path, present or future, can persist a negative balance. Schema and
  migration history agree (`migrate diff` reports no difference).
- **Unindexed foreign keys.** Eleven exist; nine are on small reference
  tables where it does not matter. Two on `ev_reservations` had real query
  paths on a table that grows with every hold — `listMine` and the expiry
  sweep — and are now indexed.

---

## Verification

Everything below was executed on this machine, at `9e02396`.

| Check | Result |
| --- | --- |
| `pnpm --filter @tutak/api test:unit` | 77 passed |
| `pnpm --filter @tutak/api test:int` | **506 passed**, 43 suites |
| `pnpm --filter @tutak/mobile test` | 41 passed |
| `pnpm --filter @tutak/admin test` | 14 passed |
| `pnpm --filter @tutak/partner test` | 9 passed |
| `pnpm lint` | clean |
| `pnpm typecheck` | clean, 7 packages |
| `pnpm build` | clean, 3 apps |
| `pnpm audit --audit-level moderate` | 3 high, 1 moderate — all build-time deps of the mobile app or Swagger, none on a request path (unchanged, see `WEAK_SPOTS_RU.md` §3) |

**Tests added: 54** across seven new suites — `concurrency-probe` (14),
`money-rounding` (6), `ev-lifecycle-probe` (12), `crash-recovery` (9),
`partner-reconstruction` (3), `reservation-race` (7), `idor-sweep` (9).
Integration total went 446 → 506.

**CI, at `6b3ad06`:** both jobs green
([run 31280421849](https://github.com/arman119090-cmyk/TuTak-Platform/actions/runs/31280421849)).
That run is also the only evidence for three things this machine cannot
check: the Playwright end-to-end suite against the booted stack, the
backup-and-restore rehearsal, and the fact that all three container images
still build and boot now that they run as `node` rather than root.

**Not verified, stated plainly:**
- No load or soak test was run in this round; the numbers in
  `docs/LOAD_TEST.md` predate these changes.
- The roaming/OCPI path (B-1) is untested against any real CPO.
- Postgres and Redis failure injection was not performed at the
  infrastructure level. Crash recovery was exercised by interrupting sagas
  in-process, which covers the application's compensating logic but not, for
  example, a Postgres failover mid-transaction.

---

## Is the financial core production-ready?

**For the loyalty and payments business: yes, with the reservations below.**
The double-entry ledger reconstructs from its own postings under every
sequence tested, including refunds after payouts. Every money path now claims
before it acts rather than checking and hoping. Concurrency, idempotency,
partial failure and abandonment are all covered by tests that fail when the
protection is removed.

**For EV charging with roaming partners: no.** B-1 is a gap in an
integration that would carry real money, and billing a roaming session
without reconciling the CPO's CDR means the platform's figure and the
network's figure can disagree with nothing to catch it.

**Two things this audit cannot tell you.** It was performed by the code's own
author, which is worth less than an independent review — and the pattern
across three rounds is consistent: each round finds real defects in areas the
previous round passed, because each round attacks in a way the previous one
did not. That is evidence the remaining unknown defects are the ones these
particular attacks do not reach, which is an argument for an external review
before real money, not a certificate.

The other is that no amount of testing substitutes for the operational
readiness items in `WEAK_SPOTS_RU.md` — encrypted backups, point-in-time
recovery, and more than one instance of anything.
