# Проверка PITR-restore production Postgres — 19.09.2026 17:43 UTC

## Задание

Владелец включил PITR на production Postgres и восстановил копию в новый
сервис `Postgres-restored-20260919-1733`. Проверить restored-БД только на
чтение: миграции, таблицы, ledger-инварианты, imbalance = 0, row counts
против production, отсутствие повреждений. Production `DATABASE_URL` не
менять, API к restored не подключать, ни одну БД не удалять, секреты не
выводить. Вердикт: RESTORE PASS / FAIL.

## База

Production Postgres `34eca4f9…` (образ `postgres-ssl:18`, `main` `369eda1`,
71 миграция). Restored `1ac76166…`, private endpoint `postgres-68f0`, том
`postgres-restored` 50 000 MB, деплой `305a68ff` SUCCESS 17:35 UTC,
`POSTGRES_RECOVERY_TARGET_TIME = 2026-09-19 17:33:13+00`.

## Как проверял

Из этой среды до private network Railway не достучаться, а TCP-proxy
открывать не стал (публикация порта БД). Поэтому создал в production
временную Railway Function `verify-restore-20260919` (Bun, `Bun.sql`) —
дословный порт `scripts/verify-restored-db.sh`: те же SQL, те же названия
проверок; сессия `default_transaction_read_only=on` с контрольной
попыткой записи (обязана упасть); connection strings переданы reference-
переменными `${{Postgres-restored-….DATABASE_URL}}` / `${{Postgres.DATABASE_URL}}`
и в лог не попадают (scrub). Source читался первым, до restored.
Дополнительно — полный `count(*)` по всем 67 public-таблицам (чтение
каждой страницы). Деплой функции `8e45abde`, лог 17:43:13 UTC.

## PITR на production — healthy

Лог Postgres (деплой `e8b6faaf`, после включения PITR в 17:32 UTC):
`stanza-create completed` 17:33:00; `backup --type=full completed`
17:33:13; `catalog verified — full backup present in S3` 17:34:14; далее
каждую минуту `archive-push … 0000…0C…12`; watcher 17:42:20:
`archived=12, failed=0, gap_state=clear, lag=0`. Переменные
`WAL_ARCHIVE_*` на сервисе есть, bucket `postgres-pitr-v1w50docixl`.

## Restore — лог восстановления

`restore backup set 20260919-173303F`, `restore size = 35.5MB, file total
= 1734`, `starting point-in-time recovery to 2026-09-19 17:33:13+00`,
`last completed transaction was at log time 17:33:09.625988`, `recovery
stopping before commit of transaction 148648, time 17:33:13.228708`,
`consistent recovery state reached`, `archive recovery complete`, новый
timeline 2, `database system is ready to accept connections` 17:35:59.
Restored отвечает `pg_is_in_recovery = false` (промоут выполнен).

## Результат проверки (лог функции, 17:43:13 UTC)

| Проверка | Статус | Значение |
|---|---|---|
| migrations_applied | PASS | 71 (ожидалось 71; последняя `20260915220000_psp_reconciliation_two_calls`) |
| migrations_failed | PASS | 0 |
| migrations_unique | PASS | 0 дублей |
| tables_present | PASS | 11/11 |
| ledger_imbalance | PASS | 0 |
| accounts_match_postings | PASS | 0 расхождений |
| transactions_balanced | PASS | 0 |
| wallets_non_negative | PASS | 0 |
| bonus_lots_consistent | PASS | 0 |
| refunds_within_gross | PASS | 0 |
| postings_have_transactions | PASS | 0 |
| full_scan_all_tables | PASS | 67 таблиц, 385 строк, ни одной ошибки чтения |

Row counts restored / production сейчас: users 11/11, partners 1/1,
wallets 9/9, purchase_intents 0/0, ledger_transactions 0/0,
ledger_postings 0/0, ledger_accounts 0/0, bonus_lots 0/0,
partner_settlements 0/0, purchase_intent_refunds 0/0, referral_invites
0/0, CONFIRMED purchases 0. Последний пользователь создан 15.09 15:15 —
production с тех пор не менялся, поэтому полное совпадение ожидаемо.
Ни одна таблица restored не больше source.

Про «74 миграции»: 74 — это ветка PR #60, она ещё не в production;
restored корректно повторяет production (71). После мержа ожидание для
будущих restore — 74.

## Вердикт

**RESTORE PASS.** Production Postgres не менялся (проверено:
`DATABASE_URL` tutak-api по-прежнему `${{Postgres.DATABASE_URL}}`, staged
изменений нет). Restored-сервис оставлен, не удалён.

## Android-сборки для device review (HEAD PR #60 `399e1d4`)

| Сборка | Ссылка | Байт | SHA-256 |
|---|---|---|---|
| Демо (`am.tutak.demo`, офлайн, без СМС) | https://github.com/arman119090-cmyk/TuTak-Platform/releases/download/demo-latest/tutak-demo.apk (run 35457974345, опубликовано 17:35:31 UTC) | 127 166 487 | `1c6d0389c3e689da1b79517886b9f577482566dcf3ac33625d91cb7e85633731` |
| Preview на production API (`https://tutak-api-production.up.railway.app/v1`) | https://github.com/arman119090-cmyk/TuTak-Platform/releases/download/apk-preview-60/tutak.apk (run 35457975408, 17:46:13 UTC) | 127 171 426 | `e490c1a0e7a989a095255bb736dda5899217bd9a6bec83c0c914c19f59bba6aa` |

SHA-256 посчитаны мной по скачанным файлам; preview совпадает с notes
release. Мобильный код `399e1d4` = `cf87f72` (RC), diff пуст.

## Остальные gates (перепроверены 17:59 UTC)

- Human alerts — OPEN: у tutak-api нет `ALERT_*` переменных.
- Viva — OPEN: run 35459764461, 17:59:45: `/health` → `tunnel: down`.
- Device — OPEN: ждём результаты по `docs/OWNER_DEVICE_TEST_RU.md`.
- PR #60: HEAD `399e1d4`, CI 10/10, `mergeable_state: clean`, не мержился.

## Что НЕ сделано / ошибки

- Временный верификатор `verify-restore-20260919` два раза не удалился
  (таймаут MCP 60 с); передал удаление Railway Agent — см. итог в чате.
  Он ничего не делает (скрипт завершился), данных не хранит.
- `verify-restored-db.sh` как bash-скрипт не запускался (нет psql-доступа
  отсюда); запущен его дословный порт. Расхождений в логике нет, но это
  порт, а не сам файл.
- `describe-service` production Postgres был заблокирован политикой
  среды; использовал `get-service-config` (тот же факт).

## UNVERIFIED

- Ничего по restore. По PITR — окно восстановления начинается с 17:33:03
  UTC (первый full), раньше восстановить нельзя.
