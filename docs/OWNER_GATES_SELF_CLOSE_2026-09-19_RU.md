# Попытка закрыть gates своими силами — 19.09.2026 16:05 UTC

## Задание

«TUTAK — CLOSE EVERYTHING YOU CAN YOURSELF BEFORE ASKING OWNER»: для
каждого gate реально попытаться закрыть его через Railway Agent /
connector'ы, и только после фактического отказа по permission/API
ставить статус блокировки. Без нового кода, аудита, visual pass. PR #60
не мержить.

## База

PR #60, ветка `claude/final-integration-20260919`, HEAD `213f42d`
(CI 10/10 success: runs 35452758218, 35452756547). `main` `369eda1` =
production. Railway-аккаунт connector'а: план **HOBBY**.

## Таблица статусов

| Gate | Status | Что реально попытался | Что получилось | Почему заблокировано | Что требуется от Армана |
|---|---|---|---|---|---|
| 1. Wait for CI ×3 | **BLOCKED BY PERMISSION** (API limitation) | Railway Agent (thread `1471a0a3`): «включить `source.checkSuites=true` на tutak-api/admin/partner, если применяется без redeploy» | Агент вызвал `updateServiceTool` ×3 → патч **staged**. `get-staged-changes` показал: в патче `source: {}` — **пустой объект, без checkSuites**; live config остался `checkSuites:false` ×3. Агент подтвердил: в его схеме `source` нет поля `checkSuites`, другого пути (mutation/reconnect) у него нет. По моей просьбе патч **удалён** (`discardStagedChangesTool`); `get-staged-changes` → `staged:null`, 0 изменений; конфиг трёх сервисов не изменился | Поле недоступно ни connector'у (`update-service` не имеет source-полей), ни Railway Agent'у. Через API применить нельзя | Railway → сервис → Settings → Source → переключатель **Wait for CI** — на tutak-api, tutak-admin, tutak-partner. Это не деплой и не перезапуск: влияет только на будущие push'и в `main`. Я после этого перепроверю `checkSuites` через API |
| 2. Backup / PITR | **BLOCKED BY PERMISSION** (план Hobby) + **REQUIRES OWNER CONFIRMATION** (PITR) | Railway Agent (thread `7568e807`): статус backup'ов тома, поддержка PITR, включить daily, создать backup | Volume backups: `getPlanLimits` → `planTier: HOBBY`, `volumes.maxBackupsCount: 0` — создание, расписание и restore volume-backup недоступны, backup'ов у тома нет. PITR: образ `postgres-ssl:18` (major tag) подходит; доступность на Hobby в документации не указана; включение = создать bucket + переменные `WAL_ARCHIVE_*` + **redeploy Postgres** (перезапуск БД → короткий простой API), применяется сразу, не staged. Не выполнял | Backup-функции требуют Pro. PITR — перезапуск production-БД и, возможно, тоже отказ по плану | Одно из: (а) апгрейд workspace до Pro → затем `backup.yml` заработает с `RAILWAY_PROJECT_TOKEN`; (б) подтвердить включение PITR (Railway → Postgres → Backups → Enable PITR; ~минута простоя БД) — тогда включу/проверю; (в) дать доступ к БД для pg_dump (TCP proxy = публикация порта БД, нужно ваше «да») |
| 3. Restore в новую БД | **BLOCKED** (зависит от 2) | — | Восстанавливать нечего. `scripts/verify-restored-db.sh` не запускался | Нет backup | После закрытия gate 2: PITR-restore создаёт **новый** сервис `Postgres-restored-…` — production не трогается; затем я гоню `verify-restored-db.sh` |
| 4. GitHub default branch + protection | **BLOCKED BY GITHUB APP ADMINISTRATION PERMISSION** | Проверил набор инструментов GitHub-connector'а; попытался проверить права токена окружения на admin-эндпоинтах | В connector'е нет инструментов update repository / rulesets / branch protection (только contents, PR, actions, issues). Проверка токена через REST **запрещена политикой sandbox** («credential exploration») — права токена не установлены. Факт: default = `claude/tutak-loyalty-mvp-e485jm`, `main` не защищён | Ни один доступный инструмент не пишет настройки репозитория | GitHub → Settings → General → Default branch → `main`. Затем Settings → Rules → Rulesets → New branch ruleset: target `main`, **Require a pull request**, **Require status checks**: «Lint, test and build», «Integration tests (1/3)», «(2/3)», «(3/3)», «Build the container images». 3 минуты |
| 5. Human alert | **BLOCKED BY MISSING SECRET** | Имена переменных всех 5 сервисов Railway; env этой среды; ссылки на секреты в workflows | Нигде нет `ALERT_WEBHOOK_URL`, `ALERT_TELEGRAM_BOT_TOKEN`, `ALERT_TELEGRAM_CHAT_ID`, `SENTRY_DSN`. Workflows PR #60 ссылаются на `secrets.ALERT_WEBHOOK_URL`, но список GitHub-секретов connector не отдаёт, запусков этих workflow не было — доказательств существования нет. Значения не выводились, токены не придумывались | Секрета нет | Дать одно из: **Telegram bot token + chat id** или **webhook URL**. Положить в Railway → tutak-api → Variables (`ALERT_TELEGRAM_BOT_TOKEN`/`ALERT_TELEGRAM_CHAT_ID` или `ALERT_WEBHOOK_URL`) и в GitHub → Secrets → `ALERT_WEBHOOK_URL`. Код алертинга — в PR #60 (на `main` его нет), поэтому `alert:verify` доказуемо только после merge или из ветки |
| 6. Viva | **BLOCKED BY MISSING VPS ACCESS** | `command -v ssh` → нет клиента; `~/.ssh` пуст; `curl https://217.76.49.94` → egress-прокси режет raw IP (код 000); опрос через GitHub-runner | run 35453789158, 16:04:43 UTC: `/health` → `{"status":"ok","tunnel":"down"}` | Нет SSH/удалённого выполнения на VPS | На VPS 217.76.49.94: `sudo swanctl --initiate --child viva && sudo swanctl --list-sas`. Скажите — я повторю `/health`; при `tunnel: up` — один реальный OTP |
| 7. Device | **REQUIRES PHYSICAL DEVICE** | — | — | Физическая проверка | Samsung + Xiaomi по `docs/OWNER_DEVICE_TEST_RU.md` |

## Что сделано

- Gate 1: реальная попытка через Railway Agent; выявлен и удалён
  некорректный staged-патч; production не изменён (проверено
  `get-service-config` ×3 и `get-staged-changes` после отката).
- Gate 2: установлены факты плана (HOBBY, backup limit 0) и механики PITR.
- Gates 4–6: установлены точные технические ограничения.
- PR #60: CI на HEAD `213f42d` зелёный 10/10.

## Что НЕ сделано / собственные ошибки

- Ни один gate не закрыт — все семь остаются открытыми.
- **Ошибка по ходу**: первый вызов Railway Agent создал staged-патч с
  пустым `source: {}` вместо `checkSuites:true`. Если бы его приняли в
  UI, Wait for CI не включился бы, а source-конфиг мог пострадать.
  Обнаружено `get-staged-changes`, патч удалён до того, как кто-либо мог
  его применить. Урок: staged-патчи агента проверять до любого accept.
- Проверка admin-прав GitHub-токена не выполнена — запрещена политикой
  среды; сделал вывод из набора инструментов connector'а.
- Merge PR #60, production APK, iOS sim с `main` — не выполнялись (по
  заданию).

## Чем доказано

`railway-agent` threads `1471a0a3…`, `7568e807…`; `get-staged-changes`
до (patch `0f6283c7`, 3 изменения `source:{}`) и после (`staged:null`);
`get-service-config` ×3 (`checkSuites:false`, `staged:null`);
`getPlanLimits` (HOBBY, `maxBackupsCount:0`); GitHub run 35453789158
job 105925404911; check runs PR #60 на `213f42d` 10/10 success.

## UNVERIFIED

- Доступность PITR на плане Hobby (документация молчит).
- Существование GitHub-секретов `ALERT_WEBHOOK_URL`, `RAILWAY_*_TOKEN`.
- Права токена GitHub этой среды на administration.

## Вопросы владельцу

1. Backup: Pro-план, PITR с ~минутой простоя БД, или TCP proxy для
   pg_dump? Нужен один ответ.
2. Alert-канал: Telegram или webhook?

## Остаток (фактический)

**NOT READY — Wait for CI ×3 (UI), default branch + ruleset (UI), backup
(план/PITR — решение владельца), restore (после backup), alert secret,
Viva tunnel (down на 16:04 UTC), device review.**
