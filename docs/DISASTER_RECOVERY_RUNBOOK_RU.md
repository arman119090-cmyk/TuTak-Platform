# Runbook восстановления базы данных (Disaster Recovery) — production TuTak

Дата: 19.09.2026. Состояние на дату — **проверено через Railway API**,
кроме отмеченного UNVERIFIED.

## 0. Что есть на самом деле (факты, не пожелания)

| Факт | Значение | Как проверено |
|---|---|---|
| СУБД | Railway Postgres, образ `ghcr.io/railwayapp-templates/postgres-ssl:18`, регион `sfo`, 1 реплика | `describe-service` |
| Том данных | `postgres-volume`, **5000 MB**, монтирован в `/var/lib/postgresql/data` | `describe-service` |
| Доступ снаружи | **нет**: ни TCP-proxy, ни домена; только private network `postgres` | `tcpProxies: []`, `domains: []` |
| PITR (непрерывный WAL-архив) | **ВЫКЛЮЧЕН** — переменных `WAL_ARCHIVE_*` у сервиса нет | список переменных сервиса Postgres |
| Volume backups (снимки тома по расписанию) | **неизвестно; считать ВЫКЛЮЧЕННЫМИ**, пока Арман не увидит их в UI | Railway API/MCP не отдаёт состояние расписания (UNVERIFIED) |
| Успешный restore в новый сервис | **ни одного** | никто не делал |
| Миграции Prisma | 71 миграция; применяются при каждом старте API (`prisma migrate deploy` в `docker-entrypoint.sh`) | репозиторий |
| Скрипты репозитория (`scripts/backup.sh`, `restore.sh`, `pitr-*.sh`) | рассчитаны на self-hosted Postgres с прямым `DATABASE_URL`; **к Railway из ноутбука не применимы** без TCP-proxy; в образе API нет `pg_dump` (alpine, только Node) | `Dockerfile`, `tcpProxies: []` |

Вывод: **сегодня production-база TuTak не имеет ни одной проверенной
резервной копии.** Потеря тома или неверная миграция = потеря всех
пользователей, партнёров, покупок и ledger. Это P0 пилота.

## 1. Что включить (делает Арман, 10 минут, UI Railway)

Railway MCP/API из этой сессии **не может** включить ни PITR, ни расписание
снимков — это делается только в UI (или Railway CLI с интерактивным
логином). Минимальные шаги:

1. Railway → проект **TuTak** → сервис **Postgres** → вкладка **Backups**.
2. **Enable PITR.** Railway создаст bucket `Postgres-PITR`, добавит
   переменные `WAL_ARCHIVE_*` и **переразвернёт Postgres** (короткий
   даунтайм API ≈ 30–60 с; делать не в час пик). После — прислать
   скриншот вкладки Backups с «PITR enabled».
3. Там же включить **scheduled volume backups**: `daily` (минимум) —
   снимок тома целиком, независимый от PITR. Это вторая, независимая линия.
4. Через сутки: убедиться, что во вкладке Backups есть первый **full
   backup** и растущий список WAL; в Postgres-логах нет строк
   `archive_command failed`.

## 2. Параметры (что обещает Railway, и что это значит для TuTak)

| Параметр | Значение | Источник |
|---|---|---|
| Частота PITR | full — еженедельно; differential — ежедневно; WAL — непрерывно (pgBackRest) | Railway docs (PITR) |
| Retention PITR | хранятся последние 4 full-бэкапа ⇒ **≈ 4 недели** глубины | Railway docs |
| Частота снимков тома | по выбранному расписанию: daily / weekly / monthly | Railway docs |
| **RPO** (сколько данных можно потерять) | при PITR — до **≈ 1 минуты** (WAL-сегмент закрывается по `archive_timeout`, по документации ~60 с) — UNVERIFIED на нашем сервисе до включения; при только снимках тома — **до 24 часов** | docs |
| **RTO** (сколько восстанавливаемся) | restore 5 GB в новый сервис — минуты (UNVERIFIED, не измерено); + проверка данных 10 мин; + переключение `DATABASE_URL` у tutak-api и редеплой ≈ 3–4 мин; **целевой RTO 30–60 мин при наличии дежурного** | оценка |
| Объём | том 5000 MB; сейчас данных мало (пилот); при заполнении тома Postgres перестаёт писать — см. runbook инцидентов §12 | `describe-service` |

## 3. Сценарии

### 3.1 Потеря/повреждение тома Postgres

- **Симптом:** Postgres не стартует, `/health/ready` → `database: error`,
  алерт `readiness.database.unreachable`; Railway показывает ошибку тома.
- **Действие (PITR включён):** Backups → «Restore to this moment» →
  выбрать момент **до** повреждения → Railway создаёт **новый сервис**
  `Postgres-restored-YYYYMMDD-HHMM` (исходный не трогается) → §4 проверка →
  §5 переключение.
- **Действие (только снимки тома):** Backups → снимок → Restore. По
  документации Railway restore тома **заменяет содержимое текущего тома**
  (UNVERIFIED); перед restore сделать ручной снимок текущего состояния.
  Потеря — всё после снимка (до 24 ч).
- **Действие (ничего не включено — сегодняшнее состояние):** данных нет.
  Единственный источник правды — партнёры (их кассовые записи) и клиенты.
  Пилот останавливается.

### 3.2 Плохая миграция (API упал на старте или испортил данные)

`prisma migrate deploy` выполняется при каждом старте контейнера **до**
`node dist/main.js`. Два случая:

- **Миграция упала** (ошибка SQL): Prisma помечает её как failed, API не
  стартует, Railway с restart policy ALWAYS будет перезапускать контейнер
  и каждый раз падать на той же миграции. Данные при этом **не
  повреждены** (миграция в транзакции откатилась). Действие: Railway →
  tutak-api → предыдущий успешный деплой → **Rollback**. Старый код с
  неприменённой миграцией работает (миграции аддитивны). Затем инженер
  чинит миграцию в коде.
  Важно: Prisma откажется применять следующие миграции, пока failed не
  разрешена (`prisma migrate resolve --rolled-back <name>`) — это делает
  инженер через Railway shell, не оператор.
- **Миграция применилась, но данные испорчены** (например, неверный
  UPDATE в миграции): единственный откат — **PITR restore на момент до
  деплоя** (§3.1). Поэтому перед любым деплоем с миграцией, меняющей
  данные, дежурный записывает точное UTC-время начала деплоя.

### 3.3 Ошибочная ручная операция в БД

То же, что 3.2 второй случай: PITR restore в новый сервис на момент до
операции, сравнение двух баз, перенос только того, что появилось после
(покупки, регистрации) — это ручная работа инженера, не оператора.

### 3.4 Регион/платформа Railway недоступны

Restore невозможен, пока Railway недоступен. Copy off-platform (§6) —
единственная защита от этого сценария; сегодня её нет.

## 4. Проверка восстановленной базы (обязательна до переключения)

Выполняется в Railway → сервис `Postgres-restored-…` → Data/Query (или
`railway connect` с ноутбука). Все запросы — только чтение.

```sql
-- 1. Схема на месте: 71 миграция применена, ни одной failed
SELECT count(*) FILTER (WHERE finished_at IS NOT NULL) AS applied,
       count(*) FILTER (WHERE finished_at IS NULL)     AS failed
FROM _prisma_migrations;
-- ожидание: applied = 71 (или больше, если после 19.09 добавили), failed = 0

-- 2. Объёмы (сравнить с теми же цифрами на исходной базе, если она жива,
--    или с последним известным Admin → Overview)
SELECT 'users' t, count(*) FROM users
UNION ALL SELECT 'partners', count(*) FROM partners
UNION ALL SELECT 'purchase_intents', count(*) FROM purchase_intents
UNION ALL SELECT 'purchase_intents_confirmed', count(*) FROM purchase_intents WHERE status = 'CONFIRMED'
UNION ALL SELECT 'ledger_transactions', count(*) FROM ledger_transactions
UNION ALL SELECT 'ledger_postings', count(*) FROM ledger_postings
UNION ALL SELECT 'bonus_lots', count(*) FROM bonus_lots
UNION ALL SELECT 'wallets', count(*) FROM wallets;

-- 3. Ledger сходится (двойная запись, дебет-положительный):
--    сумма балансов всех счетов = 0 — это то же число, что метрика
--    tutak_ledger_imbalance_amd
SELECT coalesce(sum(balance), 0) AS imbalance FROM ledger_accounts;
-- ожидание: 0

-- 4. Баланс каждого счёта равен сумме его проводок
--    (amount всегда > 0, знак задаёт direction: DEBIT = +, CREDIT = −)
SELECT a.id, a.type, a.balance,
       coalesce(sum(CASE WHEN p.direction = 'DEBIT' THEN p.amount ELSE -p.amount END), 0) AS posted
FROM ledger_accounts a LEFT JOIN ledger_postings p ON p."accountId" = a.id
GROUP BY a.id, a.type, a.balance
HAVING a.balance <> coalesce(sum(CASE WHEN p.direction = 'DEBIT' THEN p.amount ELSE -p.amount END), 0);
-- ожидание: 0 строк

-- 4b. Каждая ledger-транзакция сбалансирована сама по себе
SELECT "transactionId",
       sum(CASE WHEN direction = 'DEBIT' THEN amount ELSE -amount END) AS delta
FROM ledger_postings GROUP BY "transactionId" HAVING sum(CASE WHEN direction = 'DEBIT' THEN amount ELSE -amount END) <> 0;
-- ожидание: 0 строк

-- 5. Последняя запись — до какого момента восстановились (RPO по факту)
SELECT max("createdAt") FROM purchase_intents;
SELECT max("postedAt") FROM ledger_transactions;
```

Если запрос 1 показывает failed > 0 или applied меньше ожидаемого, или
запросы 3–4 не нули — **не переключать**, звать инженера.

## 5. Переключение API на восстановленную базу

1. Railway → `Postgres-restored-…` → Variables → скопировать `DATABASE_URL`
   (private, `postgres-restored-….railway.internal`).
2. tutak-api → Variables → `DATABASE_URL` = новое значение (в Railway это
   обычно reference `${{Postgres.DATABASE_URL}}` — заменить на reference на
   новый сервис). Не забыть `?connection_limit=5` и прочие параметры,
   которые были в старом значении (посмотреть старое значение **до**
   замены).
3. Redeploy tutak-api → дождаться `/health/ready` = 200 → Admin → Overview
   → цифры совпадают с §4.
4. Старый сервис Postgres **не удалять** минимум 7 дней.
5. Включить PITR на новом сервисе (restore-сервис создаётся без него).

## 6. Копия вне Railway (после пилота, не блокер)

Railway не имеет `pg_dump` в образе API и не даёт публичного доступа к
Postgres. Варианты, оба требуют решения Армана:
- одноразово создать TCP-proxy на Postgres (публичный порт, защищён
  паролем + TLS) и раз в сутки с ноутбука/VPS запускать
  `scripts/backup.sh` c `BACKUP_AGE_RECIPIENT` (шифрование) — proxy можно
  держать только на время бэкапа;
- либо отдельный Railway-сервис-cron с `postgres`-образом, делающий
  `pg_dump` в S3-bucket (у проекта уже есть S3 для медиа).

## 7. Учения (закрытие gate)

Gate «BACKUP» закрыт только когда выполнена цепочка **BACKUP EXISTS →
RESTORE TO NEW DB → DATA VERIFIED** и в этот файл вписано:

| Дата | Кто | Что восстановили (момент) | applied/failed | users/partners/intents/postings/lots | imbalance | Время restore | Вердикт |
|---|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — | **НЕ ПРОВОДИЛОСЬ** |

Повторять после каждого изменения версии Postgres, тома или расписания.
