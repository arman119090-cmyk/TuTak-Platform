# TuTak — Disaster Recovery Runbook (26.09.2026)

Цели (предложение, утверждает владелец): **RPO ≤ 5 минут** (WAL-архив по
сегментам), **RTO ≤ 2 часа** (восстановление в новый сервис Postgres +
переключение `DATABASE_URL`). Всё, что меняет production, выполняет владелец;
агент готовит команды и проверяет по логам.

## 1. Что защищено и чем

| Актив | Механизм | Где живёт копия | Проверено |
|---|---|---|---|
| Postgres (леджер, пользователи, всё) | WAL-архив: `WAL_ARCHIVE_BUCKET/ENDPOINT/KEY/PATH/REGION/SECRET` на сервисе `Postgres` (образ `postgres-ssl:18`) | Railway bucket `Postgres-PITR` (sjc) | **да, 19.09.2026**: сервис `Postgres-restored-20260919-1733` поднят из архива с `POSTGRES_RECOVERY_TARGET_TIME` (артефакт до сих пор в проекте — удалить по решению владельца) |
| Postgres — снапшоты тома | Railway Volume backups (Daily/Weekly/Monthly) | Railway | **NOT VERIFIED** — расписание не видно через MCP; владелец: сервис Postgres → Backups |
| Логический дамп | `scripts/backup.sh` (`pg_dump -Fc`, опционально `age`/gpg) | куда укажет владелец (вне Railway!) | CI репетирует restore каждого прогона (`Backup and restore rehearsal`) |
| Redis | том `redis-volume` 5 GB | Railway | не критично: сессии/кэш/очередь пересоздаются; refresh-токены — в Postgres |
| Медиа `tutak-media` | — | нет копии | **NOT VERIFIED / gap**: включить репликацию бакета или периодический `aws s3 sync` |
| Код и конфиг | GitHub `main`; переменные — только в Railway | — | переменные экспортировать (имена+значения) в парольный менеджер владельца — OWNER |

## 2. Сценарии

### 2.1 Кто-то выполнил неверный UPDATE/DELETE в 14:53

1. `EMERGENCY_FREEZE=true` на `tutak-api` (записи стоп, чтение работает).
2. Определить точку: последняя заведомо хорошая операция по `audit_logs` /
   `ledger_transactions.postedAt` → `T = 14:52:30`.
3. Новый сервис Postgres из шаблона `postgres-ssl:18` с переменными
   `WAL_RECOVER_FROM_*` = значения `WAL_ARCHIVE_*` основного и
   `POSTGRES_RECOVERY_TARGET_TIME=T` (ровно так поднимался
   `Postgres-restored-20260919-1733`). **Не восстанавливать поверх живой БД.**
4. Сравнить: `psql` в обеих; леджер сходится (`SELECT SUM(CASE WHEN direction='DEBIT' THEN amount ELSE -amount END) FROM ledger_postings` = 0);
   `scripts/restore.sh --verify` для дампа.
5. Решение владельца: переключить `DATABASE_URL` на восстановленную (потеря
   всего после T) **или** перенести только повреждённые строки руками из
   восстановленной в живую (с записью в audit).
6. Снять freeze; `/health/ready`; алерт-тест.

### 2.2 Том Postgres утерян / регион недоступен

Как 2.1 без шага 5-выбора: восстановить `latest` в новый Postgres (можно в
другом регионе — см. `REGION_MIGRATION_PLAN.md`), переключить `DATABASE_URL`
у трёх сервисов, Redeploy. RTO определяется объёмом WAL с последнего
базового бэкапа — поэтому базовый бэкап (`pitr-basebackup.sh`-эквивалент
шаблона) должен быть не старше суток (**проверить у шаблона Railway,
NOT VERIFIED**).

### 2.3 Потеря аккаунта Railway (разработчик недоступен/заблокирован)

Сегодня — **нет процедуры**: проект в чужом workspace. Единственная защита —
внешний логический дамп (`scripts/backup.sh` с production `DATABASE_URL` на
машину владельца, ежедневно) + экспорт переменных. Устраняется переносом
проекта (`INFRASTRUCTURE_OWNERSHIP.md` §3). **Это главный DR-риск платформы.**

### 2.4 Компрометация секретов

- `DATABASE_URL`/`REDIS_URL`: Railway пересоздаёт креды Postgres/Redis
  (Variables → regenerate) → сервисы перезапускаются автоматически.
- `JWT_*`: ротация без разлогина — задать `JWT_ACCESS_SECRET_PREVIOUS` = старый,
  `JWT_ACCESS_SECRET` = новый, через TTL access-токена убрать previous
  (owner-процедура, риск даунтайма → в списке STOP).
- Viva/S3 ключи — перевыпуск у провайдера, затем Variables.
- Telegram-бот — `/revoke` у BotFather, новый токен в Variables.

## 3. Учения (регламент — предложение)

| Что | Как часто | Кто | Доказательство |
|---|---|---|---|
| `scripts/restore.sh --verify <dump>` на свежем дампе | еженедельно | владелец (можно cron у себя) | лог «ledger balances» |
| PITR в новый сервис по `POSTGRES_RECOVERY_TARGET_TIME` | ежеквартально | владелец + агент | сравнение балансов, запись в этот файл |
| `scripts/pitr-rehearse.sh` (локальная сквозная репетиция) | при изменении Postgres-образа | агент | вывод скрипта |
| `scripts/chaos-postgres.sh` (падение БД под нагрузкой) | перед публичным запуском | агент на staging | отчёт |

Журнал учений: 19.09.2026 — PITR восстановление успешно (сервис
`Postgres-restored-20260919-1733`); 26.09.2026 — CI restore rehearsal
зелёный на каждом прогоне; локально `restore.sh --verify` — не запускался в
этой сессии (UNVERIFIED здесь, CI покрывает).

## 4. Контакты и доступы

Заполняет владелец: кто держит Railway Admin, кто — GitHub Admin, кто —
Viva/Contabo, Expo, Telegram-бот; где парольный менеджер с экспортом переменных.
Без этого раздела runbook при инциденте ночью не работает.
