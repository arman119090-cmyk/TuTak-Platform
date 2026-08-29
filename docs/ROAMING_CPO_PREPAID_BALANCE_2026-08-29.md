# Customer prepaid balance — the roaming-CPO collection mechanism

`docs/ROAMING_CPO_FINANCIAL_ACCOUNTING_2026-08-29.md` shipped the accounting
side of an app-initiated `ROAMING_CPO` charge — frozen rates, the margin
split, a balanced ledger — but left the actual *collection* of what the
customer owes as explicitly unbuilt work: `EV_ROAMING_RECEIVABLE` only ever
grew, with nothing draining it. This pass builds that collection mechanism.

There is no real bank/PSP connected today. What ships here is the mechanism
in full — schema, ledger accounting, the top-up flow, the automatic spend at
settlement — behind an adapter seam that already exists in this codebase for
exactly this situation (`OcpiAdapter`/`PspAdapter`). Connecting a real bank
(Idram or otherwise), once its credentials exist, is writing one class and
pointing `CustomerBalanceModule` at it — not building anything new.

## Why a prepaid balance, not a card hold at settlement

An app-initiated roaming session's final cost is not known until the CPO's
own CDR arrives — minutes to hours after the plug comes out
(`EvCdrReconciliationService.completeAppInitiatedSession`). Holding a card
authorization open for that long is unreliable (most authorizations expire
well before then) and this codebase's own `PaymentEngineService` is a
capture-only, per-transaction PSP client with no such hold primitive, gated
off by default in production (`CARD_PAYMENTS_ENABLED`) because the canonical
purchase model never has TuTak capture a card directly.

A prepaid balance sidesteps both problems: the customer funds it whenever is
convenient (before, during, or well after a session), and collection at
settlement is a same-database ledger move against money TuTak is already
holding — no network call, no expired authorization, no dependency on a PSP
being reachable at the moment a CDR happens to arrive.

## What shipped

### Schema (`20260831000000_customer_prepaid_balance`)

- `LedgerAccountType.CUSTOMER_PREPAID_BALANCE` — a customer-scoped (`userId`
  set, `partnerId` null) account, the first in this ledger that is
  fundamentally about one person's own money rather than a partner's or the
  platform's.
- `BalanceTopUp` — one row per top-up attempt, shaped like `Payment`
  deliberately: the same claim-then-confirm lifecycle, the same
  `idempotencyKey`-on-the-row belt-and-suspenders reasoning, a
  `providerReference` unique index that is what makes a replayed bank
  webhook a no-op instead of a second credit.

### The sign convention (worth stating explicitly)

This ledger's `balance` column is DEBIT-positive / CREDIT-negative on every
account, uniformly — not the textbook "assets debit-positive, liabilities
credit-positive" rule (see `PARTNER_PAYABLE`'s own docblock and
`payment-engine.int-spec.ts`'s comment for the existing precedent).
`CUSTOMER_PREPAID_BALANCE` is credited to fund it — the same shape
`PARTNER_PAYABLE` uses when the platform owes money out — so its raw balance
is zero-or-negative by construction. `CustomerBalanceService.getBalance` and
`.collectFromBalance` negate it at the boundary, because this is the one
account in the whole ledger whose number is also meant to read as "how much
money do I have" to something outside the ledger (a customer, or a `gte`
comparison) rather than "how much does the platform owe."

### `BankTopUpAdapter` (`src/modules/customer-balance/`)

Modelled directly on `OcpiAdapter`: `initiateTopUp` starts a top-up with the
bank, `verifyTopUpWebhook` verifies and interprets an inbound confirmation.
`NoopBankTopUpAdapter` is what actually runs today — it honestly declines
every top-up (`top_up_not_configured`) and verifies no webhook, the same
"fail loudly, never fabricate success" posture `NoopOcpiAdapter` already
established for a roaming station with no real CPO behind it.

**To connect a real bank**: implement `BankTopUpAdapter`, add whatever
config it needs to `AppConfig` (same shape as `ocpi`/`sms`), and change
`CustomerBalanceModule`'s `useClass` to point at it. One note for whoever
does this: `verifyTopUpWebhook` receives a parsed JSON body, not raw bytes —
this app has no raw-body capture wired anywhere, and most banks sign over
the exact raw bytes. Wiring that up is part of writing the real adapter, not
something this interface tried to guess at in advance.

### `CustomerBalanceService`

- `initiateTopUp` / `confirmTopUpWebhook`: funds the balance via DEBIT
  `PSP_RECEIVABLE` / CREDIT `CUSTOMER_PREPAID_BALANCE` — the exact posting
  shape `PaymentEngineService.capture` already uses for a partner payment,
  reusing the existing acquirer-settlement pipeline
  (`docs/FINANCIAL_CORE_DESIGN.md`, PSP_RECEIVABLE → PLATFORM_BANK) rather
  than inventing a second one. A top-up is not a new kind of money coming
  in, it just credits the customer's own account instead of a partner's.
- `collectFromBalance(userId, cost, currency, sourceTransactionId)`: called
  from `EvCdrReconciliationService.completeAppInitiatedSession` right after
  the settlement's own atomic transaction commits. All-or-nothing by
  design — it collects the full `cost` if the balance covers it, or nothing
  at all otherwise. A partial-collection semantic (take what's there, leave
  the rest on the receivable) has no product requirement behind it and would
  trade a one-statement-safe guard for a materially more complex one; a
  customer with insufficient balance is entirely unaffected by this method
  existing. Race-safe via a conditional `updateMany` guard (the same idiom
  `RefundEngineService` uses to cap a refund at what was actually captured),
  not a separate `SELECT ... FOR UPDATE` — see `LedgerService
  .applyNetDeltas`'s own docblock for why the latter is deliberately avoided
  elsewhere in this ledger.

Deliberately outside the settlement's own atomic transaction: the session is
already correctly settled (billed, margin split, ledger posted) the moment
that transaction commits, regardless of whether collection succeeds.
Collecting from the balance is a separate financial event layered on top,
never a precondition of completing the session.

### Endpoints (`/balance`)

`GET /balance/me` (any authenticated customer), `POST /balance/topup`
(initiates, idempotency-key optional like every other money-moving
endpoint), `POST /balance/topup/webhook` (`@Public()`, provider-facing —
verification is entirely the configured adapter's job, so with the No-op
adapter this route does nothing at all).

## Tests

`test/customer-balance.int-spec.ts`: the No-op adapter's honest refusal,
initiating and confirming a top-up with a balanced ledger posting,
idempotent replay on a repeated key, double-webhook-delivery race safety,
a declined confirmation touching nothing, an unverifiable callback refused,
an unknown reference ignored. `test/ev-roaming-financial-accounting
.int-spec.ts` covers the collection side next to the settlement flow that
calls it: full collection when the balance covers the cost (receivable paid
to zero), no collection at all when it cannot (receivable stands, balance
untouched), and idempotency against a repeated call for the same
transaction.

## What is still not built

A real bank/PSP adapter. Nothing here fabricates a successful top-up, and no
station has `customerChargingEnabled` by default (see the 2026-08-27
security doc), so this entire path is inert in a canonical deployment until
someone deliberately turns both things on — same "honestly incomplete, not
hidden" posture as everything else this document describes.
