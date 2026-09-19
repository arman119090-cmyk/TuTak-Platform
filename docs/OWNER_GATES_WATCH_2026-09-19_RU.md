# Owner gates watch — проверка №1, 19.09.2026 15:43 UTC

## Задание

«TUTAK — OWNER GATES WATCH + FINAL MERGE»: каждый раз перепроверять
фактическое состояние gates (не старый отчёт). Пока любой обязательный
gate открыт — не мержить PR #60, не менять код без нового воспроизводимого
дефекта. Когда все закрыты — merge по описанной последовательности с
замером T_merge/T_ci/T_railway, post-merge verify, production APK и iOS sim
с SHA мержа. Итоговый ответ только `READY FOR LIMITED DIRECT + LOYALTY
PILOT` или `NOT READY — <оставшиеся gates>`.

## База

PR #60 `claude/final-integration-20260919`, HEAD `d992d88`;
`main` `369eda1` = production (api/admin/partner, деплои 07:30 UTC).

## Что проверено сейчас (по факту, 15:43 UTC)

| # | Gate | Статус | Факт |
|---|---|---|---|
| 1 | Railway Wait for CI | **OPEN** | `get-service-config` 15:43: `checkSuites:false` у tutak-api, tutak-admin, tutak-partner; `staged:null` |
| 2 | GitHub default branch / protection | **OPEN** | `git remote show origin` и REST `default_branch` → `claude/tutak-loyalty-mvp-e485jm`; `main` без protection |
| 3 | Backup + restore в новую БД | **OPEN** | Postgres `describe-service`: один том `postgres-volume` 5000 MB sfo, деплой от 01.09; сведений о backup/PITR через доступный API нет; restore не выполнялся; `verify-restored-db.sh` не запускался |
| 4 | Human alerts | **OPEN** | переменные tutak-api (имена, 15:43): нет `ALERT_WEBHOOK_URL`, `ALERT_TELEGRAM_BOT_TOKEN`, `ALERT_TELEGRAM_CHAT_ID`, нет `SENTRY_DSN`; `alert:verify` подтверждать нечем |
| 5 | Viva | **OPEN / BLOCKED** | run 35452685549 (15:43:16 UTC): `https://217.76.49.94/health` → `{"status":"ok","tunnel":"down"}`; HTTP-логи API с 13:00 UTC: ни одного `request-otp`; deploy-логи по `otp`/`Viva` с 13:00 — пусто |
| 6 | Device review | **OPEN** | результатов Samsung / Xiaomi / keyboard / Spotlight / армянская навигация / fontScale 1.3 от владельца не поступало |

## PR #60 (на случай закрытия gates)

- HEAD `d992d8805ce84ccf6d46d0b9387554b93915a94c`, `mergeable_state: clean`,
  `merge-tree` с `main` без конфликтов, 45 коммитов, 362 файла.
- CI на `d992d88`: push run 35452100006 и PR run 35452097868 — 10/10 check
  runs success (Lint/test/build, Integration 1–3/3, Build the container images),
  завершены 15:36–15:37 UTC.
- Готов к мержу только после закрытия всех шести gates.

## Production

Без изменений: 5/5 сервисов online, 0 сбоев за 24 ч; API `f94d56eb`,
admin `8fea69ba`, partner `ab7fe4a4` — все с `main` `369eda1`. Денежные
флаги (`TUTAK_PSP_ENABLED`, `PSP_REFUNDS_ENABLED`,
`CUSTOMER_PREPAID_TOPUP_ENABLED`) в переменных отсутствуют → выключены.

## Что сделано

Только проверка и этот файл. Merge, APK, iOS — не запускались.

## Что НЕ сделано

- Merge PR #60 — gates открыты (все шесть).
- Ни один gate я закрыть не могу: Railway `update-service` создал бы
  staged-изменение с accept-deploy (запрещено менять production), ветки и
  protection — настройки репозитория владельца, backup/restore нужен
  `RAILWAY_API_TOKEN` или UI, alert-канал — секреты владельца, туннель —
  SSH на VPS, устройства — у владельца.
- Тестовый OTP не отправлялся: туннель down, отправка упадёт 503.

## Чем доказано

Вызовы Railway `get-service-config` ×3, `list-variables`,
`describe-service` (Postgres), `environment-status`; GitHub PR #60 `get` и
`get_check_runs`; workflow run 35452685549 (job 105922475268);
`git merge-tree` локально. Всё — 15:43 UTC.

## UNVERIFIED

- Состояние backup/PITR Postgres через Railway UI (API его не отдаёт).
- Доставка СМС на аппарат (нечего проверять без туннеля).
- Результаты device review.

## Вопросы владельцу

Нет новых. Список действий тот же, что в
`docs/OWNER_GATES_STATUS_2026-09-19_RU.md`, раздел F. Сообщите, когда
любой из пунктов выполнен — перепроверю по факту.

## FINAL

**NOT READY — Wait for CI (×3 services), default branch/protection,
backup + restore, human alerts, Viva tunnel (down), device review.**

---

# Проверка №2 — 16:46 UTC

Плановая перепроверка по факту (не по отчёту). База: PR #60 HEAD `0385c10`,
`main` `369eda1`, production без изменений.

| # | Gate | Статус | Факт 16:46 UTC |
|---|---|---|---|
| 1 | Railway Wait for CI | **CLOSED** | `get-service-config`: `checkSuites:true` у tutak-api, tutak-admin, tutak-partner; `get-staged-changes` → `staged:null` (включено владельцем в UI; через API поле недоступно — см. `OWNER_GATES_SELF_CLOSE_2026-09-19_RU.md`) |
| 2 | GitHub default branch / protection | **ЧАСТИЧНО** | default branch теперь **`main`** (`git remote show origin`). `list_branches`: `main.protected=false` — классической protection нет; наличие **ruleset** (PR required + required checks) connector не показывает → не доказано |
| 3 | Backup + restore | OPEN | Postgres без изменений: переменных `WAL_ARCHIVE_*` нет (PITR не включён), бэкапов тома нет (план Hobby, лимит 0); restore не выполнялся |
| 4 | Human alerts | OPEN | в переменных tutak-api по-прежнему нет `ALERT_WEBHOOK_URL` / `ALERT_TELEGRAM_*` |
| 5 | Viva | OPEN / BLOCKED | run 35456018313 (16:46:30 UTC): `/health` → `{"status":"ok","tunnel":"down"}`; HTTP-логов API с 16:00 — ни одного запроса, OTP не запрашивался |
| 6 | Device review | OPEN | результатов от владельца не поступало |

PR #60: HEAD `0385c109ef8285e77bf36f2204e3f16f326ad2d1`, `mergeable_state:
clean`, CI на этом HEAD 10/10 success (runs 35453892128, 35453890211,
завершены 16:10–16:20 UTC). Merge **не выполнялся**.

Что нужно, чтобы закрыть gate 2 до конца: GitHub → Settings → Rules →
Rulesets → branch ruleset на `main` с «Require a pull request» и «Require
status checks» (пять job'ов CI). Если ruleset уже создан — сообщите, я
проверю по поведению PR (`mergeable_state` станет `blocked` без чеков) и
зафиксирую как CLOSED.

Следующая плановая перепроверка: через час.

**NOT READY — ruleset на `main` (не доказан), backup + restore, alert
secret, Viva tunnel (down), device review.**
