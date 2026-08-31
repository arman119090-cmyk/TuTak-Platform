# Load test: what the money paths do under concurrency

Two things are being asked here, and only one of them is "how fast".

The first is whether the double-entry ledger survives concurrent writes. Every
capture writes a payment row, three postings and an outbox event in one
transaction, and moves three account balances — two of which every other
concurrent capture is also moving. Every payout takes `FOR UPDATE` on the same
partner's payable. Code like that can be correct at one request per second and
wrong at two hundred, and the failure mode is not a stack trace, it is a
partner who was paid twice.

The second is the throughput number, which only means anything if the first
one passed. **Both runs below ended with all accounts summing to zero and
every account's stored balance equal to a replay of its own postings.** A
throughput figure from a run that corrupted the ledger would be worse than no
figure at all, so the harness asserts that invariant and exits non-zero if it
fails.

## Running it

```bash
cd apps/api
pnpm run build

# A scratch database. Never point this at anything you care about: it creates
# users, captures thousands of payments and requests thousands of payouts.
psql "$ADMIN_URL" -c 'CREATE DATABASE tutak_load'
export DATABASE_URL="postgresql://tutak:...@127.0.0.1:5432/tutak_load?schema=public"
export SEED_ADMIN_PASSWORD="…"       # roles and permissions must exist first
./node_modules/.bin/prisma migrate deploy
node dist/scripts/seed-baseline.js

LOAD_CONCURRENCY=32 LOAD_SECONDS=15 LOAD_CUSTOMERS=50 node dist/scripts/load-test.js

# LOAD_PARTNERS spreads the purchase phase across that many merchants. One
# by default — the busy-fuel-station case. Raise it to tell "this merchant is
# saturated" apart from "the platform is saturated".
LOAD_PARTNERS=32 node dist/scripts/load-test.js

# The money-path phases: LOAD_MONEY_CUSTOMERS customers spread over
# LOAD_REFERRAL_TREES three-deep referral trees, each warmed up with one
# purchase of LOAD_WARMUP_GROSS so they have bonus to spend, then spending
# LOAD_BONUS_SPEND of it per purchase. Raising the customer count against a
# fixed concurrency is what separates same-customer contention from a
# platform-wide limit.
LOAD_MONEY_CUSTOMERS=100 LOAD_REFERRAL_TREES=10 node dist/scripts/load-test.js
```

It drives the engines directly rather than going over HTTP, on purpose:
`POST /payments` is rate limited to ten a minute per address, so an HTTP load
test from one machine measures the throttler and nothing else. The throttler
is not the part that can lose money.

## Results

**Re-measured 9 August 2026** against the current code, after the financial
audit rounds. The previous figures predated every fix in
`AUDIT_FINANCIAL_2026-08.md` and were left in place long enough to be
misleading; these replace them.

Measured on the development container — 4 × Xeon @ 2.10GHz, 15.7 GiB, Node
22.22, Postgres 16.13 — with Postgres, the API process and the load generator
all sharing those four cores. The box is a slower one than the earlier runs
used (2.10 vs 2.80 GHz), so read these against each other, not against the
numbers they replaced. Treat these as a shape, not a capacity plan; see
[What these numbers are not](#what-these-numbers-are-not).

### Concurrency 32

| Phase | Throughput | p50 | p95 | p99 | Failed |
|---|---|---|---|---|---|
| Payment capture | 143.2 /s | 201 ms | 348 ms | 438 ms | 0 / 2168 |
| Idempotent replay | 1636.3 /s | 19 ms | 24 ms | 27 ms | 0 / 16378 |
| Outbox drain (settlement) | 45.3 events/s | — | — | — | 0 dead-lettered |
| Contended payouts, one partner | 119.3 /s | 95 ms | 289 ms | 531 ms | 0 / 1206 |

Ledger after the run: 5 accounts, 13,262 postings, **sum 0.0000**, every
account agreeing with a replay of its postings. 1,206 payouts of 10 AMD moved
exactly 12,060 AMD out of the partner's payable — no double payment, no
shortfall.

### Concurrency 64

| Phase | Throughput | p50 | p95 | p99 | Failed |
|---|---|---|---|---|---|
| Payment capture | 154.6 /s | 399 ms | 517 ms | 590 ms | 0 / 2372 |
| Idempotent replay | 1652.0 /s | 38 ms | 46 ms | 50 ms | 0 / 16546 |
| Outbox drain (settlement) | 45.0 events/s | — | — | — | 0 dead-lettered |
| Contended payouts, one partner | 109.4 /s | 114 ms | 302 ms | 442 ms | 0 / 1107 |

Ledger after the run: 14,084 postings, **sum 0.0000**, no drift. 1,107 payouts
moved exactly 11,070 AMD.

### The purchase path, and the cliff — 30 August 2026

The four phases above all drive `PaymentEngineService`, which lives behind
`CARD_PAYMENTS_ENABLED` and is off in production. A fifth phase now drives
what a till actually runs: create a `PurchaseIntent`, then confirm it. That
one transaction claims the intent, settles the bonus reservation, computes
the pool against the rate snapshotted at creation, splits it across the
referral chain, writes the bonus and deferred lots, and posts the partner's
contribution to the ledger.

Same box, same run, one merchant, 50 customers:

| Concurrency | Pool | Throughput | p50 | Failed |
|---|---|---|---|---|
| 1 | 9 (default) | 23.3 /s | 43 ms | 0 / 141 |
| 8 | 9 (default) | 75.6 /s | 104 ms | 0 / 765 |
| 16 | 9 (default) | **0.7 /s** | **5094 ms** | **25 / 32** |
| 32 | 9 (default) | **0.2 /s** | **13131 ms** | **82 / 87** |
| 32 | 40 | 73.8 /s | 361 ms | 0 / 756 |

This is not a queue. It is a cliff, and it sits at the size of the Prisma
connection pool — nine on this box, because nothing sets one. Below it the
path is healthy and fast; one step above it, 78% of confirmations fail, and
at 32 in flight, 94% do. The p50 of 5094 ms at concurrency 16 is Prisma's
own five-second interactive-transaction timeout, to the millisecond: the
requests are not doing work, they are waiting for a connection and then
being killed.

Raising the pool to 40 removes it entirely — 73.8 confirmations a second at
concurrency 32, zero failures — which is the proof that the settlement's
design is not the problem. Nothing about the transaction is slow: one
confirmation alone takes 43 ms.

**Three things this rules out.** It is not lock contention on the merchant:
spreading the same load across 32 separate merchants collapses identically
(0.3 /s, 70 of 76 failed). It is not the database: sampling
`pg_stat_activity` through the phase shows the backends waiting on
`ClientRead` — Postgres idle, waiting for the application to send the next
statement — not on `tuple` or `transactionid` locks. And it is not the
settlement being heavy: it is that an interactive transaction holds its
connection for its whole duration, and this one makes many sequential
round-trips, so past the pool size every worker is waiting on every other.

Why the card path never showed this: its transaction is one short burst of
writes, so it holds a connection for a few milliseconds and 32 workers
timeshare nine connections happily. The purchase confirmation holds one for
two orders of magnitude longer.

**What it means for a deployment.** The pool is not a throughput knob here —
throughput is ~75/s either side of it — it is the maximum number of
purchase confirmations that may be in flight per API instance. Size it above
peak concurrent confirmations, then check the result against the
`max_connections` budget in [DEPLOYMENT.md](DEPLOYMENT.md#database-connections),
because that arithmetic pushes the same number down. If the two do not both
fit, the answer is more instances or a connection pooler, not a smaller
pool.

**The failure is safe, at least.** Every failed confirmation rolled back
whole: the ledger summed to zero after every run above, each account agreed
with a replay of its own postings, and the intents were left
`AWAITING_CONFIRMATION` with their reservations still active — retryable, no
manual compensation. The customer sees an error and taps again. That is the
atomic-claim design in `settlePurchase` doing exactly what its docblock
promises, under a load that breaks everything around it.

### The money paths, and the one conflict nobody was catching — 31 August 2026

Every phase up to here priced a purchase but never moved a customer's own
money: nothing requested bonus, so no hold was ever taken, and nobody had a
referrer, so the whole pool collapsed onto TuTak's residual leg. Three
phases now cover that. Customers earn a real balance from a warm-up purchase
rather than having one injected, and referral trees are built from the same
`ReferralInvite` rows the program itself walks — three referrers deep, with
several customers sharing each tree's level-1 referrer and several
independent trees settling at once.

Run at `DATABASE_CONNECTION_LIMIT=40`, one merchant, 20 money-path
customers, 4 trees, 15 s per phase.

**Before** — `BonusEngineService.reserve` on Serializable with nothing
retrying it:

| Concurrency | Bonus (reservation) | 3-level chain | Bonus + referral |
|---|---|---|---|
| 8 | 38.4/s, **306 of 888 failed** | 41.9/s, 0 of 634 | 22.0/s, **77 of 412** |
| 16 | 36.4/s, **443 of 997** | 42.9/s, 0 of 657 | 21.9/s, **387 of 722** |
| 32 | 32.1/s, **718 of 1208** | 41.8/s, 0 of 656 | 19.3/s, **771 of 1069** |

**After** the retry (see below):

| Concurrency | Bonus (reservation) | 3-level chain | Bonus + referral |
|---|---|---|---|
| 8 | 39.4/s, 2 of 599 | 41.5/s, 0 of 629 | 23.1/s, 0 of 353 |
| 16 | 38.8/s, 46 of 638 | 43.3/s, 0 of 660 | 25.0/s, 3 of 387 |
| 32 | 33.3/s, 40 of 564 | 40.4/s, 2 of 632 | 23.0/s, 9 of 380 |

**The referral side never failed once.** Concurrent purchases through
shared and independent chains, at every concurrency, before and after: zero
failures, and every split matched the program's own `computePoolSplit` on
all six legs across ~2,500 confirmed purchases per run.

**The bonus side was failing a third to three-quarters of the time,** and
the reason was one missing retry. `reserve` runs Serializable — it reads a
customer's available lots and writes them, and Serializable aborts the loser
of a conflict rather than queueing it. `ReferralService`,
`PurchaseIntentRefundService`, `EvSessionsService` and `LedgerService` all
wrap their Serializable transactions in a retry for exactly this reason;
`reserve` was the one that did not, so the abort reached the customer as a
failed payment.

It is same-customer contention, not a global limit: two purchases by one
customer both touch that customer's lots. Holding concurrency at 16 and
raising the customer count from 20 to 100 dropped the failure rate from 44%
to 2% on its own, which is the same collision measured from the other end.

Nothing was ever left half-applied. Across every run above, before and
after, all twelve money-path invariants held: wallet balances equal their
own lots and holds, every lot's consumption equals its allocations, no
reservation outlives or contradicts its intent, no wallet or deferred lot is
credited twice for one transaction, no failed confirmation left a financial
effect behind, and every failed purchase left its intent
`AWAITING_CONFIRMATION` with the customer's bonus untouched — retry-safe,
with no manual compensation. The ledger summed to zero and every account
matched a replay of its postings in all of them.

### Why payouts time out, and why that one is not a bug

A handful of payouts — 6 to 9 per thousand, from concurrency 16 upward —
fail with Prisma's 5-second interactive-transaction timeout. The
investigation:

- **Where the time goes.** Not in the work. A payout transaction runs in
  about 18 ms uncontended (concurrency 1, phase 4). Sampling
  `pg_stat_activity` through the phase finds backends parked on `Lock:
  tuple` against `SELECT balance FROM "ledger_accounts" WHERE id = $1 FOR
  UPDATE` — queueing for one partner's payable row. The 5-second clock
  starts when the transaction opens, before the lock is acquired, so a
  request that arrives when the queue is deep can burn its whole budget
  waiting its turn.
- **Is the serialization expected?** Yes, and it is the point. That
  `FOR UPDATE` is what stops two concurrent payouts from both reading the
  same pre-payout balance and both paying the partner. Removing it
  reintroduces double payment.
- **Can work move out of the transaction?** The obvious candidates already
  did: the idempotency lookup and both `accountFor` calls run before it
  opens. What remains — the balance check, the payout row, the ledger
  posting, and the update that links them — is the atomic unit itself. The
  one reducible round-trip is that final link, and removing it means
  letting callers supply a ledger-transaction id, which changes the shared
  `LedgerService` API used by every engine to shave a fraction off a hold
  time that is not the bottleneck. Not worth it.
- **Correctness or operations?** Operations. The transaction rolls back
  whole: 957 payouts across the runs above, **zero** left without their
  ledger transaction. The idempotency key survives the failure, and the
  code already treats a repeat of the same key as the same payout, so a
  retry produces exactly one. It is a retry case, on an admin action, at
  under 1%.

No code was changed for this. Raising the transaction timeout would hide
the queue rather than shorten it, and the queue is doing its job.

## Reading them

**The system is already saturated at 32 in flight.** Doubling concurrency
bought almost nothing — throughput moved 143 → 155 /s, an 8% gain for a
doubling — while median latency doubled exactly, 201 → 399 ms. That is a queue, not a capacity
increase: the extra 32 workers spend their time waiting. The binding constraint is the Prisma connection pool,
which is unset and therefore defaults to `num_cpus × 2 + 1` — nine connections
on this box. Raising `connection_limit` in `DATABASE_URL` is the first knob to
turn, and the second is more cores, because at 150 captures/s Postgres, the
node process and the load generator are contending for the same four.

**The idempotent replay path is nine times cheaper than the real thing**
(1636 /s vs 143 /s, p99 27 ms vs 438 ms — eleven times the throughput at a
sixteenth of the tail latency). This is the number that matters most
for a mobile app on Armenian mobile data, because a phone that does not hear
back retries, and the retry is the common case rather than the exception. A
replay reads one row by unique key and returns the stored response body; it
does not re-enter the transaction.

That path used to be expensive in a way that did not show up in latency.
`IdempotencyService.claim` claimed the key with an INSERT and caught the unique
violation, and `LedgerService.accountFor` did the same for accounts —
control flow by exception. Prisma's error listener logs every query error at
ERROR, so the first run of this harness produced **12,836 ERROR lines** and the
report itself was unreadable. In production, with alerting wired to error rate,
a patchy evening on the mobile network would have paged someone continuously
for behaviour that is entirely correct. Both are now
`createMany({ skipDuplicates: true })` — `INSERT … ON CONFLICT DO NOTHING`,
which returns a count of zero instead of raising. The runs above emit **zero
ERROR lines**.

**Settlement drains at 45 events/s, under a third of the rate captures are
produced under saturation.** This is the weakest number in the report and the
one worth watching. It is not currently a problem — the platform's real volume
is a few hundred payments a day and the backlog clears in seconds — but under
sustained peak the queue grows.

One drainer is 45/s. The drain claims its batch with `FOR UPDATE SKIP LOCKED`
under a lease, which is exactly what makes several drainers safe: a second one
picks up different events rather than fighting for the same ones. It was the
advisory lock around the sweep, not the query, that capped settlement at one
drainer platform-wide — so that lock is now off for this one job
(`apps/api/src/modules/sweeps/sweeps.jobs.ts`), and drain capacity scales with
worker concurrency and instance count. The number above is deliberately still
the single-drainer figure: it is the floor, and the floor is what a capacity
question needs.

**Contended payouts serialize, and that is the design.** 16 workers all take
`FOR UPDATE` on one partner's payable balance, so they go one at a time; 119/s
through a lock held across a ledger post is healthy. The number to check here
was never throughput, it was `owed after` — which stayed positive in both runs.
A partner cannot be overpaid by racing the endpoint.

**Nothing dead-lettered in either run.** Every outbox event settled within its
attempt budget, so the serialization-failure retry loop absorbed the write
contention rather than surrendering events to a human.

## What these numbers are not

- **Not a capacity plan.** Everything shares four cores here, including the
  load generator. A production database on its own hardware behaves
  differently, usually better, and the only honest way to know is to re-run
  this against staging.
- **Not an HTTP measurement.** There is no auth, no validation, no throttler,
  no JSON serialization and no network in these numbers. Real end-to-end
  latency is higher.
- **Not the settlement rate you will see.** The harness drains the outbox
  itself with `SWEEPS_ENABLED=false`, so the figure is one drainer with nothing
  else competing. A real deployment runs the drain on a BullMQ worker at up to
  four concurrent jobs per instance.
- **Not a soak test.** Fifteen seconds finds lock contention and lost races. It
  does not find leaked connections, unbounded caches or index bloat, which need
  hours.
- **Not the acquirer.** Captures run against the sandbox payment provider,
  which answers immediately. A real acquirer adds hundreds of milliseconds and
  its own rate limit, and that — not this ledger — will be the ceiling in
  production.

## Re-running it after a change

Any change to the ledger, the outbox, idempotency, or a transaction boundary
should be followed by a run of this harness, for the invariant assertion far
more than for the numbers. Record the new figures here when they move
materially, and keep the environment block from the run output alongside them —
numbers without the machine they were measured on are a rumour, not a result.
