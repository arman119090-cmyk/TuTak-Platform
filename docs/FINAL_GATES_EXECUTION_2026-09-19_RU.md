# FINAL GATES EXECUTION / PR #60 — состояние на 19.09.2026 17:10 UTC

## Задание

«TUTAK — FINAL GATES EXECUTION / PR #60»: перепроверить по факту gates,
которые владелец закрыл (GitHub ruleset, Railway Wait for CI); вести
оставшиеся (PITR/restore, human alerts, Viva, device); держать PR #60
mergeable и зелёным; не мержить, пока хоть один gate открыт; workflow
backup/uptime — если требуют только `ALERT_WEBHOOK_URL`, безопасно
исправить и протестировать. Финальный вердикт — один из двух.

## База

PR #60 `claude/final-integration-20260919`, HEAD на входе `bcfb34f`
(CI 10/10 success, runs 35456071300 / 35456068427), после этой задачи
`f134062`. `main` `369eda1` = production. Отчёт ниже написан до
завершения CI на `f134062` (см. UNVERIFIED).

## 1. GitHub — CLOSED (доказано)

Публичный REST без токена (репозиторий public):
`GET /repos/arman119090-cmyk/TuTak-Platform` → `default_branch: main`;
`GET …/rules/branches/main` → ruleset **23702809**:

| Правило | Факт |
|---|---|
| deletion | заблокировано |
| non_fast_forward (force push) | заблокировано |
| pull_request | required, `required_approving_review_count: 0`, merge/squash/rebase разрешены, `require_extra_approval_for_unattributed_changes: true` |
| required_status_checks | ровно 5: «Lint, test and build», «Integration tests (1/3)», «(2/3)», «(3/3)», «Build the container images»; у каждого `integration_id: 15368` (GitHub Actions), не Any source; `strict: false` |

Владельца повторять ничего не прошу.

## 2. Railway — CLOSED (доказано)

`get-service-config` 17:04 UTC: tutak-api, tutak-admin, tutak-partner —
`branch: main`, `checkSuites: true`, `staged: null`; `get-staged-changes`
→ `staged: null`, 0 ресурсов.

## A. Postgres PITR / restore — OPEN

Postgres `describe-service` 17:04 UTC: переменных `WAL_ARCHIVE_*` нет,
bucket `Postgres-PITR` в проекте нет (`list-services`: 5 сервисов, как
раньше), staged нет → PITR ещё не включён. Ничего не делал: жду
включения владельцем. После включения: проверю archive health, дождусь
первой точки, restore только в новый сервис, `verify-restored-db.sh`.

## B. Human alerts — OPEN; workflow-часть ИСПРАВЛЕНА

Переменных `ALERT_WEBHOOK_URL` / `ALERT_TELEGRAM_BOT_TOKEN` /
`ALERT_TELEGRAM_CHAT_ID` у tutak-api по-прежнему нет.

Проверка workflow: `uptime.yml` и `backup.yml` умели пейджить **только**
`ALERT_WEBHOOK_URL`; Telegram, настроенный для API, снаружи был бы
бесполезен. Исправлено в `f134062`:

- `scripts/page-human.sh` — один pager для workflow: webhook (payload как
  у `WebhookAlertChannel`) и/или Telegram (рендеринг как у
  `TelegramAlertChannel`, без parse_mode). Delivered = webhook 2xx или
  Telegram 2xx **и** `ok:true` (как в API). Exit 0 / 2 (никто не принял)
  / 3 (канал не задан). Токен и URL не попадают в вывод.
- `scripts/uptime-probe.sh` — пейджит через pager; читает
  `ALERT_TELEGRAM_*`; семантика exit-кодов прежняя.
- `.github/workflows/uptime.yml`, `backup.yml` — передают оба Telegram-
  секрета; шаг «Page a human» в backup идёт через pager.
- `.github/workflows/ci.yml` — новый шаг `page-human.test.sh`.

Доказательства локально: `page-human.test.sh` 13/13,
`uptime-probe.test.sh` 26/26 (6 новых Telegram-кейсов),
`railway-backup.test.sh` 29/29, YAML трёх workflow парсится, `bash -n`
чист. Ошибка по ходу: первый вариант нового recovery-кейса запускался,
пока fake API отдавал 503 — исправлен порядок в тесте, не в коде.

Что нужно от владельца: значения (Telegram bot token + chat id или
webhook URL) в Railway → tutak-api → Variables и в GitHub → Secrets
(`ALERT_TELEGRAM_BOT_TOKEN`, `ALERT_TELEGRAM_CHAT_ID` и/или
`ALERT_WEBHOOK_URL`). Затем `alert:verify` из ветки PR #60 и
подтверждение человеком.

## C. Viva — OPEN (BLOCKED)

run 35456918834, 17:04:14 UTC: `https://217.76.49.94/health` →
`{"status":"ok","tunnel":"down"}`. OTP не отправлялся.

## D. Device — OPEN

Результатов Samsung / Xiaomi не поступало.

## E. PR #60

`mergeable_state: clean`, 0 позади `main`, `merge-tree` чистый. HEAD
`f134062` — один содержательный коммит (workflow alerting), без случайных
изменений. Merge не выполнялся.

## Что НЕ сделано

- Merge, post-merge verify, production APK, iOS RC, pilot verification —
  gates A–D открыты.
- Restore/verify — нечего восстанавливать (PITR не включён).
- `alert:verify` — нет канала.
- OTP — туннель down.

## UNVERIFIED

- CI на `f134062` на момент написания ещё шёл (запущен ~17:09 UTC).
- Доступность PITR на плане Hobby.
- Реальная доставка Telegram/webhook из GitHub Actions (проверено только
  на fake-серверах; реальную проверку сделаю dispatch'ем `uptime.yml`
  после появления секретов и после мержа, когда workflow окажется на `main`).

## Вопросы владельцу

Нет новых: PITR, alert-канал, туннель, устройства — как в
`docs/OWNER_GATES_SELF_CLOSE_2026-09-19_RU.md`.

## ВЕРДИКТ

**NOT READY — PITR + restore, human alert secret + alert:verify, Viva
tunnel (down) + OTP, device review.**
