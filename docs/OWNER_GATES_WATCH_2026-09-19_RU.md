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

---

# Проверка №3 — 17:43–17:59 UTC (по факту, во время верификации restore)

| # | Gate | Статус | Факт |
|---|---|---|---|
| 1 | Railway Wait for CI | CLOSED | `checkSuites:true` ×3, staged только удаление временного верификатора (см. ниже) |
| 2 | GitHub default branch + ruleset | **CLOSED** | default `main`; ruleset 23702809: PR required (0 approvals), force-push и deletion заблокированы, 5 required checks от GitHub Actions (`integration_id 15368`). Доказано публичным REST `rules/branches/main` в 17:04 |
| 3 | Backup + restore | **CLOSED** | PITR включён владельцем 17:32 (`WAL_ARCHIVE_*`, full backup 17:33:13, archived=12, failed=0); restore в новый сервис `Postgres-restored-20260919-1733`; проверка **RESTORE PASS** 17:43 — `docs/RESTORE_VERIFY_2026-09-19_RU.md` |
| 4 | Human alerts | OPEN | у tutak-api нет `ALERT_*` (17:59) |
| 5 | Viva | OPEN / BLOCKED | run 35459764461, 17:59:45: `tunnel: down` |
| 6 | Device review | OPEN | сборки с `399e1d4` выданы (demo-latest, apk-preview-60); результатов нет |

PR #60: HEAD `f4e046a` (docs), предыдущий `399e1d4` CI 10/10; `mergeable_state:
clean`. Merge не выполнялся. В production застейджено одно изменение —
удаление временного сервиса `verify-restore-20260919` (Railway требует 2FA
в дашборде); других staged-изменений нет.

**NOT READY — human alert secret + alert:verify, Viva tunnel (down) + OTP,
device review.**

---

# Проверка №17 — 20.09.2026 07:45–07:50 UTC: Viva CLOSED

Владелец сообщил, что туннель настроен. По факту:

- run 35497722125, 07:45:29 UTC: `https://217.76.49.94/health` →
  `{"status":"ok","tunnel":"up"}` (до этого `down` во всех 24 опросах
  с 19.09 14:43).
- Один реальный OTP на согласованный номер владельца (+374 96 ** ** 90),
  отправлен изнутри Railway через временную функцию (`POST
  /v1/auth/login/request-otp` и `/register/request-otp`, оба 201).
  Лог tutak-api 07:49:35 UTC, requestId `7e2f657a…`: **`otp login:
  code-handed-to-carrier`**; `register` — `skipped-number-already-registered`
  (номер зарегистрирован, ожидаемо).
- Владелец подтвердил: **СМС пришла**.

Gate Viva закрыт: туннель up, Viva приняла, человек получил.

| # | Gate | Статус |
|---|---|---|
| GitHub ruleset / default branch | CLOSED |
| Railway Wait for CI ×3 | CLOSED |
| PITR + restore (RESTORE PASS) | CLOSED |
| Viva SMS | **CLOSED** (07:49 UTC) |
| Human alerts | OPEN — `ALERT_TELEGRAM_BOT_TOKEN` стоит, нет `ALERT_TELEGRAM_CHAT_ID`, тестовый alert не отправлен |
| Device review | OPEN — результатов нет |

PR #60: HEAD `5b8151e`, CI 10/10, `mergeable_state: clean`, 0 позади `main`.
Merge не выполнялся. В Railway по-прежнему застейджено только удаление
`verify-restore-20260919` (его код временно заменён на OTP-пробу; сервис
завершил работу, ничего не хранит).

**NOT READY — Telegram chat id + подтверждение тестового alert, device
review.**

---

## 21.09.2026, 21:00Z — Telegram: переменные поставлены, код не задеплоен

По поручению владельца в `tutak-api` (project **TuTak**, environment
**production**) установлены две переменные:

| Переменная | Было | Стало |
| --- | --- | --- |
| `ALERT_TELEGRAM_BOT_TOKEN` | стояла с 19.09 | перезаписана новым значением |
| `ALERT_TELEGRAM_CHAT_ID` | отсутствовала | **SET** |

Значения здесь не приводятся. Токен передан владельцем в переписке и записан
только в Railway — ни в один файл, коммит, PR или лог он не попадал.

Поставлено с `skipDeploys=true`: **редеплоя не было**. Это означает, что
работающий контейнер по-прежнему видит старое окружение — новые значения
применятся при следующем деплое. Других переменных не трогал.

### Почему alert:verify не запускался

Задеплоен коммит `369eda1` (deployment `f94d56eb`, SUCCESS, 19.09 07:30Z,
ветка `main`) — та же голова, что и до правки, то есть редеплой действительно
не случился.

В коде этой головы **канала Telegram нет**. `apps/api/src/infrastructure/alerts/`
на `origin/main` содержит только `console-alert.channel.ts` и
`webhook-alert.channel.ts`; `alerts.module.ts` выбирает между ними по наличию
`ALERT_WEBHOOK_URL` и переменные `ALERT_TELEGRAM_*` не читает вовсе.
Единственное упоминание Telegram на `main` — комментарий в
`alert-verify.ts:9`. `TelegramAlertChannel` появляется только в RC-цепочке
(PR #67 / `claude/rc-20260921`).

Поэтому запускать `alert:verify` против production бессмысленно: он не может
сертифицировать канал, которого в задеплоенном коде нет. Подменять Telegram
через `ALERT_WEBHOOK_URL` и делать временные обходы владелец запретил, и я
этого не делал.

### Статус gates после правки

| # | Gate | Статус |
|---|---|---|
| GitHub ruleset / default branch | CLOSED |
| Railway Wait for CI ×3 | CLOSED |
| PITR + restore | CLOSED |
| Viva SMS | CLOSED |
| Human alerts | **OPEN** — обе переменные стоят, но код Telegram не задеплоен; нужен деплой RC, затем `alert:verify` и подтверждение получения человеком |
| Device review | OPEN — результатов нет |

PR #67 не merge-ил, production branch не менял, редеплой не делал.

**TELEGRAM VARIABLES CONFIGURED — WAITING FOR RC DEPLOYMENT.**

### 21:10Z — попытка проверки канала: из среды Claude невозможна

По поручению владельца запущен штатный `pnpm --filter @tutak/api alert:verify`
на коде RC (`claude/rc-20260921`, `f853d60`). Без merge, без деплоя, без
изменения переменных и кода.

| Что | Результат |
| --- | --- |
| exit code | 1 |
| выбранный канал | `telegram` (`TelegramAlertChannel`) |
| доставлено | **НЕТ** |
| время попытки | 2026-09-21T21:10:08Z |
| deploy / redeploy | не было |

Ошибка: `telegram answered 403` — **без** поля `description`. Настоящий отказ
Bot API всегда несёт `description` в JSON, поэтому причину проверил отдельно,
запросом **без токена и без отправки**:

```
GET https://api.telegram.org/  ->  curl: (56) CONNECT tunnel failed, response 403
```

Egress-прокси этой среды блокирует `api.telegram.org` на стадии CONNECT.
Значит 403 выдал прокси, запрос до Telegram не дошёл.

**Следствие, важное для gate 4: токен и chat id не проверены ни в одну
сторону.** Они не подтверждены и не опровергнуты; оснований для ротации
токена этот прогон не даёт.

Оговорка о чистоте эксперимента: полноценного `railway run` не было —
значения production-переменных читать не дают (классификатор,
`Credential Materialization`), Railway CLI и токена в среде нет. Production
были только два значения Telegram (получены от владельца); `REDIS_URL` и
`DATABASE_URL` брались локальные (`DATABASE_URL` нужен скрипту лишь для
прохождения валидации — к Postgres он не подключается).

**Вывод: закрыть gate 4 из этой среды нельзя в принципе.** `alert:verify`
должен быть запущен оттуда, где есть доступ к Bot API: с сервиса Railway
(требует деплоя RC — отдельное решение владельца) либо с машины владельца
с теми же двумя переменными.
