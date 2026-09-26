# TuTak — Production Runbook (Railway, 26.09.2026)

Действующая production-среда: Railway project «TuTak» → environment
`production` (регион `sfo`): `tutak-api`, `tutak-admin`, `tutak-partner`,
`Postgres`, `Redis`, бакеты `tutak-media`, `Postgres-PITR`. Владение —
`docs/INFRASTRUCTURE_OWNERSHIP.md` (сейчас аккаунт разработчика — P0).
Предыдущие runbook'и (`PRODUCTION_RUNBOOK_RU.md` — Render, `RAILWAY_PRODUCTION_RUNBOOK_RU.md`
— первый деплой) остаются как история; этот документ — то, что делать **сейчас**.

Всё ниже, что меняет production, делает **владелец** (или человек с его
доступом в Railway). Агент готовит команды и проверяет результат по логам.

## 0. Быстрые ссылки

| Что | Где |
|---|---|
| Здоровье API | `GET https://tutak-api-production.up.railway.app/health` (процесс), `/health/ready` (Postgres, Redis, storage) |
| Логи | Railway → сервис → Deployments → View logs; или MCP `get-logs` |
| Переменные | Railway → сервис → Variables (значения — не копировать в чаты/отчёты) |
| Алерты | Telegram-чат бота (`ALERT_TELEGRAM_*`) после деплоя `06d97e6a`; до него — только лог |
| Проверить канал | `pnpm --filter @tutak/api alert:verify` с production `ALERT_*` и `REDIS_URL` (локально у владельца) |
| Админка | `https://tutak-admin-production.up.railway.app` (SUPER_ADMIN) |

## 1. Деплой

- Источник: GitHub `main`, `checkSuites: true` — Railway ждёт зелёный CI (5
  обязательных проверок ruleset «Protect main»), потом собирает Dockerfile и
  переключает трафик после `/health/ready` = 200 (timeout 120 с).
- Миграции Prisma выполняются при старте контейнера (entrypoint) —
  **перед** тем, как новый инстанс пройдёт readiness. Миграции в репозитории
  только additive/expand (аудит 26.09: 76 миграций, один `DROP COLUMN
  settlementPeriod` с проверкой расхождений в S2); деструктивная миграция —
  решение владельца и отдельный план.
- Порядок релиза: PR → CI зелёный → merge (владелец) → Railway деплоит все
  три сервиса → проверить §3 «после деплоя».
- Откат: Railway → Deployments → предыдущий SUCCESS → Redeploy. Миграции
  назад не откатываются; код обязан работать со схемой n+1 (правило репо).

## 2. Конфигурация пилота (bonus-only, без реальных денег)

Переменные `tutak-api` (имена; значения у владельца):

| Переменная | Пилот | Смысл |
|---|---|---|
| `DEMO_MODE` | `false` | демо-сессии выключены |
| `TUTAK_PSP_ENABLED`, `PSP_REFUNDS_ENABLED`, `CARD_PAYMENTS_ENABLED`, `CUSTOMER_PREPAID_TOPUP_ENABLED` | **не задавать** (false) | реальные деньги выключены — единственный допустимый режим до Idram |
| `PAYOUT_DUAL_CONTROL` | не задавать (true) | двое на каждую выплату партнёру |
| `EMERGENCY_FREEZE` | не задавать (false) | §5 |
| `FRAUD_VELOCITY_WINDOW_MINUTES` / `FRAUD_VELOCITY_MAX_TRANSACTIONS` | 10 / 8 (по умолчанию) | велосити-правило; ужесточать — владелец |
| `ALERT_TELEGRAM_BOT_TOKEN`, `ALERT_TELEGRAM_CHAT_ID` | заданы | канал алертов (после `06d97e6a`) |
| `SENTRY_DSN` | **нет** — задать | ошибки |
| `METRICS_TOKEN` | нет | метрики (не блокер) |
| `CLIENT_IP_STRATEGY=xff-depth`, `CLIENT_IP_TRUSTED_HOPS` | заданы | лимиты по IP; hops измерить по `RAILWAY_PRODUCTION_RUNBOOK_RU.md` §9 |
| `SEED_BASELINE` | `true` пока роли меняются; затем `false` | сид ролей при старте |
| `SMS_DRIVER=viva`, `VIVA_*`, `SMS_GLOBAL_MAX_PER_HOUR/DAY` | заданы | OTP; бюджет SMS |
| `MEDIA_STORAGE_DRIVER=s3`, `MEDIA_STORAGE_S3_*`, `MEDIA_PUBLIC_BASE_URL` | заданы | медиа |
| `DATABASE_CONNECTION_LIMIT` | посчитать (`docs/DEPLOYMENT.md` §Database connections) | пул |

Пилотные партнёры: заводятся через админку (SUPER_ADMIN): партнёр → филиал →
банковский счёт (иначе settlement нельзя approve) → сотрудники (смены!) →
`settlementPeriodicity`. Смены обязательны с даты `shiftsRequiredFrom`
партнёра — кассир без открытой смены не подтвердит покупку.

## 3. Ежедневно / после деплоя

1. `/health/ready` = 200 на api.
2. Логи api за последние 15 минут: нет `ERROR` кроме ожидаемых алертов;
   есть строка `Alerts will be delivered by Telegram (production)` (после
   `06d97e6a`); **нет** `Neither ALERT_WEBHOOK_URL nor …`.
3. Нет `Request rate limiting is STOOD DOWN` (иначе IP не измерен).
4. Админка → Reconciliation: последний ночной прогон `CLEAN`; если
   `DRIFT_DETECTED` — §6.
5. Админка → Settlements: нет settlement в `REQUIRES_RECONCILIATION` старше суток.
6. Fraud signals: открытые сигналы разобраны (resolve) — это единственный
   способ вернуть клиенту удержанный платёж.

## 4. Настолько частые операции, что о них спрашивают

- **Выплатить партнёру.** Админка → Settlements → Draft за закрытый период →
  Ready (номер акта) → Approve (**другой** админ) → Paid (референс банка).
  Legacy «Payouts → Request» больше нет (26.09). Ошибка «no active bank
  account» — сначала счёт партнёра.
- **Выплата ушла, а потом спор клиента.** Ничего не отзывать: refund → долг
  партнёра в следующем периоде (`PARTNER_COMMERCE.md` §14). Revoke возможен
  только для APPROVED/FAILED без следов перевода.
- **Клиент «платёж удержан» (velocity).** Админка → Fraud signals → resolve;
  клиент повторяет платёж. Порог — `FRAUD_VELOCITY_*`.
- **Партнёр заблокирован по сверке.** §6.
- **Сброс пароля супер-админа.** `RAILWAY_PRODUCTION_RUNBOOK_RU.md` §8.3.
- **Смена мандатной даты смен партнёра.** Только вперёд (раньше), API
  `requireShiftsFrom` — SUPER_ADMIN.

## 5. Аварийные рычаги (от мягкого к жёсткому)

| Рычаг | Как | Эффект | Обратимость |
|---|---|---|---|
| Деактивировать партнёра | Админка → Partners → disable | его QR/начисления/EV стоп; данные целы | мгновенно, enable |
| Заблокировать выплаты партнёру | сверка ставит сама; вручную — `payoutsBlockedAt` через reconciliation API | settlement draft невозможен | `clearPayoutBlock` (PAYOUT_MANAGE) |
| Ужесточить антифрод | `FRAUD_VELOCITY_MAX_TRANSACTIONS=3` → restart | больше HOLD'ов | вернуть значение |
| Срезать SMS-бюджет | `SMS_GLOBAL_MAX_PER_HOUR=50` | OTP замедлится, атака на бюджет остановлена | вернуть |
| **Заморозить платформу** | `EMERGENCY_FREEZE=true` на `tutak-api` → Railway перезапустит (~1–2 мин) | все POST/PUT/PATCH/DELETE → 503 `PLATFORM_FROZEN`; чтение, `/auth`, `/health` работают; webhooks получают 503 и ретраятся отправителем | `EMERGENCY_FREEZE=false` |
| Остановить API полностью | Railway → tutak-api → Remove deployment / scale 0 | всё недоступно, включая чтение | Redeploy |

Во время freeze **ничего не чинить в базе руками** без бэкапа (§DR runbook) и
без второго человека.

## 6. Инциденты

**Сверка нашла расхождение (`reconciliation.drift`, партнёры заблокированы).**
Не «исправлять баланс»: сравнить ledger с выпиской (`GET /admin/ledger/accounts/:id/postings`),
найти источник (двойной платёж партнёра вне платформы? ошибка выписки?),
зафиксировать в FraudSignal, затем `clearPayoutBlock` (PAYOUT_MANAGE, SUPER_ADMIN).

**Dead-letter outbox / sweep failed (алерт).** Логи api по `outbox` /
`sweep`; повторный drain — сам sweep; если событие битое — решение владельца
(данные не удалять).

**Settlement `REQUIRES_RECONCILIATION`.** Двое: один предлагает исход
(`MONEY_MOVED` / `MONEY_DID_NOT_MOVE`) с доказательством из банка, второй
подтверждает; движок сам переведёт в PAID или FAILED.

**Массовые 5xx.** `/health/ready`: если storage/Redis/Postgres красный — это
инфраструктура (Railway status, том, лимит соединений — `DATABASE_CONNECTION_LIMIT`).
Если код — Redeploy предыдущего SUCCESS, затем разбор.

**Подозрение на компрометацию админа.** `EMERGENCY_FREEZE=true` → в БД
пометить сессии пользователя отозванными (`sessions`) → сменить пароль →
аудит `audit_logs` по `actorUserId` → снять freeze. Ротация JWT-секретов без
разлогина всех требует `JWT_ACCESS_SECRET_PREVIOUS` — отдельная процедура,
согласовать с владельцем.

## 7. Бэкапы и восстановление

Коротко: WAL-архив в бакет `Postgres-PITR` включён (`WAL_ARCHIVE_*` на
сервисе Postgres); восстановление на момент времени проведено 19.09.
Детально — `docs/DISASTER_RECOVERY_RUNBOOK.md`. Логический дамп для
переезда/экспорта — `scripts/backup.sh`, проверка — `scripts/restore.sh --verify`.

## 8. Что здесь НЕ решено (OWNER)

Перенос проекта на аккаунт владельца; Sentry; домен; регион (см.
`REGION_MIGRATION_PLAN.md`); удаление артефактов учения 19.09; политика
чёрного бонуса (`AI_RISK_ENGINE_DESIGN.md` §4); юридические тексты.
