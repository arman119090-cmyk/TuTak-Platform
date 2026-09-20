# Live integration readiness

Nothing in this document is a claim that an integration works. It is the
contract each live adapter must satisfy, what must be obtained before it can
be written or switched on, and how to tell afterwards whether it is behaving.
Mocks stay isolated: each is a separate class, wired only under `*_MODE=mock`,
and production refuses every mock that guards money or sign-in (`YANDEX_MODE`,
`PROVIDER_MODE`, `SMS_MODE`). `PUSH_MODE=mock` is tolerated in production and
shown as MOCK on the Integrations page.

| Integration | Mode variable   | Live adapter                                  | Status                                                                      |
| ----------- | --------------- | --------------------------------------------- | --------------------------------------------------------------------------- |
| Yandex      | `YANDEX_MODE`   | `YandexHttpAdapter` (v3, per-park credential) | written from corroborated docs, **never run against a real park**           |
| iDram       | `PROVIDER_MODE` | `IdramLiveAdapter` — a slot                   | **no contract**; refuses to serve, naming each unknown                      |
| SMS         | `SMS_MODE`      | `SmsHttpGatewayBase` — provider adapter to do | **no provider**; base class carries timeout, retries, normalisation, health |
| Push        | `PUSH_MODE`     | `ExpoPushAdapter`                             | written to Expo's published API, **never exercised against a device**       |

---

## Yandex Fleet API

**A. Credentials.** Per park: `X-Client-ID`, `X-API-Key`, `park_id`, stored
through the admin panel (encrypted, never returned). The process-wide
`YANDEX_CLIENT_ID` / `YANDEX_API_KEY` / `YANDEX_PARK_ID` are a fallback for a
park without its own credential and must not be relied on with two parks. A
sandbox park is required before the first live call.

**B. Endpoints to verify.** `POST /v3/parks/driver-profiles/transactions`
(debit and compensating credit), `GET
/v3/parks/driver-profiles/transactions/status`, the driver-profile listing used
by roster sync, and the balance read. Field names on the responses are
inferred; see `YANDEX_INTEGRATION.md` for what is confirmed and what is not.

**C. Sandbox / live.** `YANDEX_BASE_URL` selects the host; there is no separate
sandbox flag because Yandex distinguishes by park. The verification checklist
below is run against the sandbox park first, then repeated against the
production park with a 1 AMD transaction.

**D. Idempotency.** Every POST carries `X-Idempotency-Token` (32 hex for the
debit, `-rev` suffix for the credit), stable across retries of the same
withdrawal. Whether Yandex deduplicates on it is **unverified** and is item 1
of the checklist.

**E. Timeouts.** `YANDEX_TIMEOUT_MS` (default 10 s) per call via
`AbortController`. A timeout after a POST is not a failure: the withdrawal
goes to `RESERVE_UNCERTAIN` and is probed.

**F. Retries.** Reads retry with backoff; POSTs are never blindly retried —
the same idempotency token is replayed by the orchestrator's next attempt, and
the status endpoint is consulted first.

**G. Unknown state.** `RESERVE_UNCERTAIN` → probe by token → `RESERVED` or
`FAILED`; never assumed. Uncertain longer than `WITHDRAWAL_SLA_SECONDS` →
manual review.

**H. Webhooks.** None; the Fleet API is pull-only.

**I. Reconciliation.** Daily and on demand: every withdrawal's Yandex
transaction id is checked against the park's transaction list; mismatches are
a queue on the Reconciliation page.

**J. Monitoring.** `yandex-fleet` health tile (ping per minute through the
first active park's credential), `cashout_integration_up{integration="yandex-fleet"}`,
alerts `yandex_unavailable`, `withdrawals_uncertain`, `reconciliation_mismatch`.

**Live verification checklist** — run in order on the sandbox park, record
each answer in `YANDEX_INTEGRATION.md`:

1. Authentication: a `GET` with the park's key returns 200; with a wrong key
   returns 401/403 and the adapter reports `YANDEX_UNAVAILABLE`, not a crash.
2. Park credential: the admin **Verify** button turns the tile green for this
   park and only this park.
3. Driver roster: **Sync** imports the sandbox park's profiles; phones match
   the format the app normalises (`+374…`).
4. Driver lookup: a known phone resolves to exactly one profile; an unknown
   phone resolves to none, not to an error.
5. Driver status: a blocked/fired profile is reported and the membership
   becomes INELIGIBLE on the next sync.
6. Balance: the value shown equals the Fleet dashboard for the same profile;
   confirm sign and units (minor units, currency).
7. Transaction create: a 1 AMD debit appears in the park's transaction list
   with our reference in the description; confirm the response field that
   carries the transaction id.
8. Transaction status: the status endpoint returns that transaction by our
   token; confirm the query parameter and the status vocabulary.
9. Idempotency: post the same token twice; count transactions (must be 1).
10. Insufficient balance: a debit larger than the balance is refused with an
    identifiable error and no transaction; confirm `condition.balance_min`
    is honoured on replay too.
11. Timeout after submit: force a timeout (firewall the response) and confirm
    the withdrawal lands in `RESERVE_UNCERTAIN`, is probed and settles.
12. Duplicate request: two concurrent confirmations of one quote produce one
    withdrawal (the database guard) and one Yandex transaction.
13. Rate limit: measure the per-park limit; set `YANDEX_MIN_INTERVAL_MS`
    accordingly.
14. Reconciliation: run it; zero mismatches for the day's sandbox
    transactions.

---

## iDram

**A. Credentials.** Merchant id, API key (or certificate — unknown), base URL,
webhook secret: `IDRAM_MERCHANT_ID`, `IDRAM_API_KEY`, `IDRAM_BASE_URL`,
`PROVIDER_WEBHOOK_SECRET`. A merchant agreement and a sandbox are prerequisites.

**B. Endpoints to verify.** Unknown. The adapter needs, at minimum: wallet
verification (does this wallet exist, may it receive, whose is it), payout
creation, payout status by our idempotency key or by iDram's id, and, if iDram
pushes events, the webhook envelope. Whether iDram offers reversal is unknown.

**C. Sandbox / live.** By `IDRAM_BASE_URL`. `PROVIDER_MODE=live` builds
`IdramLiveAdapter`, which refuses to serve until every entry in
`IdramLiveAdapter.missing()` is implemented.

**D. Idempotency.** The orchestrator sends its own key (`PayoutInstruction.idempotencyKey`)
on every attempt. Whether iDram honours a client key is unknown; if it does
not, `probe` by our reference must find the payout before any retry.

**E. Timeouts.** `PROVIDER_TIMEOUT_MS` (default 15 s). A timeout after submit
→ `PAYOUT_UNCERTAIN`.

**F. Retries.** Never a blind resubmit. `PAYOUT_UNCERTAIN` → probe → settle
or compensate.

**G. Unknown state.** `PAYOUT_UNCERTAIN` and `PAYOUT_SUBMITTED` past the SLA →
manual review with the provider's id as evidence; compensation only after
iDram confirms the payout did not happen.

**H. Webhooks.** `POST /v1/webhooks/payment-provider` verifies an HMAC over the
raw body plus a freshness window and deduplicates on the provider's event id.
The actual iDram scheme (header names, algorithm, timestamp format) must be
mapped in `parseWebhook`.

**I. Reconciliation.** Provider run: every SUBMITTED/CONFIRMED withdrawal's
provider id against iDram's statement; needs a statement/report endpoint or a
file export — unknown.

**J. Monitoring.** `idram` tile (ping), `cashout_integration_up{integration="idram"}`,
alerts `idram_unavailable`, `withdrawals_uncertain`, `compensation_required`.

**What iDram must provide** (the unknowns, verbatim from the adapter):
merchant API documentation; authentication scheme; wallet/account verification
endpoint; payout endpoint and its idempotency semantics; transaction status
endpoint; webhook envelope and signature scheme; reversal/return semantics;
sandbox; per-payout and per-wallet limits; fee schedule (the fee engine has a
provider component waiting for it).

---

## SMS

**A. Credentials.** `SMS_PROVIDER` (name), `SMS_BASE_URL`, `SMS_API_KEY`,
`SMS_SENDER` (registered sender id for Armenia). A contract with an operator
or aggregator that can deliver to all three Armenian networks.

**B. Endpoints.** Send (one call per OTP), optionally delivery status, and a
balance/health call for `ping`.

**C. Sandbox / live.** Most providers offer a test key that returns accepted
without sending; treat it as a sandbox behind `SMS_BASE_URL`.

**D. Idempotency.** The challenge id is passed as `reference`; a provider that
supports a client reference must receive it so a retry cannot double-bill.

**E. Timeouts.** `SMS_TIMEOUT_MS` (default 8 s) per attempt.

**F. Retries.** `SMS_MAX_RETRIES` (default 2) on retryable errors only
(timeout, 5xx, 429), exponential backoff; never on INVALID_NUMBER,
NUMBER_BLOCKED, AUTH_FAILED, REJECTED. The OTP cooldown (`OTP_RESEND_COOLDOWN_SECONDS`)
bounds how often one phone can trigger a send.

**G. Unknown state.** A send that times out may still deliver. The challenge
is marked `deliveryFailed` only when the provider refused; on a timeout the
result is not accepted but the code stays valid, so a late SMS still works.

**H. Webhooks.** Delivery reports are optional and not consumed; the OTP flow
does not depend on them.

**I. Reconciliation.** Monthly: provider invoice vs `otp_challenges` count.

**J. Monitoring.** `sms` tile, `cashout_integration_up{integration="sms"}`,
alerts `sms_unavailable`, `otp_failure_rate_high`.

**To implement a provider:** `class AcmeSmsGateway extends SmsHttpGatewayBase`
with `request()` mapping the HTTP call (use `smsErrorFromStatus`) and
`ping()`; register it in `auth.module.ts` for its `SMS_PROVIDER` value.

---

## Push

**A. Credentials.** For Expo: an EAS project (project id in `app.json`) and,
optionally, `EXPO_ACCESS_TOKEN`; Expo holds the FCM server key and the APNs
key. For direct FCM/APNs instead: a Firebase service account and an APNs
`.p8` — a different adapter behind the same `NotificationPort`.

**B. Endpoints.** `POST https://exp.host/--/api/v2/push/send` (tickets), and
the receipts endpoint for late failures (not yet consumed).

**C. Sandbox / live.** `PUSH_MODE=live PUSH_PROVIDER=expo`. There is no
sandbox; a development build on a physical device is the test.

**D. Idempotency.** Each outbox row is delivered once; a retry sends the same
message again (acceptable for notifications).

**E. Timeouts.** `PUSH_TIMEOUT_MS` (default 8 s).

**F. Retries.** The outbox sweeper retries with backoff up to 5 attempts;
`DeviceNotRegistered` is final and clears the token.

**G. Unknown state.** A ticket without a receipt is treated as delivered; the
receipts endpoint would refine this.

**H. Webhooks.** None.

**I. Reconciliation.** Not applicable.

**J. Monitoring.** `push` tile, `cashout_integration_up{integration="expo-push"}`,
alert `notification_backlog`.

**Mobile side still to do** (needs the EAS project id): `expo-notifications`,
request permission, obtain `ExponentPushToken[...]`, `POST
/v1/notifications/push-token`.
