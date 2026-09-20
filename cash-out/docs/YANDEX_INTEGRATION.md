# Yandex Fleet API — what is confirmed, what is not, and what to ask for

## The single most important fact

**The Yandex Fleet API does not pay anybody.**

It exposes the park's own accounting: it can report a driver's balance and post
a transaction that changes it. Money reaching a driver's bank card is a separate
act, performed by a licensed bank or payment provider out of the park's (or Cash
Out's) money. Cash Out therefore splits the two explicitly:

- **A. Balance mutation** — `YandexFleetPort`, `apps/api/src/modules/yandex/`.
- **B. The actual transfer** — `PaymentProviderPort`,
  `apps/api/src/modules/payment-provider/`.

The state machine is built so that A always precedes B (see `ARCHITECTURE.md`).

## How to read the classifications

| Label               | Meaning                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CONFIRMED**       | Stated by the official Fleet API documentation. The documentation was read by the owner's independent reviewer and relayed to this codebase; the author of the adapter could not fetch the pages (the environment's egress policy blocks `yandex.ru`, `yandex.com` and `fleet.taxi.yandex.ru`). "Confirmed" therefore means "confirmed against the official text", not "verified by a call". |
| **LIVE-UNVERIFIED** | Documented, implemented accordingly, but never exercised against a real park. Must be replayed on a sandbox park before `YANDEX_MODE=live`.                                                                                                                                                                                                                                                  |
| **UNKNOWN**         | The documentation available to us does not answer it. The adapter is written so that not knowing cannot cost money: any ambiguity resolves to `UNKNOWN`, never to "failed".                                                                                                                                                                                                                  |

## The contract as implemented

### `POST /v3/parks/driver-profiles/transactions` — create a transaction

| Element                                                                                   | Implementation                                                                                                                   | Classification                                                                                                                                     |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Endpoint path (v3; v2 `POST /v2/parks/driver-profiles/transactions` is deprecated)        | `yandex-http.adapter.ts`                                                                                                         | CONFIRMED                                                                                                                                          |
| Base URL `https://fleet-api.taxi.yandex.net`                                              | `YANDEX_BASE_URL`                                                                                                                | CONFIRMED                                                                                                                                          |
| Headers `X-Client-ID`, `X-API-Key`                                                        | sent on every call                                                                                                               | CONFIRMED                                                                                                                                          |
| Header `X-Idempotency-Token`, 16–64 printable ASCII characters                            | validated by `assertIdempotencyToken` before every POST; our tokens are 32 hex characters (debit) and 36 (credit, `-rev` suffix) | CONFIRMED                                                                                                                                          |
| Header `X-Park-ID`                                                                        | sent on every call                                                                                                               | LIVE-UNVERIFIED                                                                                                                                    |
| Body `park_id`                                                                            | withdrawal's `parkId`                                                                                                            | CONFIRMED                                                                                                                                          |
| Body `contractor_profile_id`                                                              | withdrawal's `yandexContractorProfileId`                                                                                         | CONFIRMED                                                                                                                                          |
| Body `amount` (decimal string)                                                            | gross, as `Money.toDecimalString()`                                                                                              | CONFIRMED                                                                                                                                          |
| Sign convention of `amount` — negative for a debit, or direction from `data.kind`         | implemented as **negative for the debit, positive for the credit**                                                               | LIVE-UNVERIFIED                                                                                                                                    |
| Body `description`                                                                        | `Cash Out <reference>` (the reference makes the transaction findable)                                                            | CONFIRMED                                                                                                                                          |
| Body `version`                                                                            | `YANDEX_TRANSACTION_VERSION`, default `"1"`                                                                                      | CONFIRMED that the field exists; **UNKNOWN which value the current schema prescribes**                                                             |
| Body `condition.balance_min`                                                              | set to the gross amount on every debit: Yandex refuses atomically if the balance is below what we take                           | CONFIRMED (field and semantics as relayed); atomicity LIVE-UNVERIFIED                                                                              |
| Body `data.kind = "payout"` on the debit                                                  | `YANDEX_PAYOUT_KIND`, default `"payout"`                                                                                         | CONFIRMED that the field and value exist; **whether "payout" is the correct kind for a third-party instant-payout debit is a question for Yandex** |
| `data.kind` on the compensating credit                                                    | `YANDEX_REVERSAL_KIND`, default `"payout"`                                                                                       | UNKNOWN                                                                                                                                            |
| `category_id`                                                                             | **not sent** — a v2 field, not carried into v3                                                                                   | CONFIRMED (absent from v3 contract)                                                                                                                |
| Response: the transaction id and its field name                                           | read from `id`, `transaction_id` or `transaction.id`; a 2xx with none of them → `UNKNOWN`                                        | UNKNOWN                                                                                                                                            |
| Response: a status on the POST itself (`in_progress` / `success` / `fail`)                | mapped to `PENDING` / `APPLIED` / `REJECTED`; a 2xx with an id and no status → `PENDING`                                         | LIVE-UNVERIFIED                                                                                                                                    |
| Response: `balance_after`                                                                 | stored when present, never relied on                                                                                             | UNKNOWN                                                                                                                                            |
| Idempotent replay of a used token returns the original transaction                        | relied on for recovery after a timeout; modelled in the mock; tested                                                             | CONFIRMED as relayed; LIVE-UNVERIFIED                                                                                                              |
| Whether a replay re-evaluates `condition`                                                 | assumed **not**; a rejection after a previous `UNKNOWN` attempt is escalated to a person rather than treated as "not applied"    | UNKNOWN — and handled so that either answer is safe                                                                                                |
| Error codes for a failed `condition`, insufficient balance, unknown or blocked contractor | classified by keywords into `condition_failed` / `insufficient_funds`, else passed through                                       | UNKNOWN                                                                                                                                            |
| HTTP 429, 408, 5xx, transport failure, timeout                                            | `UNKNOWN` → `RESERVE_UNCERTAIN` → evidence, then replay, then a person                                                           | CONFIRMED behaviourally (the codes' existence), LIVE-UNVERIFIED                                                                                    |
| HTTP 4xx other than the above                                                             | `REJECTED` on a first attempt only                                                                                               | LIVE-UNVERIFIED                                                                                                                                    |
| Rate limits                                                                               | conservative minimum interval per park (`YANDEX_MIN_INTERVAL_MS`, 500 ms)                                                        | UNKNOWN                                                                                                                                            |

### `GET /v3/parks/driver-profiles/transactions/status` — transaction status

| Element                                        | Implementation                                                          | Classification                           |
| ---------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------- |
| Endpoint path                                  | `getTransactionStatus`                                                  | CONFIRMED                                |
| Query parameter carrying the transaction id    | `?id=<transaction id>`                                                  | UNKNOWN (name)                           |
| Status values `in_progress`, `success`, `fail` | mapped to `IN_PROGRESS` / `SUCCESS` / `FAIL`; anything else → `UNKNOWN` | CONFIRMED                                |
| Response field carrying the status             | `status`                                                                | UNKNOWN (name)                           |
| 404 for an unknown id                          | `NOT_FOUND` — escalated, never treated as "not applied"                 | LIVE-UNVERIFIED                          |
| 429 / 5xx / transport failure                  | `UNKNOWN`, retried with backoff, escalated after five                   | CONFIRMED behaviourally, LIVE-UNVERIFIED |

### Reading a driver's profile and balance

| Element                                            | Implementation                                                     | Classification                                                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/parks/driver-profiles/list`              | `findProfilesByPhone`, `getProfile`, `getBalance`, `ping`          | LIVE-UNVERIFIED (corroborated by two open-source clients and the indexed reference; not in the reviewer's v3 summary) |
| `accounts[].balance`, `.currency`                  | parsed, truncated towards zero when more precise than the currency | LIVE-UNVERIFIED                                                                                                       |
| `POST /v2/parks/driver-profiles/transactions/list` | `findTransaction` — evidence only, a miss proves nothing           | LIVE-UNVERIFIED                                                                                                       |

## How the orchestrator uses this

```
RESERVING ──POST──▶ APPLIED  ──▶ RESERVED
                 ├▶ PENDING  ──▶ RESERVE_PENDING ──status──▶ success → RESERVED
                 │                                        ├─▶ fail    → FAILED (nothing applied)
                 │                                        ├─▶ 404     → MANUAL_REVIEW
                 │                                        └─▶ unknown → wait; five times → MANUAL_REVIEW
                 ├▶ REJECTED ──▶ first attempt: FAILED
                 │               after an UNKNOWN attempt: MANUAL_REVIEW
                 └▶ UNKNOWN  ──▶ RESERVE_UNCERTAIN ──▶ list probe (hit → RESERVE_PENDING)
                                                    └─▶ replay same token → RESERVING
                                                        five times → MANUAL_REVIEW
```

Nothing is `FAILED` unless one of two things is true: Yandex refused the very
first POST, or Yandex reports `fail` on an id it issued. Everything else that
is not `success` waits or goes to a person.

## What to confirm on the sandbox park, in order

1. **A replayed `X-Idempotency-Token` returns the original transaction** and
   does not create a second one. Post the same token twice; count transactions.
2. **A replay does not re-evaluate `condition.balance_min`.** Post a debit that
   leaves the balance below `balance_min`, then replay the token.
3. **The exact response body of the POST** — which field is the id, whether a
   status is included, whether `balance_after` exists.
4. **The status endpoint's query parameter name and response field name.**
5. **The value of `version`** the current schema requires.
6. **The correct `data.kind` for a third-party payout debit, and for its
   reversal.** Whether `"payout"` is right for both, and whether the sign of
   `amount` or the kind carries direction.
7. **The error codes** for: `condition` not met, insufficient balance, unknown
   contractor, blocked contractor, and the response to a rate-limit breach.
8. **Rate limits**, per park and per client.

## Per-park credentials and the roster

Every call is made with the credential of the park the driver is working in:
`ParkIntegrationCredential` holds one encrypted `X-API-Key` and `X-Client-ID`
per park, resolved by `YandexCredentialsService`; the process-wide
`YANDEX_CLIENT_ID` / `YANDEX_API_KEY` are only a fallback for a park without
one, and the admin panel flags that.

The roster (`DriverParkMembership`) is keyed by phone and carries the park's
contractor profile id. It is filled by an operator's paste or by
`POST /v1/admin/parks/:id/roster/sync`, which lists the park's driver profiles
through the Fleet API. **The sync is LIVE-UNVERIFIED**: the profile-listing
endpoint and its response fields are inferred like the rest of the adapter,
and against the mock it imports the mock's profiles.

## What the park owner must provide

| What                                                                              | Why                                                                   |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `X-Client-ID` and `X-API-Key` for the park                                        | every call                                                            |
| `park_id`                                                                         | every call                                                            |
| The API key's permission set                                                      | it must be allowed to _create_ transactions, not only read            |
| A sandbox or test park                                                            | the adapter cannot be verified against production                     |
| Written confirmation that the park permits a third party to debit driver balances | this is the park's money and the park's relationship with its drivers |

## What Yandex itself must confirm

- That a third-party instant-payout service is permitted to use the Fleet API
  this way in the market Cash Out launches in. Yandex operates its own
  instant-payout product; whether an independent service is allowed, and under
  what terms, is a commercial question.
- Whether contractor profile ids are stable when a driver moves between parks.
  Cash Out stores `(parkId, contractorProfileId)` on every withdrawal because it
  assumes they are not.
