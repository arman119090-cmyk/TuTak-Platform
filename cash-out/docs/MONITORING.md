# Monitoring

Two layers, deliberately redundant: the process evaluates its own alert
conditions every minute and shows them at `GET /v1/admin/alerts` (and logs
every transition, CRITICAL at error level); Prometheus scrapes the same
numbers from `GET /metrics` and pages through `ops/prometheus-alerts.yml`,
which does not depend on the process being alive (`CashOutMetricsStale`).

## Scraping

`GET /metrics` on the API, text format, bearer `METRICS_TOKEN`. Without the
token the endpoint is open locally and returns 404 in production. Every
series carries `deployment="<DEPLOYMENT_ENV>"`.

## Alerts

| Alert                         | Severity                      | Condition                                                                        | What it means / first action                                                          |
| ----------------------------- | ----------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `ledger_imbalance`            | **CRITICAL**                  | `cashout_ledger_imbalance_minor != 0` for any currency                           | Debits ≠ credits. Should be impossible (deferred trigger). Stop payouts; investigate. |
| `withdrawal_stuck`            | CRITICAL                      | non-terminal, driver debited, untouched for `WITHDRAWAL_SLA_SECONDS`             | Money left the park and has not arrived. Needs attention page.                        |
| `withdrawal_uncertain`        | WARNING                       | `RESERVE_UNCERTAIN` or `PAYOUT_UNCERTAIN` > 0                                    | Waiting for a probe; escalates to stuck past the SLA.                                 |
| `compensation_required`       | WARNING                       | `COMPENSATING` / `PAYOUT_FAILED` / `PAYOUT_RETURNED` > 0                         | The park debit must be reversed; watch it clear.                                      |
| `reconciliation_mismatch`     | WARNING                       | unresolved mismatches > 0                                                        | Reconciliation page.                                                                  |
| `yandex_unavailable`          | CRITICAL                      | live and DOWN or no OK for 5 min                                                 | No balances, no debits.                                                               |
| `idram_unavailable`           | CRITICAL                      | live and DOWN or stale                                                           | No payouts, no probes.                                                                |
| `sms_unavailable`             | CRITICAL                      | live and DOWN or stale                                                           | Nobody can sign in.                                                                   |
| `redis_unavailable`           | CRITICAL                      | `cashout_redis_up == 0`                                                          | OTP/PIN/admin sign-in refused (deny) or unlimited (allow).                            |
| `push_unavailable`            | WARNING                       | live and DOWN or stale                                                           | Notifications queue.                                                                  |
| `auto_payout_failed`          | WARNING                       | failures in the last hour or paused rules                                        | Automatic payouts page.                                                               |
| `otp_failure_rate_high`       | WARNING                       | ≥ 10 challenges in 15 min and ≥ 50 % exhausted/undelivered                       | SMS trouble or enumeration attempt.                                                   |
| `pin_failure_rate_high`       | WARNING                       | ≥ 20 wrong PINs in 15 min or ≥ 3 locked drivers                                  | Possible stolen phones or an attack.                                                  |
| `worker_lag`                  | WARNING ≥120s, CRITICAL ≥600s | oldest due, unleased withdrawal                                                  | The orchestrator is not keeping up or not running.                                    |
| `notification_backlog`        | WARNING                       | ≥ 100 queued or oldest ≥ 10 min                                                  | Sweeper or push provider trouble.                                                     |
| `MockIntegrationInProduction` | CRITICAL                      | a money/sign-in integration reports `mode="mock"` with `deployment="production"` | Should be impossible (env validation); if seen, the process was started wrongly.      |

Thresholds live in `apps/api/src/modules/observability/alert-rules.ts`
(`DEFAULT_THRESHOLDS`) and mirrored in the Prometheus file.

## Metrics exported

`cashout_ledger_imbalance_minor{currency}`, `cashout_withdrawals_stuck`,
`cashout_withdrawals_uncertain`, `cashout_withdrawals_compensation_required`,
`cashout_withdrawals_in_flight`, `cashout_reconciliation_mismatches_open`,
`cashout_integration_up{integration,mode}`,
`cashout_integration_last_ok_age_seconds{integration}`, `cashout_redis_up`,
`cashout_auto_payout_rules_paused`, `cashout_auto_payout_failures_1h`,
`cashout_otp_challenges_15m`, `cashout_otp_challenges_failed_15m`,
`cashout_pin_failures_15m`, `cashout_pin_locked_drivers`,
`cashout_worker_lag_seconds`, `cashout_notification_backlog`,
`cashout_notification_oldest_seconds`, `cashout_alert_active{alert,severity}`,
`cashout_metrics_evaluated_timestamp_seconds`, plus Node process metrics under
`cashout_process_*`.

## Not done

- No dashboard JSON (Grafana) is checked in.
- Request latency / error-rate histograms per route are not exported; the
  reverse proxy or APM is expected to provide them.
- Alerting on the mobile app (crash rate) needs a crash reporter on the
  device, which needs the device builds first.
