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
```

It drives the engines directly rather than going over HTTP, on purpose:
`POST /payments` is rate limited to ten a minute per address, so an HTTP load
test from one machine measures the throttler and nothing else. The throttler
is not the part that can lose money.

## Results

Measured on the development container — 4 × Xeon @ 2.80GHz, 15.7 GiB, Node
22.22, Postgres 16.13 — with Postgres, the API process and the load generator
all sharing those four cores. Treat these as a shape, not a capacity plan; see
[What these numbers are not](#what-these-numbers-are-not).

### Concurrency 32

| Phase | Throughput | p50 | p95 | p99 | Failed |
|---|---|---|---|---|---|
| Payment capture | 126.0 /s | 238 ms | 369 ms | 459 ms | 0 / 1912 |
| Idempotent replay | 1543.2 /s | 20 ms | 26 ms | 30 ms | 0 / 15443 |
| Outbox drain (settlement) | 44.0 events/s | — | — | — | 0 dead-lettered |
| Contended payouts, one partner | 116.3 /s | 104 ms | 302 ms | 504 ms | 0 / 1179 |

Ledger after the run: 5 accounts, 11,928 postings, **sum 0.0000**, every
account agreeing with a replay of its postings. 1,179 payouts of 10 AMD moved
exactly 11,790 AMD out of the partner's payable — no double payment, no
shortfall.

### Concurrency 64

| Phase | Throughput | p50 | p95 | p99 | Failed |
|---|---|---|---|---|---|
| Payment capture | 133.2 /s | 460 ms | 591 ms | 710 ms | 0 / 2045 |
| Idempotent replay | 1377.1 /s | 45 ms | 62 ms | 72 ms | 0 / 13796 |
| Outbox drain (settlement) | 42.7 events/s | — | — | — | 0 dead-lettered |
| Contended payouts, one partner | 109.7 /s | 103 ms | 327 ms | 500 ms | 0 / 1109 |

Ledger after the run: 12,453 postings, **sum 0.0000**, no drift. 1,109 payouts
moved exactly 11,090 AMD.

## Reading them

**The system is already saturated at 32 in flight.** Doubling concurrency
bought 5% more throughput (126 → 133 /s) and doubled median latency
(238 → 460 ms). That is a queue, not a capacity increase: the extra 32 workers
spend their time waiting. The binding constraint is the Prisma connection pool,
which is unset and therefore defaults to `num_cpus × 2 + 1` — nine connections
on this box. Raising `connection_limit` in `DATABASE_URL` is the first knob to
turn, and the second is more cores, because at 126 captures/s Postgres, the
node process and the load generator are contending for the same four.

**The idempotent replay path is twelve times cheaper than the real thing**
(1543 /s vs 126 /s, p99 30 ms vs 459 ms). This is the number that matters most
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

**Settlement falls behind capture at roughly 3:1** — 44 events/s drained
against 126/s produced. This is the weakest number in the report and the one
worth watching. It is not currently a problem: the platform's real volume is a
few hundred payments a day, and the backlog drains in seconds. But the drain is
a single in-process loop taking 50 events at a time with
`FOR UPDATE SKIP LOCKED`, and `SKIP LOCKED` is precisely what makes it safe for
several drainers to run at once. The fix, when it is needed, is more drainers
rather than a faster one — which is the argument for moving the sweepers onto a
real queue rather than in-process cron.

**Contended payouts serialize, and that is the design.** 16 workers all take
`FOR UPDATE` on one partner's payable balance, so they go one at a time; 116/s
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
