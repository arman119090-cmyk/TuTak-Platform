# Status

What actually works, what is a mock, and what cannot be built here at all.
Written to be read before anyone demos this to anybody.

## Works, and is tested

| Area                     | Notes                                                                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Money arithmetic         | Integer minor units on `bigint`, explicit rounding, exact-rational fees. No float touches an amount. 59 tests.                                                 |
| Withdrawal state machine | 18 states, legal transitions only, uncertainty as a first-class state. Invariants asserted, including "never reaches FAILED once the driver has been debited". |
| Double-entry ledger      | Append-only, balanced at commit by a deferred database trigger, `UPDATE`/`DELETE` rejected by triggers.                                                        |
| Quoting                  | Priced from a fresh balance, HMAC-signed, single-use, two-minute TTL, re-validated at confirmation.                                                            |
| Withdrawal orchestration | Reserve → pay out → settle, with probes for uncertain outcomes, compensation on failure, leases, backoff and SLA escalation.                                   |
| Idempotency              | Client key bound to a request hash; stable Yandex and provider keys reused by every retry.                                                                     |
| Concurrency              | Serialisable transactions, advisory lock per driver, optimistic version guard per state change, partial unique indexes.                                        |
| Limits and risk          | Amount, daily, weekly, monthly, velocity; explainable risk signals with a manual-review threshold.                                                             |
| Driver auth              | OTP with three rate-limit dimensions, device binding, rotating refresh tokens with family revocation.                                                          |
| Driver↔Yandex linking    | Phone plus licence digits, one account per contractor profile, ambiguity escalated rather than guessed.                                                        |
| Admin                    | Password + mandatory TOTP, fail-closed RBAC, manual-review resolution with mandatory reasons and evidence.                                                     |
| Reconciliation           | Ledger, Yandex and provider runs; mismatches surfaced as a queue.                                                                                              |
| Webhooks                 | Signature over the raw body, freshness window, deduplication, state-aware application.                                                                         |
| Mobile app               | All the screens in the brief, hy/ru/en, light theme, WCAG-AA contrast asserted in tests.                                                                       |
| Admin panel              | Dashboard, withdrawals, attention queue, drivers, reconciliation, fees, limits, integrations, audit.                                                           |

**246 tests pass**: 137 in the shared packages (money 59, contracts 46,
design tokens 16, i18n 16) and 109 in the API, of which 80 are integration tests
against a real PostgreSQL and 29 are unit tests of the cryptography and TOTP.

Three real bugs came out of writing those tests: ledger sums arrived from
Postgres as strings and went through an IEEE double; the OTP cooldown compared
an injected clock against a database timestamp and could silently stop working;
and the rate limiter read wall-clock time while everything else read the clock.

## Still a mock

| Component            | What exists                                                                             | What is missing                                                                                                                                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Yandex Fleet**     | A live HTTP adapter and an in-memory mock.                                              | The live adapter has never spoken to a real park. Endpoint paths and headers are corroborated across two open-source clients; response field names are inferred; error codes and rate limits are unknown. See `YANDEX_INTEGRATION.md`. |
| **Payment provider** | A port, a mock, and webhook verification using the same scheme a live adapter must use. | **No live adapter at all.** None can be written without choosing a bank or PSP. `PROVIDER_MODE=live` throws at startup rather than pretending.                                                                                         |
| **SMS gateway**      | A console gateway that logs the code locally.                                           | No real provider. A production deployment without one is a deployment nobody can sign in to.                                                                                                                                           |
| **Card entry**       | The screen and the token flow.                                                          | The provider's SDK sheet, which is where card data is actually collected. The app says so plainly instead of showing a card form.                                                                                                      |
| **Notifications**    | Nothing.                                                                                | Push notification on payout completion; the app polls instead.                                                                                                                                                                         |
| **Legal documents**  | Placeholder screens that say they are placeholders.                                     | Terms, privacy notice, data-retention policy — counsel's work, not a developer's.                                                                                                                                                      |

Nothing in this list is presented in the UI as working. The integration tiles in
the admin panel read `MOCK`, not `OK`, and the API logs a warning at startup.

## Cannot be built here

| Blocker                                | Why                                                                                                                                                        |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A licensed payment partner             | Moving money to a stranger's card is a regulated activity. This needs a contract, and in most jurisdictions a licence or a licensed partner who holds one. |
| Yandex's permission                    | Yandex runs its own instant-payout product. Whether an independent service may use the Fleet API this way, in this market, is a commercial question.       |
| Park credentials                       | The API key belongs to the park, not to us. So does the decision to let a third party debit its drivers.                                                   |
| AML/KYC                                | Who verifies the driver's identity, what is screened, what is reported and to whom — a compliance design, with a partner.                                  |
| The payout currency's real constraints | Whether the chosen rail can move fractional drams at all is a question for the provider; the fee engine already handles a coarser increment.               |

## Known gaps in what is built

- The rate limiter is in-memory and correct for **one** API instance. The
  interface is there for a Redis implementation; the implementation is not.
- Key rotation is supported by the ciphertext format but there is no
  re-encryption job, so rotating `ENCRYPTION_KEY` today would orphan existing
  provider tokens and TOTP secrets.
- No push notifications, so the app polls a withdrawal until it settles.
- The Yandex probe matches a reference string inside a transaction description.
  It works, and it is fragile; a proper lookup by idempotency token would be
  better if the API supports one.
- No load testing. The design is straightforwardly horizontal apart from the
  rate limiter, but that is an argument, not a measurement.
- The admin panel has no device binding for operators, unlike the driver app.
- **There are no unit tests in the mobile app or the admin panel.** Both are
  typechecked and the admin panel builds in CI, and the logic worth testing —
  money, fees, the state machine, the contrast guarantees — lives in the shared
  packages and is tested there. Component tests for the withdrawal flow are
  still owed.
