# Yandex Fleet API — what is known, what is not, and what to ask for

## The single most important fact

**The Yandex Fleet API does not pay anybody.**

It exposes the park's own accounting: it can report a driver's balance and post
a transaction that changes it. Money reaching a driver's bank card is a separate
act, performed by a licensed bank or payment provider out of the park's (or Cash
Out's) money. Every commercial instant-payout service for Yandex parks works
this way: read the balance, post a negative transaction, send a real transfer.

Cash Out therefore splits the two explicitly:

- **A. Balance mutation** — `YandexFleetPort`, `apps/api/src/modules/yandex/`.
- **B. The actual transfer** — `PaymentProviderPort`,
  `apps/api/src/modules/payment-provider/`.

Anything that conflates them is wrong, and the state machine is built so that A
always precedes B (see the README).

## Provenance of what is encoded in the adapter

The official reference — `fleet.taxi.yandex.ru/docs/api/reference` and
`yandex.ru/dev/fleet-api` — **was not reachable while this was written**: the
environment's egress policy blocks the `yandex.ru` domain. Nothing here was
copied from the official documents.

What is encoded in `yandex-http.adapter.ts` is corroborated across two
independent open-source clients and the public search index of the official
reference pages, which agree with each other:

| Detail                                                                                            | Source                                                           | Confidence |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------- |
| Base URL `https://fleet-api.taxi.yandex.net`                                                      | both clients                                                     | high       |
| `X-Client-ID`, `X-API-Key` headers                                                                | both clients + indexed reference                                 | high       |
| `X-Idempotency-Token` header                                                                      | both clients                                                     | high       |
| `X-Park-ID` header on v2 endpoints                                                                | indexed reference                                                | medium     |
| `POST /v1/parks/driver-profiles/list`                                                             | both clients + indexed reference                                 | high       |
| `POST /v2/parks/driver-profiles/transactions` (create)                                            | both clients                                                     | high       |
| `POST /v2/parks/driver-profiles/transactions/list`                                                | both clients                                                     | high       |
| `accounts[].balance`, `.currency`, `.balance_limit` in the profile response                       | indexed reference                                                | medium     |
| Request body field names (`park_id`, `driver_profile_id`, `category_id`, `amount`, `description`) | one client                                                       | medium     |
| Response body field names                                                                         | inferred                                                         | **low**    |
| Error codes and their meanings                                                                    | unknown                                                          | **none**   |
| Rate limits                                                                                       | unknown (one client enforces ≥0.5 s per park, by its own choice) | **none**   |
| Whether `X-Idempotency-Token` deduplicates transaction creation                                   | unknown                                                          | **none**   |

The adapter is written defensively because of that last group: a 2xx whose body
it cannot parse is reported as `UNKNOWN`, not as success and not as failure, so
the orchestrator probes rather than guesses.

**The adapter must be replayed against a real sandbox park before
`YANDEX_MODE=live` is permitted anywhere.**

## What to confirm, in order

1. **Does `X-Idempotency-Token` actually deduplicate `POST
/v2/parks/driver-profiles/transactions`?** Everything rests on this. Post the
   same token twice and check whether one transaction or two appear.
   If it does not deduplicate, the reserve step must change: post first, then
   _always_ probe by description before retrying, and never retry blind.
2. **The exact create-transaction response**, so `yandexTransactionId` is stored
   from the right field.
3. **The transaction category to use.** Yandex requires an existing
   `category_id`; a park cannot invent one per call. Ask the park owner which
   category a payout debit must use (`YANDEX_PAYOUT_CATEGORY_ID`).
4. **The balance's precision and sign convention.** The adapter truncates
   towards zero when Yandex reports more decimal places than the currency has,
   which can only ever withhold a fraction, never overpay one.
5. **Rate limits**, per park and per client, and the response when exceeded.
6. **Whether transactions can be listed by our own idempotency token** rather
   than by searching descriptions. The current probe matches the reference
   string inside `description`, which works but is fragile.
7. **Error codes** for: insufficient balance, unknown contractor, blocked
   contractor, category not permitted.

## What the park owner must provide

| What                                                                              | Why                                                                   |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `X-Client-ID` and `X-API-Key` for the park                                        | every call                                                            |
| `park_id`                                                                         | every call                                                            |
| The API key's permission set                                                      | the key must be allowed to _create_ transactions, not only read       |
| The payout transaction category id                                                | the debit cannot be posted without one                                |
| A sandbox or test park                                                            | the adapter cannot be verified against production                     |
| Written confirmation that the park permits a third party to debit driver balances | this is the park's money and the park's relationship with its drivers |

## What Yandex itself must confirm

- That a third-party instant-payout service is permitted to use the Fleet API
  this way in the market Cash Out launches in. Yandex operates its own
  instant-payout product through Yandex Bank in Russia; whether an independent
  service is allowed, and under what terms, is a commercial question, not a
  technical one.
- Whether contractor profile ids are stable when a driver moves between parks.
  Cash Out stores `(parkId, contractorProfileId)` on every withdrawal precisely
  because it assumes they are not.
