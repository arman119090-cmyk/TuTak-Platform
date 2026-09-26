# TuTak — Launch Readiness Baseline (26.09.2026)

Ветка `claude/tutak-launch-readiness-20260926`, Draft PR #71. База — `e1754404`
(финальный отчёт закрытия расчётов с партнёрами; код расчётов `ced29089`,
CI 10/10). Этот документ — **инвентаризация состояния на момент начала**
launch-readiness работы: каждое ранее известное замечание получает статус,
каждое утверждение — источник. Что исправлено в этой ветке — помечено
FIXED со SHA. Что нельзя было проверить из этой среды — так и написано.

Статусы: **CURRENT** — проблема есть сейчас; **FIXED** — исправлено (со
ссылкой); **OBSOLETE** — больше не применимо; **NOT VERIFIED** — не удалось
проверить (и почему); **OWNER ACTION** — исправить может только владелец
(панель, аккаунт, договор, бизнес-решение).

Границы среды: исходящие HTTP к `*.up.railway.app` из этой среды блокирует
прокси (403 CONNECT) — живой production не опрашивался. Railway и Render
читались через MCP (значения переменных скрыты — видны только имена).
GitHub: rulesets и настройки репозитория читались; `collaborators`,
`actions/secrets`, `branches/main/protection`, `secret-scanning` — 403
(прокси/интеграция).

---

## 1. Деньги и инварианты (код)

| # | Замечание | Статус | Доказательство / где |
|---|---|---|---|
| 1.1 | Два независимых пути выплаты партнёру (`PayoutEngineService` + `PartnerSettlementService`) — одни начисления могли быть выплачены дважды | **FIXED** `0e633188` | Локальный scratch-тест до фикса: legacy payout 30 000 → settlement того же периода → `PARTNER_PAYABLE = −30 000`. После: `PayoutHistoryService` (только чтение), маршруты `POST /payouts`, `/:id/confirm`, `/:id/fail` удалены (404 для SUPER_ADMIN — `legacy-payout-retired.int-spec.ts`), `payout-history.int-spec.ts` (один дебет, один kind, «нельзя дважды») |
| 1.2 | Legacy-строки `payouts` со статусом `REQUESTED` в production, если есть, теперь нельзя завершить через API/UI | **NOT VERIFIED** (нет доступа к боевой БД) → **OWNER ACTION** | Проверить `SELECT count(*) FROM payouts WHERE status='REQUESTED'`. Если >0 — ручная процедура: `ledger.reverse(ledgerTransactionId)` + статус FAILED, через миграцию данных, не через UI. Будет в runbook |
| 1.3 | Движок расчётов не проверяет `partner.isActive` (legacy проверял) | CURRENT (наблюдение, не дефект) | `partner-settlement.service.ts` `createDraft` проверяет только `payoutsBlockedAt`. Деактивированный партнёр может получить то, что ему причитается — считаю корректным; фиксирую |
| 1.4 | Settlement: dispute после approve, revoke только по доказательству, resolve × markPaid гонка | **FIXED** (закрыто в PR #70, `ced29089`) | `docs/PARTNER_COMMERCE_DISPUTE_AFTER_APPROVE_V2_REPORT_2026-09-26.md`; 117/117 suites, 1580/1580 tests |
| 1.5 | Ledger balanced / balance = replay / нет отрицательных кошельков / partner debt ≤ paid | CURRENT-OK | `money-sequence-fuzz.int-spec.ts` (инварианты после каждого шага, 3 seeds; «paid» теперь = сумма PAID settlements), `partner-reconstruction.int-spec.ts` |
| 1.6 | Деньги (PSP) выключены в production: `TUTAK_PSP_ENABLED`, `PSP_REFUNDS_ENABLED`, `CUSTOMER_PREPAID_TOPUP_ENABLED`, `CARD_PAYMENTS_ENABLED` **отсутствуют** в переменных `tutak-api` | CURRENT-OK (и так должно быть до PSP) | Railway `list-variables tutak-api` 26.09; код: флаги по умолчанию `false` (`configuration.ts:771,782`) |
| 1.7 | Реальный эквайринг: адаптер Idram есть в коде, контракт/sandbox/ответы Idram — нет | **OWNER ACTION / BLOCKED_EXTERNAL** | `docs/IDRAM_ACTIVATION_READINESS_2026-09-19.md` §BLOCKED BY IDRAM (8 пунктов), READY FOR REAL MONEY: NO |

## 2. Наблюдаемость

| # | Замечание | Статус | Доказательство / где |
|---|---|---|---|
| 2.1 | Алерты о деньгах в production уходят **в консоль**: заданы `ALERT_TELEGRAM_BOT_TOKEN`/`ALERT_TELEGRAM_CHAT_ID`, но код читал только `ALERT_WEBHOOK_URL` (его нет) | **FIXED в коде** `06d97e6a`; **OWNER ACTION** — деплой + `alert:verify` | `grep -rn ALERT_TELEGRAM apps/api/src` до фикса — 0 совпадений. Теперь `TelegramAlertChannel`, `selectAlertChannel` (webhook → Telegram → console), 10 unit-тестов. Моя же ошибка в предыдущем отчёте: «Telegram-алерты настроены» — переменные были, канала не было |
| 2.2 | `SENTRY_DSN` не задан на `tutak-api`; `NEXT_PUBLIC_SENTRY_DSN` не задан на admin/partner (есть только `_ENVIRONMENT`) | CURRENT → **OWNER ACTION** | Railway `list-variables` всех трёх сервисов 26.09 |
| 2.3 | `METRICS_TOKEN` не задан → `/metrics` выключен, снимать метрики нечем | CURRENT → OWNER ACTION (низкий приоритет для pilot) | то же |
| 2.4 | `alert:verify` с production-переменными не прогонялся человеком | CURRENT → **OWNER ACTION** | нужен production env; из этой среды невозможно |
| 2.5 | Health `/health/ready` (Postgres, Redis, storage) — Railway healthcheck на нём, timeout 120 | CURRENT-OK | `get-service-config tutak-api`: `healthcheckPath: /health/ready` |

## 3. Инфраструктура и владение

| # | Замечание | Статус | Доказательство / где |
|---|---|---|---|
| 3.1 | **Railway-проект TuTak (production) принадлежит аккаунту разработчика** `styop0909` (workspace «styop0909's Projects»), не владельцу бизнеса | CURRENT → **OWNER ACTION P0** | Railway `whoami`, `describe-environment`. План передачи — `docs/INFRASTRUCTURE_OWNERSHIP.md` |
| 3.2 | Railway деплоит только после зелёного CI (`checkSuites: true`) — было `false` 13.09 | **FIXED** (панель, до этой ветки) | `get-service-config tutak-api: source.checkSuites: true` |
| 3.3 | Ветка по умолчанию GitHub = `main` (13.09 была `claude/tutak-loyalty-mvp-e485jm`) | **FIXED** | GitHub API `default_branch: main` |
| 3.4 | Защита `main`: ruleset «Protect main» — запрет удаления, запрет force-push, PR обязателен, 5 обязательных проверок (Lint/Integration 1-3/Build images) | **FIXED частично** | ruleset 23702809. Пробелы: `required_approving_review_count: 0`, `strict_required_status_checks_policy: false`, `bypass_actors: []` (хорошо). Рекомендация: 1 approval + strict — OWNER DECISION (один человек в команде → 1 approval блокирует самого владельца; альтернатива — оставить 0, но включить strict) |
| 3.5 | Репозиторий публичный; секретов в индексе нет | CURRENT (решение владельца) | GitHub API `visibility: public`; `git grep` по паттернам ключей — пусто (проверка 26.09) |
| 3.6 | Dependabot alerts выключены; secret scanning — статус недоступен (403) | CURRENT → OWNER ACTION (включить в Settings → Security) | GitHub API `dependabot/alerts` → «disabled for this repository» |
| 3.7 | `pnpm audit`: 30 уязвимостей (23 high, 7 moderate); все high — в сборочных зависимостях mobile (`image-size`, `@xmldom/xmldom` через `expo/metro`) и `js-yaml` (корень/admin, Swagger выключен в production); в API — только `qs` moderate | CURRENT (не блокер pilot) | локальный `pnpm audit --json` 26.09; CI шаг advisory-only |
| 3.8 | В production-окружении Railway живут артефакты учения по восстановлению 19.09: сервис `Postgres-restored-20260919-1733` (том 50 GB, оплачивается) и staged patch на удаление `verify-restore-20260919` | CURRENT → **OWNER DECISION** (staged patch помечен destructive; принимать — только владелец) | `get-staged-changes`: patch `42e7e9f5`, action delete; `describe-environment`: volume `postgres-restored` 50000 MB |
| 3.9 | Бэкапы боевой Postgres: WAL-архивирование в бакет `Postgres-PITR` настроено (`WAL_ARCHIVE_*`), восстановление на точку времени проведено 19.09 (`POSTGRES_RECOVERY_TARGET_TIME`) | **FIXED** (19.09) | `describe-service Postgres`: `WAL_ARCHIVE_BUCKET/ENDPOINT/...`; бакет `Postgres-PITR` (sjc). Расписание снапшотов тома — **NOT VERIFIED** (не видно через MCP) |
| 3.10 | Регион `sfo` (US West) при пользователях в Армении; кастомных доменов нет (`*.up.railway.app`) | CURRENT → OWNER DECISION | `describe-environment: regions: [sfo]`; латентность из этой среды измерить нельзя (сеть закрыта). План: `docs/REGION_MIGRATION_PLAN.md` |
| 3.11 | Render workspace «Arman's workspace»: 4 сервиса `tutak-staging-*` на ветке `claude/tutak-loyalty-mvp-e485jm` (последний коммит 19.09, autoDeploy для api/admin/partner), free-плани, **БД `tutak-staging-db` истекает 2026-09-29** | CURRENT → **OWNER DECISION**: удалить или перевести на `main` как staging | Render `list_services`, `list_postgres_instances` (`expiresAt: 2026-09-29T19:35:41Z`) |
| 3.12 | В том же Render workspace — 5 клиентских сайтов (`levani-art`, `elgo-site`, `little-joe-armenia-demo`, `hoviki-mebel`, `hoviki-mebel-demo`), деплоятся **из репозитория TuTak-Platform** с веток `claude/*` (`sites/…`, `little-joe-armenia/`, `apps/shop`) | CURRENT → **OWNER ACTION** (вынести в отдельные репозитории) | Render `list_services` (repo + branch + rootDir); на `main` этих директорий нет (`git ls-tree`) |
| 3.13 | Ветки: 65 remote-веток, из них ≥8 — чужие проекты | CURRENT | `git branch -r` |
| 3.14 | Viva SMS идёт через IPsec-шлюз на Contabo VPS (`infra/viva-gateway`) — владение VPS/ключом | NOT VERIFIED → OWNER (см. INFRASTRUCTURE_OWNERSHIP) | `docs/VIVA_TUNNEL_RUNBOOK_RU.md` |

## 4. Конфигурация production (`tutak-api`, имена переменных; значения скрыты)

| Переменная | Есть | Замечание |
|---|---|---|
| `DEMO_MODE` | да | значение **NOT VERIFIED**; 13.09 заявлено «демо-режим снят». Должно быть `false` |
| `SEED_BASELINE` | да | по коду сид идемпотентен; 13.09 оставлен включённым намеренно. Выключить после стабилизации ролей — OWNER |
| `SEED_ADMIN_PASSWORD` | да | пароль супер-админа — ротировать (`C3` от 10.09) — OWNER, NOT VERIFIED |
| `CLIENT_IP_STRATEGY`, `CLIENT_IP_TRUSTED_HOPS` | да | 13.09 отсутствовали → **FIXED** (панель); значение hops NOT VERIFIED |
| `CORS_ORIGINS` | да | значение NOT VERIFIED |
| `MEDIA_STORAGE_*` (S3, 6 переменных), `MEDIA_PUBLIC_BASE_URL` | да | A4 от 10.09 → **FIXED** |
| `PUSH_ENABLED`, `PUSH_ENDPOINT` | да | значение NOT VERIFIED; `PUSH_ACCESS_TOKEN` отсутствует |
| `SMS_DRIVER`, `VIVA_*`, `SMS_VIVA_*`, `SMS_GLOBAL_MAX_*` | да | Viva настроена; лимиты — значения NOT VERIFIED |
| `ALERT_TELEGRAM_BOT_TOKEN`, `ALERT_TELEGRAM_CHAT_ID` | да | до `06d97e6a` не читались кодом (см. 2.1) |
| `ALERT_WEBHOOK_URL`, `SENTRY_DSN`, `METRICS_TOKEN` | **нет** | см. §2 |
| `PAYOUT_DUAL_CONTROL` | нет | по умолчанию `true` (`configuration.ts:753`) — OK |
| `TUTAK_PSP_ENABLED`, `IDRAM_*`, `PSP_REFUNDS_ENABLED`, `CUSTOMER_PREPAID_TOPUP_ENABLED`, `CARD_PAYMENTS_ENABLED` | нет | деньги выключены — OK для bonus-only pilot |
| `DATABASE_CONNECTION_LIMIT` | нет | пул Prisma по умолчанию; `docs/DEPLOYMENT.md` требует расчёта — OWNER/L3 |
| `JWT_ACCESS_SECRET_PREVIOUS` | нет | ротация JWT без разлогина не подготовлена — не блокер pilot |

## 5. Замечания прошлых аудитов — сводка статусов

| Источник | Пункт | Статус 26.09 |
|---|---|---|
| LAUNCH_VERIFICATION 13.09 §1 | ключ карты MapTiler в GitHub secrets | NOT VERIFIED (secrets недоступны через прокси) → OWNER подтвердить |
| 13.09 §2 | лимит по IP выключен | FIXED (переменные есть), значение hops NOT VERIFIED |
| 13.09 §3 | Sentry не подключён | CURRENT |
| 13.09 §4 | бэкапов Railway нет | FIXED (WAL/PITR 19.09); снапшоты NOT VERIFIED |
| 13.09 §5 | default branch не `main` | FIXED |
| 13.09 §6 | нет защиты веток | FIXED частично (см. 3.4) |
| 13.09 §7 | Railway не ждёт CI | FIXED |
| 13.09 §8 | репозиторий публичный | CURRENT (решение) |
| 13.09 §9 | `ALERT_WEBHOOK_URL`, `METRICS_TOKEN` | CURRENT; алерты — FIXED через Telegram-канал после деплоя |
| 13.09 §10 | `SEED_BASELINE=true` | CURRENT (намеренно) |
| 10.09 A1 | боевого эквайринга нет | CURRENT → BLOCKED_EXTERNAL (Idram) |
| 10.09 A2 | admin/partner не на Railway | FIXED (оба сервиса live, `*.up.railway.app`) |
| 10.09 A3/A4 | `APP_ENV=production`, S3 | FIXED (переменные `APP_ENV`, `MEDIA_STORAGE_S3_*` есть) |
| 10.09 B2 | push выключен | NOT VERIFIED (переменные есть, значение скрыто) |
| 10.09 B4 | интеграционные тесты на живой БД не прогонялись | OBSOLETE — CI гоняет 117+ suites на реальном Postgres в 3 шардах |
| 10.09 C1 | `deploy/*` ветка | OBSOLETE — сервисы на `main` |
| 10.09 C4 | Render отключить | CURRENT → OWNER DECISION (3.11) |
| 19.09 IDRAM | BLOCKED BY ARMAN 1–5 (webhook, verify, письмо Idram, merge #57, Sentry) | #57 — merged (PR #57 в истории main); остальное CURRENT → OWNER |
| AUDIT_ROADMAP 10.09 P0-7 | CI timeout 25 + шарды | FIXED (`ci.yml`: 3 шарда, `timeout-minutes: 25`) |
| P0-10 | политика конфиденциальности/оферта у юриста | OWNER (черновики: `PRIVACY_POLICY_RU.md`, `PUBLIC_OFFER_RU.md`, `LEGAL_AGREEMENTS_DRAFT_RU.md`) |

## 6. Что этот документ НЕ утверждает

- Не утверждает, что production работает: живых запросов из среды нет.
- Не утверждает значений переменных Railway — только их наличие.
- Не утверждает состояния GitHub secrets/collaborators/2FA — API закрыт.
- Не проверял содержимое боевой БД (legacy `payouts`, `REQUESTED`).

## 7. Вопросы/решения владельцу из этого документа

1. Передача Railway-проекта на аккаунт владельца (3.1) — когда и как (см. INFRASTRUCTURE_OWNERSHIP §3).
2. Принять staged delete `verify-restore-20260919` и удалить `Postgres-restored-20260919-1733` (50 GB) (3.8)? Я не трогаю — destructive.
3. Render: удалить stale staging и перевести клиентские сайты в отдельные репозитории (3.11–3.12)?
4. Ruleset `main`: включить strict status checks; approvals 0 или 1 (3.4)?
5. `SETTLEMENT_MANAGE` у роли `ADMIN` (может участвовать в выплате партнёру как maker или checker) — оставить или только SUPER_ADMIN? Сейчас так засеяно (`role-permissions.ts:73`), тест `financial-authorization.int-spec.ts` фиксирует текущую политику.
6. Регион `sfo` → Европа (3.10)?
