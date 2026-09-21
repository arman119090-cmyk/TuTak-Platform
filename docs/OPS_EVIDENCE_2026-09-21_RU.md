# Эксплуатационные доказательства 21.09.2026 — пункты 9, 10, 14, 15, 16 чек-листа

Что проверено по факту, чем и с какими числами. Production не менялся. Всё ниже — либо
запросы только на чтение к production, либо локальный стенд (PostgreSQL 16, Redis 8 на
машине сессии) с кодом ветки `claude/rc-20260921` (`dfd5a5a`) и кодом production `main`
(`369eda1`).

## Пункт 10 — глубина `X-Forwarded-For` на боевом ingress: ИЗМЕРЕНО, значение верное

Способ: workflow `Measure the proxy chain` (run 35602403969, 21.09 12:55:45Z) с runner
GitHub → `GET https://tutak-api-production.up.railway.app/health` с
`X-Forwarded-For: 203.0.113.7` и `X-TuTak-Proxy-Probe: 203.0.113.7`. Ни SMS, ни записи.

Ответ API в логе Railway (deploy-лог tutak-api, 12:55:50Z, контекст `ProxyChain`):

> X-Forwarded-For entries: 2; probe marker position from right: 0; X-Real-IP present: true;
> X-Real-IP position from right: 2. The marker did not survive: this edge replaces
> X-Forwarded-For rather than appending to it, so every entry is infrastructure-written.
> CLIENT_IP_TRUSTED_HOPS=2.

То есть edge Railway **заменяет** заголовок, а не дописывает: подделать левую запись
клиент не может. Значение в production: boot-лог 19.09 07:31:59Z — «Client IP resolved
from X-Forwarded-For, trusting 2 hop(s) from the right». Настроено = измерено.
Per-IP лимиты OTP действуют с реальным адресом клиента.

Не проверено: сам лимит OTP «в бою» (потребовал бы SMS-запросов). Логика лимита покрыта
интеграционными тестами.

## Пункт 14 — откат: миграции RC против кода production

### 14.1 Статический разбор DDL всех миграций после `369eda1` (8 штук)

| Миграция | Что делает | Опасно для кода `main`? |
| --- | --- | --- |
| `20260919100000_media_asset_kind_promo_artwork` | новое значение enum | нет |
| `20260919100100_partner_promos` | новая таблица; на `media_assets` CHECK заменён на надмножество (добавлен вид `PROMO_ARTWORK`), уникальный индекс пересоздан с исключением `PROMO_ARTWORK` | нет: старый код не пишет `PROMO_ARTWORK`, старые строки удовлетворяют новому CHECK |
| `20260919120000_partner_promo_translations` | `DROP COLUMN title/subtitle/benefitLabel` у `partner_promos` после переноса в `translations` | нет: таблицы `partner_promos` в коде `main` не существует |
| `20260920100000_hybrid_prepaid_funding` | новые столбцы с DEFAULT, новые таблицы/счета | нет |
| `20260920110000_balance_topup_unresolved` | новое значение enum | нет |
| `20260920120000_partner_checkouts` | новая таблица | нет |
| `20260920120100_merchant_approval_by_api_key` | новый nullable столбец; CHECK `merchant_approval_is_complete` заменён на надмножество (оба старых случая остались допустимыми); функция триггера расширена новыми столбцами | нет |
| `20260921100000_refund_rounding_policy_version` | `ADD COLUMN … DEFAULT 2` + UPDATE существующих строк на 1 | нет |

Вывод: все 8 — expand-only относительно кода `main`. Contract-шаги (`DROP COLUMN`) есть
только на таблице, которой в `main` нет.

### 14.2 Динамическая проверка: код `main` на схеме RC

| Стенд | Схема | Код API | `/health/ready` | Smoke (`scripts/smoke-test.sh`, 39 проверок) |
| --- | --- | --- | --- | --- |
| контроль | 71 миграция `main` | `369eda1` | 200 через 4 с | 19 ✓ / 20 ✗ |
| откат | 79 миграций RC | `369eda1` | 200 через 4 с | 19 ✓ / 20 ✗ — **тот же список**, `diff` пуст |

Обе базы засеяны `seed-baseline` из `main`. Одинаковый результат на обеих схемах означает:
новая схема не ломает старый код ни на старте, ни на регистрации/логине/refresh/кошельке/
уведомлениях. 20 падений — одинаковые на контроле, т.е. это устаревший smoke-скрипт, а не
схема: `POST /v1/wallet/admin/adjust` отвечает 403 для SUPER_ADMIN из `seed-baseline`, и
дальнейшие шаги (партнёр, QR, оплата) не получают данных. **Это отдельная находка (P2):
`scripts/smoke-test.sh` не соответствует правам production-администратора и сейчас не
проверяет денежный путь.** Денежный путь на схеме RC покрыт интеграционными тестами RC
(125 suites), но не старым кодом — см. UNVERIFIED.

### 14.3 Процедура отката приложения (без отката схемы)

1. Railway → tutak-api / tutak-admin / tutak-partner → Deployments → предыдущий SUCCESS
   (`369eda1`) → Redeploy. Схема остаётся новой; по 14.1–14.2 старый код на ней работает.
2. Не запускать `migrate reset`/`down`: миграций «вниз» нет. Данные, записанные новым
   кодом в новые таблицы, остаются и не мешают старому.
3. Если откат нужен из-за данных, а не кода — PITR по `DISASTER_RECOVERY_RUNBOOK_RU.md` §3.2.

UNVERIFIED: покупка/оплата/возврат старым кодом на новой схеме (smoke не дошёл, см. выше);
откат на самом Railway не выполнялся (production не трогали).

## Пункт 16 — Redis: persistence на Railway и рестарт очередей

Факт из `get-service-config` сервиса Redis (production): образ `redis:8.2`, том смонтирован
в `/data`, start command `redis-server --requirepass … --save 60 1 --dir $RAILWAY_VOLUME_MOUNT_PATH`.
AOF выключен. Значит: RDB-снимок раз в 60 с при ≥ 1 изменении; штатный рестарт (SIGTERM)
сохраняет снимок и очереди BullMQ переживают его; **аварийное падение теряет до 60 с
изменений очередей** (outbox PSP, alerts, sweeps). Outbox хранит источник истины в
PostgreSQL (таблица outbox + retry), поэтому потеря задания в Redis — задержка, не потеря
события; alerts — повтор по следующему срабатыванию.

Локальный тест рестарта: см. раздел «Результаты локальных прогонов» ниже.

## Пункт 15 — нагрузка (локальный стенд)

См. раздел «Результаты локальных прогонов».

## Пункт 9 — backup → restore → verify с непустыми финансовыми таблицами (локально)

См. раздел «Результаты локальных прогонов».

## Результаты локальных прогонов

Стенд: 4 × Xeon 2.80 GHz, 15.7 GiB, node v22.22.2, PostgreSQL 16.13, Redis 8 — машина
сессии, не Railway. Интеграционный прогон RC (125 suites, 1594/1594) завершён до
нагрузки, параллельно ничего не шло.

### Пункт 15 — нагрузка (`node dist/scripts/load-test.js`, код RC `dfd5a5a`)

Параметры: `LOAD_CONCURRENCY=32 LOAD_SECONDS=15 LOAD_CUSTOMERS=50 LOAD_PARTNERS=4
LOAD_MONEY_CUSTOMERS=100 LOAD_REFERRAL_TREES=10`, `CARD_PAYMENTS_ENABLED=true` (иначе
harness не находит `PaymentEngineService` — модуль legacy-платежей подключается по флагу;
это надо дописать в `LOAD_TEST.md`, сделано ниже). Общее время 160 с.

| Фаза | Запросов | ok/s | p50 / p95 / p99, мс | Ошибок |
| --- | --- | --- | --- | --- |
| Payment capture | 1835 за 15.2 с | 120.9 | 250 / 360 / 432 | 0 |
| Idempotent replay | 7164 за 10.0 с | 715.2 | 45 / 56 / 63 | 0 |
| Outbox drain | 1837 событий за 45.7 с | 40.2 | — | 0 |
| Contended payouts (один партнёр) | 834 за 10.1 с | 82.2 | 183 / 321 / 438 | 0 |
| Purchase intent create+confirm (4 партнёра) | 832 за 15.5 с | 53.6 | 580 / 776 / 864 | 0 |
| Purchase, 3-уровневая реферальная цепочка | 670 за 15.6 с | 43.1 | 729 / 931 / 987 | 0 |
| Bonus + referral вместе | 487 за 15.8 с | 30.7 | 1021 / 1154 / 1204 | 0 |
| (фаза перед цепочкой) | 635 за 15.6 с | 40.7 | 773 / 893 / 994 | 0 |

Целостность после прогона: 8 счетов, 21 569 проводок, сумма 0.0000, dead-letter 0;
все 11 инвариантов денежного пути ✓ (кошельки = лоты, holds = резерв, ни одного двойного
зачисления, 2824 CONFIRMED-покупки с шестью согласованными «ногами»). В логе 18
`write conflict or deadlock` от PostgreSQL — все повторены движком, `failed 0`.

Сравнение с `LOAD_TEST.md` (9 августа, другая машина): capture там 143.2 /s при p95 348 мс
(и 154.6 /s при p95 517 мс во втором прогоне) — здесь 120.9 /s при p95 360 мс; порядок тот же,
разница — в машине и в том, что здесь 4 партнёра вместо одного. Что это **не** доказывает: поведение на плане Railway и его
`connection_limit` — стенд другой (п. 15 остаётся 🟡 до прогона на staging-окружении
Railway, которого нет).

### Пункт 9 — backup → restore → verify на непустой базе

База `tutak_load` после нагрузки: 59 MB; `ledger_postings` 21 569, `purchase_intents` 2824,
`payments` 1837, `wallets` 280, `bonus_lots` 8432 (settlements/collections 0 — их load-test
не создаёт).

| Шаг | Команда | Время | Результат |
| --- | --- | --- | --- |
| backup | `scripts/backup.sh` (pg_dump custom, compress 9) | 1.0 с | 5.4 MB, 69 таблиц с данными |
| restore | `scripts/restore.sh --into tutak_restored` | 1.6 с | 8 счетов, сумма 0; каждый счёт = replay проводок |
| verify | `scripts/verify-restored-db.sh … --compare <source> --expect-migrations 79` | 3.0 с | **PASS**: 79 миграций, 0 failed; все счётчики строк = источнику; imbalance 0.0000; 7 инвариантов PASS |

**Найдено и исправлено:** `scripts/backup.sh` падал с «Missing ledger_postings — this dump
is not a TuTak database» на заведомо правильном дампе: `pg_restore --list | grep -q` под
`set -o pipefail` — grep выходит на первом совпадении, pg_restore получает SIGPIPE, и
конвейер считается упавшим. Гонка, зависит от размера дампа. Исправлено (листинг читается
один раз в переменную), 3 прогона подряд — `✓ every money-bearing table is present`.
Production-workflow `backup.yml` использует `scripts/railway-backup.sh`, в котором этой
проверки нет — ночные бэкапы это не затрагивало.

RPO/RTO Railway не измерялись (production не трогали): восстановление на Railway
выполнено 19.09 (`RESTORE_VERIFY_2026-09-19_RU.md`). Здесь измерены только скрипты на
5.4 MB: суммарно < 6 с; на 5 GB ожидание — минуты, не секунды (UNVERIFIED).

### Пункт 16 — Redis: рестарт очередей (локально, та же конфигурация `--save 60 1`, без AOF)

| Сценарий | Действие | Очередь до | Очередь после | Вывод |
| --- | --- | --- | --- | --- |
| штатный рестарт | 5 delayed + 1 waiting → `SHUTDOWN` (сохраняет RDB) → старт | 5/1 | **5/1** | задания переживают редеплой/рестарт |
| авария | новая очередь 5 delayed + 1 waiting → `kill -9` через < 60 с → старт | 5/1 | **0/0** | до 60 с изменений теряются |

Для TuTak это означает: outbox (источник в PostgreSQL, повтор sweep-ом) — задержка, не
потеря; alerts/sweeps — повтор по расписанию. Рекомендация владельцу (не сделано, это
изменение production-сервиса): добавить `--appendonly yes --appendfsync everysec` в start
command Redis на Railway, тогда окно потери ≤ 1 с. Не блокер пилота.

### Находки по ходу (P2, не блокеры)

- `scripts/smoke-test.sh` не соответствует правам production-администратора:
  `POST /v1/wallet/admin/adjust` → 403 для SUPER_ADMIN из `seed-baseline`, дальше 19 шагов
  не получают данных. Одинаково на схемах `main` и RC. Пункт 6 чек-листа опирается на этот
  смоук — его надо починить до первого релиза.
- Локальные PostgreSQL и Redis на машине сессии дважды умирали посреди работы (не OOM:
  12.5 GiB свободно); перезапускались вручную. К проекту отношения не имеет, но объясняет
  повторные прогоны.
