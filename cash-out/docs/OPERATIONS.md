# Operations

## Daily

1. Open the dashboard. The first tile is **stuck**: withdrawals that have
   debited a driver and stopped moving. It should be zero.
2. Open **Needs attention**. Everything there is a decision someone has to make.
3. Open **Reconciliation**. An empty list means our books, the park and the bank
   agree. A non-empty list is a queue, not a report.
4. Check **Integrations**. A tile reading `MOCK` in a production deployment is
   an incident: it means no real money is moving.

## A withdrawal is stuck

Open it. The page shows the state timeline, both external references and the
actual ledger entries.

- **`RESERVE_UNCERTAIN`** — we do not know whether Yandex applied the debit.
  Check the park's transaction list for the withdrawal's reference. If it is
  there, resolve as _retry payout_; if it is not, resolve as _mark failed_.
- **`PAYOUT_UNCERTAIN` / `PAYOUT_SUBMITTED` past its SLA** — check the provider's
  dashboard for our idempotency key. If it settled, resolve as _mark completed_
  with the provider's transaction id as evidence. If it did not, _compensate_.
- **`COMPENSATING` that will not clear** — Yandex is refusing the compensating
  credit. Do not mark it failed: the driver is out of pocket until that credit
  lands. Escalate to whoever owns the park relationship.

Never resolve a withdrawal from the state alone. Check the external system
first; the whole point of the evidence field is that somebody did.

## Reconciliation found something

- **`yandex_debit_missing`** — we believe we debited a driver and the park has no
  such transaction. Either our record is wrong (check the timeline for a
  compensation) or the park rolled something back. This is the finding that most
  often means money was paid out for free.
- **`reversed_but_provider_settled`** — **critical.** We told the driver the
  payout failed, returned the money to their balance, and the bank paid them
  anyway. The driver has been paid twice. Stop and escalate.
- **`trial_balance_not_zero`** — the ledger does not balance. This should be
  impossible: the database rejects an unbalanced entry at commit. If it happens,
  something has written to the tables outside the application.
- **`missing_journal_entries`** — a finished withdrawal without the entries its
  state implies, which is what a crash between a posting and a state change
  looks like.

## Taxi parks and rosters

A driver can withdraw only if their phone is in a park's roster, the row is
`ACTIVE` and `ELIGIBLE`, and the park is not suspended. Everything on the
**Taxi parks** page is about keeping that true.

- **Adding a park**: name, code, the Yandex park id, currency. Then store its
  Fleet API credential and press _Verify_ — a park whose key has never answered
  is a park whose drivers will see "balance unavailable".
- **Roster**: paste `phone, profile id, first, last` lines and import, or sync
  from the Fleet API. Imports update by phone and never remove anyone; to close
  access, set the membership to `INELIGIBLE` or `REMOVED` with a reason. The
  driver is told their access changed.
- **Suspending a park** stops every withdrawal for its drivers at once, with a
  reason they can read. Use it when the park's key is revoked or the park asks.

## Driver ID requests

A driver who says "my Yandex profile is a different one" files a request. The
API asks the Fleet API whether that profile exists in the park and belongs to
that phone; the verdict sits next to _Approve_ and _Reject_. Approving swaps
the profile on the roster row and throws away the cached balance. It is refused
while a payout is in flight — decide it again once the payout has settled.

## Automatic payouts

The **Automatic payouts** page lists every rule: driver, park, cadence,
threshold, destination, next check, and why it paused. A rule pauses itself
after three consecutive failures, or when its destination or park stops being
usable, and says so to the driver. Operators do not edit rules — the rule is
the driver's consent — but blocking the driver stops it, audited.

## Notifications

Notifications are outbox rows delivered by a sweeper every ten seconds. A row
that fails delivery five times is marked processed with its last error. With
`PUSH_MODE=mock` nothing is delivered and the integrations tile says `MOCK`;
that is the state of every deployment until a push provider is contracted.

## Changing fees or limits

Publishing a new schedule closes the one in force and opens a new one. Quotes
already issued keep the price they were quoted, and withdrawals already created
keep the price stored on them. Nothing retroactively reprices.

Every change demands a written reason and lands in the audit log.

## Deploying

1. `pnpm prisma migrate deploy` — the invariant migration creates triggers and
   partial unique indexes that Prisma's schema cannot express. When changing the
   schema, use `prisma migrate dev --create-only`, read the generated SQL, and
   make sure it does not drop them.
2. The application database role must **not** have `TRUNCATE` rights: truncation
   bypasses the append-only row triggers.
3. `NODE_ENV=production` refuses to start with a mock integration, a wildcard or
   localhost CORS origin, `DEPLOYMENT_ENV=local`, or missing credentials for a
   live integration. That is the intended behaviour; do not work around it.
4. More than one API instance requires a shared rate limiter (see
   `docs/SECURITY.md`).

## Key rotation

`ENCRYPTION_KEY_ID` is written beside every ciphertext. To rotate: deploy with
the new key and a new id, then re-encrypt existing rows. **The re-encryption job
is not written yet** — until it is, rotating the encryption key makes existing
provider tokens and TOTP secrets unreadable.

`QUOTE_SIGNING_KEY` can be rotated freely: quotes live for two minutes.

`FINGERPRINT_KEY` cannot be rotated without recomputing every fingerprint, which
would break cross-driver instrument matching until it completes.
