# Status

What actually works, what is a mock, and what cannot be built here at all.
Written to be read before anyone demos this to anybody.

**Nothing below has been verified against a live external system.** Yandex,
iDram, SMS and push all run against mocks in every test and in every local run.
"Works" in the first table means "works against the mock, and the mock behaves
like the documented or assumed contract".

## Works, and is tested

| Area                          | Notes                                                                                                                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Money arithmetic              | Integer minor units on `bigint`, explicit rounding, exact-rational fees. No float touches an amount.                                                                                     |
| Withdrawal state machine      | 19 states, legal transitions only, uncertainty as a first-class state; "never FAILED once debited" asserted.                                                                             |
| Double-entry ledger           | Append-only, balanced at commit by a deferred trigger; `UPDATE`/`DELETE` rejected; operator adjustments are balanced entries against SUSPENSE.                                           |
| Taxi parks and rosters        | Many parks, each with its own encrypted Fleet credential; phone-keyed rosters imported from a paste or synced from the Fleet API; eligibility per membership; park suspension.           |
| Park resolution and switching | On sign-in the phone is resolved against every roster: one park is auto-selected, several are offered, none or ineligible is refused. Switching invalidates the old park's balance.      |
| Balance                       | Read from the active park through the park's own credential; cached with a TTL, re-read fresh before every payout; stale-balance is a user-visible state, not a guess.                   |
| iDram destination             | Link, replace and unlink a wallet (verified with the rail, stored encrypted, shown masked); payouts go to it through the same pipeline. **Mock rail.**                                   |
| Payout authorization          | Six-digit PIN (scrypt, lockout with growing delay) or a biometric-released device secret; every payout consumes a single-use authorization bound to its quote, inside the transaction.   |
| Automatic payouts             | A rule per driver — on threshold, daily or weekly — consented with the PIN, evaluated by a worker, executed as an ordinary withdrawal with slot-keyed idempotency; pauses after 3 fails. |
| History                       | One read model over withdrawals and journal entries: withdrawals, refunds and adjustments with COMPLETED / PROCESSING / CANCELLED / REJECTED, filters, cursor paging, per-entry details. |
| Driver ID changes             | The driver asks, the Fleet API is consulted, an operator decides; approval swaps the roster row and invalidates the balance; refused while a payout is in flight.                        |
| Notifications                 | Outbox-backed, enqueued in the same transaction as the change, four preference categories applied at delivery, retried with backoff. **Mock push.**                                      |
| Quoting, limits, risk         | Fresh-balance quotes, HMAC-signed, single-use, two-minute TTL; amount, daily, weekly, monthly, velocity limits; explainable risk with a review threshold.                                |
| Idempotency and concurrency   | Client key bound to a request hash; serialisable transactions, advisory lock per driver, version guard per state change, partial unique indexes.                                         |
| Driver auth                   | OTP with three rate-limit dimensions, device binding, rotating refresh tokens with family revocation.                                                                                    |
| Admin                         | Password + mandatory TOTP, fail-closed RBAC; parks, rosters, credentials, Driver ID requests, auto-payout rules, driver detail with memberships and adjustments, integrations, audit.    |
| Reconciliation, webhooks      | Ledger, Yandex and provider runs; signature over the raw body, freshness window, deduplication.                                                                                          |
| Mobile app                    | Every screen in the ТЗ, hy/ru/en with compile-time completeness, light and dark themes persisted, the specified palette and radii, WCAG-AA contrast asserted in tests.                   |
| CI                            | `.github/workflows/cash-out-ci.yml`: clean PostgreSQL, every migration, typecheck, lint, format, all tests, admin build, Expo config. See the final report for the actual run result.    |

Test counts are in the final report (`docs/REPORT_MASTER_2026-09-20.md`) with
the commit they were measured on.

## Still a mock

| Component           | What exists                                                                            | What is missing                                                                                                                                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Yandex Fleet**    | A live v3 HTTP adapter (per-park credentials), a roster sync, and an in-memory mock.   | The live adapter has never spoken to a real park. Endpoint paths and headers are corroborated across open-source clients; response field names are inferred; error codes and rate limits are unknown. See `YANDEX_INTEGRATION.md`. |
| **iDram**           | A port, a mock with every answer a rail can give, account management, the mobile flow. | **No live adapter at all**; there is no API documentation or merchant contract to build one from. `PROVIDER_MODE=live` throws at startup. See `IDRAM_INTEGRATION.md`.                                                              |
| **SMS gateway**     | A console gateway that logs the code locally.                                          | No real provider. A production deployment without one is a deployment nobody can sign in to.                                                                                                                                       |
| **Push**            | A port, a mock that records what it would send, preferences, a push-token endpoint.    | No Expo/FCM/APNs adapter. `PUSH_MODE=live` throws; `PUSH_MODE=mock` is allowed in production with a startup warning, because preferences and the outbox are real even if nothing is delivered.                                     |
| **Biometrics**      | OS-prompt-gated device secret in the platform keystore, verified server-side by hash.  | Not a hardware-attested signature over a server challenge. See `SECURITY.md`.                                                                                                                                                      |
| **Legal documents** | Placeholder screens that say they are placeholders.                                    | Terms, privacy notice, data-retention policy — counsel's work.                                                                                                                                                                     |

Nothing in this list is presented in the UI as working. The integration tiles in
the admin panel read `MOCK`, not `OK`; the app's notification settings say push
is in test mode; the API logs a warning at startup.

## Cannot be built here

| Blocker               | Why                                                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| iDram merchant access | Credentials, API documentation, a sandbox and a contract. Moving money to a wallet is iDram's regulated activity; Cash Out is its client. |
| Yandex's permission   | Yandex runs its own instant-payout product. Whether an independent service may use the Fleet API this way is a commercial question.       |
| Park credentials      | Each park's `X-Client-ID` / `X-API-Key` belong to the park, and so does the decision to let a third party debit its drivers.              |
| An SMS provider       | A contract and credentials.                                                                                                               |
| A push provider       | Expo push / FCM / APNs credentials for the app's bundle ids.                                                                              |
| AML/KYC               | Who verifies identity, what is screened, what is reported — a compliance design, with a partner.                                          |
| Real-device testing   | Biometrics, secure storage, the keyboard and the tab bar in Armenian, dark mode on OLED — none of it can be exercised on a CI runner.     |

## Known gaps in what is built

- The Redis rate limiter and the key-rotation job are tested against a local
  Redis and PostgreSQL, not yet exercised on a production-sized table.
- The mobile and admin test suites cover pure logic (routing on the park
  resolution, language and theme resolution, the failure vocabulary, Armenian
  layout budgets, roster parsing, operator formatting). No component renders in
  a test; screens are typechecked and, for the admin, built.
- No load testing.
- The admin panel has no device binding for operators.
- The auto-payout worker and the notification sweeper run inside the API
  process on a cron; with more than one instance each rule is protected by the
  withdrawal pipeline's own idempotency, not by a distributed lock.
