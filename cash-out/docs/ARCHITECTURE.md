# Architecture

## The problem

Two systems, neither of which we control, must agree about one movement of
money:

- **Yandex** holds the driver's balance inside a park. We can read it and post a
  transaction against it.
- **A bank or PSP** moves real money to the driver's card.

Neither participates in a transaction with us. So for every withdrawal there is
a window in which one leg is applied and the other is not, and the design's only
real job is to make sure that window always closes in a way that loses nothing.

## The decision everything follows from

A settled bank transfer cannot be taken back. A Yandex balance debit can always
be compensated by posting the opposite transaction.

So the compensatable leg goes first:

```
      debit Yandex  ──▶  confirmed?  ──▶  instruct the bank  ──▶  settled?
            │                │                    │                  │
            │                ├── in_progress ─▶ poll status          │
            │                └── unknown ─▶ replay/probe             │
            │                                     └── failed ─▶ compensate
            └── rejected ─▶ fail (nothing moved)                     │
                                                                     ▼
                                                                 completed
```

Reversed, a Yandex outage after a successful transfer would be money out of the
door with no corresponding debit — an unrecoverable loss, once per affected
withdrawal.

## Uncertainty is a state

Every call to an external system has three outcomes, not two: applied, not
applied, and **unknown**. Collapsing "unknown" into "failed" is how a driver
gets paid twice.

Each external call therefore has an explicit `*_UNCERTAIN` state whose only exit
is a probe of the remote system, keyed by our own idempotency key. Fleet API v3
adds a fourth answer — `in_progress`, a transaction that exists with an id but
no outcome yet — and that is its own state too, `RESERVE_PENDING`, driven only
by the status endpoint. The keys —
`yandexIdempotencyToken` and `providerIdempotencyKey` — are generated once when
the withdrawal row is created and reused by every retry of every step.

The full machine, with every legal transition and the reasoning, is in
[`packages/contracts/src/withdrawal-state.ts`](../packages/contracts/src/withdrawal-state.ts);
its invariants are asserted in that package's tests, including "never reaches
FAILED from a state where the driver has already been debited".

## Record intent, then act

Each external call is preceded by a state transition into a `*_ING` state. A
process that dies mid-call leaves a row that says "we may have called Yandex",
so recovery is a probe rather than a guess. The alternative — call first, write
afterwards — throws away exactly the information you need when the crash happens
between the two.

Nothing external is called inside a database transaction. A slow bank must not
hold a transaction open.

## Money

Amounts are integer minor units on `bigint`, everywhere: in `packages/money`, in
the `BigInt` columns, and on the wire as `{ minor: "123456", currency: "AMD" }`.
There is no floating point anywhere near an amount, and no JSON number either —
a `double` loses AMD minor units above 2^53, which an active park can reach.

Fees are exact rationals (`numerator/denominator`, typically basis points) with
an explicit rounding mode per component. Every quote is checked against
`gross = net + platformFee + providerFee` before it leaves the fee engine, again
by a database `CHECK` constraint, and again before it is written to the ledger.

## The ledger

Double-entry, append-only. Nothing states a monetary fact except by posting a
balanced journal entry; a mistake is corrected by posting its inverse.

```
WITHDRAWAL_RESERVE   Dr PARK_RECEIVABLE      gross    Cr DRIVER_PAYABLE   gross
FEE_CAPTURE          Dr DRIVER_PAYABLE       fees     Cr *_FEE_REVENUE    fees
PAYOUT_SETTLEMENT    Dr DRIVER_PAYABLE       net      Cr PSP_SETTLEMENT   net
COMPENSATION         Dr DRIVER_PAYABLE       net      Cr PARK_RECEIVABLE  gross
                     Dr *_FEE_REVENUE        fees
```

Three independent things must agree before a posting exists: the application's
own check, a unique index on the entry's idempotency key, and a **deferred
constraint trigger** that re-sums the postings at commit time. `UPDATE` and
`DELETE` on `journal_entries`, `ledger_postings`, `withdrawal_events` and
`audit_logs` are rejected by a trigger.

## Concurrency

- One live withdrawal per driver, enforced by a partial unique index — the
  application checks it too, for a good error message, but two requests on two
  servers in the same millisecond would both pass that check.
- The create path runs `SERIALIZABLE` under a Postgres advisory lock on the
  driver, and retries only on serialisation failure.
- Every state change is a conditional `UPDATE ... WHERE version = ?`, so two
  workers racing on one withdrawal cannot overwrite each other's decision.
- Workers take a lease on a withdrawal; a lease from a dead process expires.

## Recovery

Nothing depends on a promise held in memory. The worker sweeps every actionable
row, retries with backoff, and escalates to a human at the SLA rather than
letting a withdrawal age quietly. A withdrawal holding a debit that has stopped
moving is the first tile on the admin dashboard.

## Reconciliation

Three scheduled runs, because there are three things that can disagree:

- `LEDGER` — the books against themselves: debits equal credits per currency, no
  driver is owed a negative amount, suspense is empty, and every finished
  withdrawal has the journal entries its state implies.
- `YANDEX` — every debit we believe we made against the park's transactions.
- `PROVIDER` — every transfer we believe settled against the bank's record,
  including the critical case of a withdrawal we reversed that the bank actually
  paid.

## Boundaries

`YandexFleetPort` and `PaymentProviderPort` are the only places that know an
external system exists. Which implementation is used is decided once, from
validated configuration, at module construction — never by an `if` inside a
service. `NODE_ENV=production` refuses to start with either in mock mode.
