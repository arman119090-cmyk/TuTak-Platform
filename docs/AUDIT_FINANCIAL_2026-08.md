# TuTak — financial core audit, August 2026

Scope: the money. Bonus lifecycle, ledger atomicity, idempotency, concurrency,
the charging lifecycle, partner accounting, and recovery from interruption.

Method: attack the running code with whatever the existing suites had not.
That started as **operations in flight at the same time** and **numbers that
do not divide evenly**, and became, round by round, killing the database
mid-transaction, generating orderings nobody would write down, and finally
leaving the API alone and attacking the screens that call it. Every finding
below was reproduced by a test that failed before the fix and passes after
it — checked by removing the fix again, which is how three tests in round
five were found to be worthless. Nothing here was concluded by reading
alone.

State audited: `ff96a6a`, 446 integration tests passing. State after round
four: `8851561`, 627 API tests passing. Round five moved to the clients —
after it, 627 API, 65 mobile, 28 admin, 9 partner.

---

## Summary

| | Found | Fixed | Verified by test |
| --- | --- | --- | --- |
| Critical | 5 | 5 | yes |
| High | 5 | 5 | yes |
| Medium | 4 | 4 | yes |
| Blockers raised, later closed | 2 | 2 | yes |

Five rounds, each attacking in a way the previous one did not — which is the
only reason each found anything, and the reason to expect a sixth would too.

1. **The money paths**, concurrently and with awkward amounts. F-1 to F-6.
2. **Production readiness**: authorization by object id, database-level
   enforcement, whether a failure reaches a human. F-7, F-8 — see §Round two.
3. **The database goes away mid-transaction.** F-9, F-10, both Critical, both
   invisible to every previous round because no previous round had killed
   anything.
4. **Random sequences with invariants checked after every step.** F-11, found
   by an ordering nobody had thought to write down.
5. **The client, not the server.** F-12, F-13, F-14 — server guarantees that
   can only be reached through a cooperating client, and three clients that
   were not cooperating.

Where the defects were, by round, because the answer changed:

Rounds one and two found everything in the **loyalty and EV paths** — older
code that had drifted from the conventions the financial core established
later. The financial core proper held everything those rounds threw at it:
conditional-update claims, explicit rounding, concurrency already tested.

Round three found two Criticals **inside that same financial core**, so the
sentence this paragraph used to contain — that every defect was in the older
paths — did not survive the first round that attacked in a genuinely new way.
It is left visible here rather than quietly deleted, because the pattern is
the finding: what an audit has not attacked reads exactly like what an audit
has cleared.

Round five found its two **outside the API altogether**, in the operator's
browser, where no amount of server-side testing could have reached them.

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

## Blockers — since closed

Both were reported as blockers in the first round and built in the third. The
original text is kept below each, because what a blocker *was* is the useful
record.

### B-1 — The roaming CDR loop · **CLOSED**

`ev.reconcile-roaming-cdrs` polls the operator for the settled CDR and
compares it against what was billed. An overcharge is corrected and returned
automatically — transaction down, over-accrued points clawed back in
proportion, over-applied points returned. An undercharge is recorded and
alerted but **never** silently taken: reaching into a customer's wallet days
later for a figure they never saw is a second charge, not a correction. A CDR
that never arrives gives up after twelve attempts and alerts.

Covered by 13 tests. Still **NOT VERIFIED against a real CPO** — the adapter
is exercised through a stub, because no operator is connected.

*Original finding:*

### B-1 (as first reported) — The roaming CDR loop is unbuilt · NOT VERIFIED

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

### B-2 — The EV stop path has no idempotency key · **CLOSED**

`StopSessionDto` takes an optional `idempotencyKey`. A client that sends one
gets the original result back on a retry instead of an error; one that does
not — including every currently installed copy of the app — behaves exactly as
before. Keys are scoped per caller, so one customer cannot replay another's.

*Original finding:*

### B-2 (as first reported) — no idempotency key · partially mitigated

F-2 makes a concurrent double-stop safe, and a sequential one was already
refused. But unlike the QR path, the EV stop accepts no client-supplied
idempotency key, so a client that retries after a timeout cannot be told
"this is the same request" — it is told the session cannot be stopped, which
is correct but indistinguishable from a genuine error. Adding a key to the
EV DTO is small and was not done here because it changes an API contract the
mobile app depends on, which is more than an audit should change unasked.

---

## Round three: the database goes away mid-transaction

Crash recovery had been tested by interrupting sagas *in process* — throwing
at a chosen line and checking the compensation. That covers the
application's own logic and says nothing about Postgres itself stopping
halfway through. `scripts/chaos-postgres.sh` now does the second one: it
drives real captures through the engines and stops the cluster with
`-m immediate`, which is as close to a power cut as a script gets.

### F-9 (Critical) — a crash mid-capture let the customer be charged twice

**Found by:** the first run of the chaos driver. 5,220 captures reported
success, every one backed by a ledger transaction — and **5,261 payments
against 5,260 completed idempotency records**. One payment existed whose
idempotency key had been forgotten.

**Why.** `IdempotencyService.execute` runs the work, then marks the record
COMPLETED **in a separate transaction**, and on failure *deletes* the record
so the next attempt can claim cleanly. Each half is reasonable alone. Together
they leave a window: the payment commits, the record is then deleted or never
completed, and the key's only memory is gone. A client whose request timed out
retries — which is the common case on mobile data, not the exception — and the
retry finds nothing to replay.

**Confirmed deterministically**, not by racing for a 1-in-5,000 interleaving:
capture a payment, delete its idempotency record the way the failure path
does, retry with the same key. Two payments. `DOUBLE CHARGE CONFIRMED`.

**Fix.** The key now lives on the payment itself under
`@@unique([userId, idempotencyKey])`. The record table becomes an
optimisation and the database becomes the guarantee — a second charge is
refused whatever happened to the record. `executeCapture` looks the key up
before charging, and treats a collision on that index as "this already
happened" and returns the original payment. Scoped to the user, because two
customers may legitimately choose the same key.

**Verified after the fix:** the same chaos run, same outage, now reports
**5,265 payments against 5,265 completed records** — exactly equal — with
every reported success backed by a ledger transaction, debits equal to
credits, and no orphaned postings. Five regression tests in
`payment-key-durability.int-spec.ts`; four of the five fail when the fix is
reverted, which is what makes them worth having.

### F-10 (Critical) — the same window paid refunds and payouts twice

F-9 fixed capture. It did not fix `IdempotencyService`, and three other
engines call it. Two of them hand money outward.

**Found by asking where else.** `AcquirerSettlement` turned out to be safe —
it has `reference @unique`, a natural key that refuses a duplicate. The EV
stop path is safe too; its conditional claim on `stoppedAt` was built in the
first round. `Refund` and `Payout` had nothing.

**Confirmed by construction, not by racing.** Refund 500 of a 1,000 payment,
delete the idempotency record the way the failure path does, retry the same
key: a second refund, a different id, 1,000 returned on a 1,000 purchase that
an operator authorised 500 against. Request a payout, delete the record,
retry: the partner paid twice.

Both are *bounded* — a refund by what remains refundable, a payout by what is
owed — and bounded is not safe. Every part of that second 500 was within
bounds.

**Fix.** The same shape as F-9: the key on the row, under a unique index
scoped to the actor. `Refund` also gains `actorId`, which it did not have —
until now nothing on the refund row said who authorised it, only the audit
log. The refund path releases its `refundedAmount` claim before returning the
original, so a duplicate does not leave the payment permanently
under-refundable.

**The test that proved nothing.** The first version of this suite checked
that the ledger still balanced after the replay. It passed *before* the fix.
Debits equalled credits, every account agreed with a replay of its own
postings, and the customer had been paid twice — because a duplicate refund
is two complete, correct, balanced transactions. Asserting the *amount* is
what turned it into a test. Three tests now, all three failing when the fix
is reverted.

## Round four: sequences nobody thought to write down

Every suite up to here tests a scenario somebody imagined. Both Criticals
above were found by attacking in a way no previous round had, not by looking
harder at what was covered — so the next thing to try was a generator that
does not know what a bug looks like and only knows what must stay true.

`money-sequence-fuzz.int-spec.ts` runs seeded random sequences of capture,
refund, settlement, outbox drain, payout request and payout confirmation, and
checks every invariant after every step. Amounts are deliberately awkward
(`333.33`, not `1000`), refusals are counted rather than avoided, and the
seed is printed so a failure is a test case rather than a ghost.

Run at 20 seeds × 400 steps. Three seeds failed, all on the same thing.

### F-11 (Medium) — a refund could leave a partner owing the platform, silently

**The sequence.** A partner earns, the platform pays them out in full, and
only *then* is the customer refunded. The refund debits a payable the payout
already emptied, so the account crosses zero: the platform is out of pocket
and the partner owes the difference.

**Nothing is broken by this.** The ledger balances, the postings are right,
and `requestPayout` already refuses a partner whose balance is against them —
verified, not assumed. The gap was that **nobody was told.** Money outside
the platform that only a person can retrieve is a write-off if that person
never hears about it, and the only way to notice was to read the ledger
account.

`RefundEngineService` now raises a `warning` alert keyed on the partner — one
conversation, not one notification per refund — naming the amount owed. It
cannot fail a refund: the money has already moved and the customer is owed
their money regardless of whether the notification lands.

**My invariant was also wrong**, and worth recording as such. It asserted a
partner payable could never go positive. That state is legitimate, and the
generator disproved the assertion on its third seed. What replaced it is the
bound that does hold: a partner can never owe more than the platform ever
paid them, which would mean a refund reversed money that was never sent.

Four tests in `refund-partner-debit.int-spec.ts`, including one asserting
silence in the ordinary case — an alert that fires on every partial refund
would be worse than none.

After the fix: 20 seeds × 400 steps, clean.

### The harness itself was wrong, and would have passed the bug

The first chaos run printed **PASS** while that extra payment sat in the
data. Its duplicate check compared payment count against *distinct keys
attempted* — but nearly every attempt fails during an outage, so that ceiling
was 35,000 and the check could never fire. It now compares payments against
completed records, one to one, and separately refuses any payment stored
without a key.

Worth recording plainly: a green harness proved nothing here. The defect was
found by reading numbers that did not add up in output the harness had
already declared clean.

---

## Round five: the client undoes the server

Every round so far attacked the API. That is where the money is, and it is
also where all the protection was verified — which turned out to be the
limitation, because two of the guarantees the server offers can only be
reached through a client that cooperates, and one of them did not.

This round asked a different question: **if the server is right, can the
screen still lose money?**

### F-12 (High) — a timed-out refund could be paid twice from the admin panel

**What was wrong.** `apps/admin/src/lib/api/financeApi.ts` minted a fresh
idempotency key inside each request function, with a comment arguing the case:
a retry the operator starts deliberately is a new refund, not a replay of the
last one.

That argument assumes the operator can tell a refusal from a lost answer. They
cannot. `httpClient` gives up after fifteen seconds. A refund that commits on
the server at sixteen — a cold instance, a slow ledger transaction, a proxy
that drops the connection — arrives on screen as
`timeout of 15000ms exceeded`. The money moved. The screen says it failed. The
only sensible thing to do with a failed refund is try it again, and the second
attempt carried a different key.

**Why none of the server's protection helped.** F-9 and F-10 put the caller's
key on the money row itself under a unique index, so a *repeated* key cannot
produce a second refund. Nothing in that design can engage against a client
that never repeats one. The guarantee was real and unreachable.

It reached three operations: refunds, payout requests, and acquirer
settlements — every write on the admin panel that moves money.

**The fix.** The key now identifies the operator's intention rather than the
HTTP attempt. `useIdempotencyKey` holds one for as long as the operation would
do the same thing and mints a new one when it would not: a different payment,
a different amount, a different partner. A refund's *reason* is deliberately
excluded from that identity — rewording a note is not authorising a second
refund, and an operator who improves the wording after a timeout must not
thereby pay twice. Each API function takes the key as a required argument, so
a new call site cannot omit one.

**The mobile app already knew this.** `ScanQrScreen` mints one key when the QR
code is scanned and holds it across retries, and its comment names the double
charge that taught it. The same defect, in the same shape, had been found and
fixed on the customer side and left standing on the operator side — where the
amounts are larger and the payee is not the person holding the phone. Worth
recording as the lesson of this round: a fix is not finished when the place it
was found is fixed.

### F-13 (Medium) — a dismissed dialog confirmed the payout anyway

Confirming a payout asked for the bank reference with
`window.prompt('Bank reference?') ?? 'unknown'`. Escape and Cancel both return
null, so dismissing the dialog did not cancel anything — it confirmed the
transfer and recorded the reference as the literal string `unknown`. Money
marked as sent to a partner's bank, against a reference that can never be
matched to a statement. `Mark failed` had the same shape with `unspecified`.

Confirmation is the second half of the two-person rule and the one action on
that screen that has to be deliberate. A cancelled dialog is the plainest way
a person can say no, and the screen read it as yes.

The prompt now runs before the mutation and a null answer ends it. An empty
answer is treated differently on purpose — they pressed OK, so they get a
sentence explaining what the reference is for, rather than silence.

### F-14 (Medium) — stopping a charge never used the key the API added for it

F-2, at the top of this document, was a double-tapped stop that billed twice.
The API grew an idempotency key for stop in response and left it optional,
with a comment stating the reason: *"the shipped mobile app does not send one
and making it mandatory would break every installed copy."*

There is no installed copy. The first APK was built the same day this round
ran. The justification for leaving the protection unused had expired without
anyone noticing, and the endpoint's only client still sent nothing.

**The key is derived, not generated**, which is stronger than what the admin
panel can manage. A random key in component state is lost when the app is
killed — and being killed is what happens at a charge point: the request times
out on bad signal, the customer force-closes the app, reopens it, presses stop
again. `ev-stop-<session>-<bonus>` is the same key on the other side of that.
The bonus is part of the identity because it changes what the stop costs.

The server side was already covered by `ev-lifecycle-probe.int-spec.ts`,
including a stranger attempting to reuse someone else's key. What was missing
was a client that used it at all.

**Three apps, one defect.** `ScanQrScreen` had this shape and was fixed when a
double charge exposed it. The admin panel had it. Stopping a charge had it.
Each was fixed where it was found and nowhere else — which is what makes it
worth stating as a rule rather than three incidents: when a client-side defect
is found, the question is which other clients share it.

### The tests were wrong first, in a way worth recording

Three of the five payout tests were written in a form that passed whether or
not the bug was present: a mutation does not call its `mutationFn`
synchronously, so `expect(confirmPayout).not.toHaveBeenCalled()` asserted
immediately after the click is true either way. They only became worth having
once the click was allowed to settle first.

This was caught by the standing practice of removing each fix and watching its
test fail. Three of them did not. That is the second time in this document a
harness has had to be fixed before it could find anything — and both times the
harness was green.

### What this round could not check

The admin panel now has page-level tests; the partner dashboard has no write
that moves money, so there was nothing of this kind to find there. Neither
dashboard has been driven by a human against a live API since these changes.

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

Everything below was executed on this machine, at `8851561`.

| Check | Result |
| --- | --- |
| `pnpm --filter @tutak/api test:unit` | 77 passed |
| `pnpm --filter @tutak/api test:int` | **522 passed**, 44 suites |
| `pnpm --filter @tutak/mobile test` | 41 passed |
| `pnpm --filter @tutak/admin test` | 14 passed |
| `pnpm --filter @tutak/partner test` | 9 passed |
| `pnpm lint` | clean |
| `pnpm typecheck` | clean, 7 packages |
| `pnpm build` | clean, 3 apps |
| `pnpm audit --audit-level moderate` | 3 high, 1 moderate — all build-time deps of the mobile app or Swagger, none on a request path (unchanged, see `WEAK_SPOTS_RU.md` §3) |

**Tests added: 70** across eight new suites — `concurrency-probe` (14),
`money-rounding` (6), `ev-lifecycle-probe` (12), `crash-recovery` (9),
`partner-reconstruction` (3), `reservation-race` (7), `idor-sweep` (9),
`ev-cdr-reconciliation` (13). Integration total went 446 → 522.

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

**For EV charging with roaming partners: the code is ready; the integration
is unproven.** B-1 is built and tested — a roaming session is now reconciled
against the operator's own CDR, and a disagreement is either returned or
escalated. What cannot be claimed is that it works against a *real* CPO:
every test drives a stubbed adapter, because no operator is connected. Before
the first roaming station carries money, run a handful of real sessions
against the operator's sandbox and confirm the CDRs come back in the shape
the adapter expects. That is an afternoon, not a project — but it has not
been done.

**Two things this audit cannot tell you.** It was performed by the code's own
author, which is worth less than an independent review — and the pattern
across five rounds is consistent: each round finds real defects in areas the
previous round passed, because each round attacks in a way the previous one
did not. That is evidence the remaining unknown defects are the ones these
particular attacks do not reach, which is an argument for an external review
before real money, not a certificate.

The other is that no amount of testing substitutes for the operational
readiness items in `WEAK_SPOTS_RU.md` — encrypted backups, point-in-time
recovery, and more than one instance of anything.
