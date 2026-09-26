# TuTak — Launch Readiness: финальный отчёт (26.09.2026)

## 0. Задание

«TUTAK — FULL LAUNCH READINESS IMPLEMENTATION» (45 разделов): довести
платформу до **READY FOR CONTROLLED BONUS-ONLY PILOT**; подготовить публичный
запуск; описать архитектуру и блокеры для REAL MONEY (BLOCKED_EXTERNAL без
PSP); подготовить фазу антифрода/AI risk engine и пилот топлива. Принцип:
проверить → найти → **исправить** → тесты → перепроверить → задокументировать.
STOP-список (merge, production deploy, удаление production-ресурсов,
destructive DB, регион, владение/биллинг, ротация секретов с даунтаймом,
активация PSP, договор Idram, сплит 20/30/30/20, политика чёрного бонуса,
пороги антифрода, юридика, реальные партнёры/топливо) — только владелец.
Запрет: merge, deploy, force-push, фейковые тесты, изменение
Render/Railway production, печать секретов.

## A. SHA

| Что | SHA |
|---|---|
| База (финальный отчёт закрытия расчётов, PR #70) | `e17544042ef0bf2852e289cfe94a7a5d0e73cdc6` |
| Код расчётов (CLOSED) | `ced29089a9e5ff08661742f7260fb39059947099` |
| L1 — legacy payout retired | `0e6331880b1e78a84fbf30a820d189ef019d2859` |
| CI-fix L1 (тест авторизации, seed café bank account) | `33e9cc10` |
| Telegram alert channel | `06d97e6a5df8f5951b68717aea04931bad51d99c` |
| Baseline + ownership docs | `ce1fe8de16b2edc858a9cd429a77d4f0c94e788f` |
| Emergency freeze, fraud thresholds, e2e/load-test | `adb30a8fdebbab0c66cd199fe5301d1b48c5b1f5` |
| AGENTS.md, AI review, runbooks, region plan, risk design | `d2b09911` |
| e2e route prefix fix | `f1880574` |
| Пилотный антифрод (reward hold), CodeQL, pre-deploy/staging/legal docs | `7f53969a` |
| AI review: JSON-схема, retries, weekly audit | `5c729ab6` |
| **FINAL code SHA** (последнее изменение `apps/api`) | `7f53969a` |
| Финальный отчёт | коммит этого отчёта — head PR #71 на момент публикации |

## A1. Три состояния (§3)

| Состояние | SHA | Источник |
|---|---|---|
| MAIN | `369eda19` (#57 «Оповещения…», 19.09) | `git log origin/main` |
| LAUNCH CANDIDATE | `7f53969a` + docs `5c729ab6`/коммит этого отчёта — head PR #71 на момент публикации | эта ветка |
| PRODUCTION | `369eda19` — деплой `f94d56eb` 19.09 07:30 UTC, SUCCESS, все три сервиса с `main` | Railway `list-deployments tutak-api` (`meta.commitHash`) |

Production = main; launch candidate впереди main на весь Partner Commerce +
settlement + эта ветка (59+ файлов). Ничего из этой ветки в production нет.
| Ветка / PR | `claude/tutak-launch-readiness-20260926` / Draft PR #71 (не merge) |

## B. Что сделано (по разделам задания)

| § | Направление | Результат |
|---|---|---|
| 4–6 | Финансовые инварианты, конкурентность | **P1 найден и исправлен**: второй путь выплаты партнёру (`PayoutEngineService`) удалён; один платильщик — `PartnerSettlementService`. Инварианты: fuzz после каждого шага (3 seeds), reconstruction, concurrency-probe 15, settlement race (resolve × markPaid, два draft'а), load-test 11/11 money-path инвариантов на 411 покупках |
| 7 | Безопасность / tenant / IDOR | Существующее покрытие: idor-sweep 9, authorization 17, tenant-isolation 13, adversarial 17, referral-abuse 13, session-security 13. Проверены 9 контроллеров без route-level guard — все с `assertPartnerScope`/`assertBranchScope` или `user.id`; IDOR не найден. `financial-authorization` переписан: 12 денежных шагов settlement → `SETTLEMENT_MANAGE`; legacy-маршруты отсутствуют (404, e2e) |
| 8 | Миграции БД | 76 миграций; CI: полная история на чистой БД + `migrate diff` drift check каждый прогон; один `DROP COLUMN settlementPeriod` (S2, с проверкой расхождений); learning: 19.09 PITR-восстановление боевой БД. Аудит «main-era/непустая БД»: seed-baseline + seed-demo + 5 прогонов load-test на одной БД — миграции и инварианты держатся |
| 9–10 | Владение, Railway | `docs/INFRASTRUCTURE_OWNERSHIP.md`: **P0 — production в workspace разработчика**; staged destructive patch и 50 GB артефакт учения — owner decision |
| 11 | Регион | `docs/REGION_MIGRATION_PLAN.md` (owner decision; латентность не измерена — сеть закрыта) |
| 12 | Staging | Render `tutak-staging-*` stale (ветка 19.09, БД истекает 29.09) — owner decision в baseline §3.11 |
| 13–14 | Репозиторий, GitHub | 5 клиентских сайтов деплоятся из веток TuTak — план разделения (`INFRASTRUCTURE_OWNERSHIP.md` §5); ruleset: рекомендация strict + approvals (§6) |
| 15 | AGENTS.md | написан, согласован с CLAUDE.md |
| 16/19/20 | Kimi + DeepSeek | workflow + скрипт (`5c729ab6`): независимые вызовы, JSON-схема findings (severity/category/file/line/finding/evidence/suggestedFix/confidence), retries, лимиты, артефакты, weekly full-audit 13 денежных модулей; без ключей — **BLOCKED_BY_API_KEY** комментарием в PR (не «чисто»). Baseline-аудит не проведён (`docs/AI_BASELINE_AUDIT.md`). Первый прогон job на PR #71 — 12 с, BLOCKED |
| 17–20 | Mobile, checkout, partner, admin | CI на каждом SHA: Mobile tests, Admin/Partner dashboard tests, Web Checkout tests — зелёные; admin Payouts экран переведён в read-only (8/8); e2e против собранного стека (Playwright) — см. E/CI. Проверка на устройстве — UNVERIFIED |
| 21 | SMS/OTP | Viva настроена (имена переменных), бюджет SMS есть; лимит по IP — hops NOT VERIFIED |
| 22 | Платежи / Idram | BLOCKED_EXTERNAL (`IDRAM_ACTIVATION_READINESS_2026-09-19.md`); флаги денег отсутствуют в production — OK для пилота |
| 23/27 | Антифрод пилота | **Реализовано** (`7f53969a`): velocity партнёра/филиала/сотрудника, high-value, «новый аккаунт» на подтверждении покупки — награда клиента удерживается PENDING на `FRAUD_REWARD_HOLD_HOURS`, продажа проходит, FraudSignal + AuditLog, resolve снимает удержание; все пороги — env (`FRAUD_*`, 0 = выкл.), умолчания широкие — owner. Существующее: customer velocity (QR/EV, теперь настраиваемо), one-live-purchase, self-referral, слоты рефералов, SMS-бюджет, IP-лимиты. Тест `fraud-pilot-controls.int-spec.ts` (4) |
| 24 | AI risk engine | дизайн (offline scoring, никогда не двигает деньги), не включён |
| 25 | Чёрный/отложенный бонус | конфликт документа (6 мес × 15 000/мес) и кода (3 мес × 54 000 суммарно) зафиксирован — **OWNER BUSINESS DECISION** |
| 26 | Нагрузка | `load-test.ts` починен (смены, филиалы, инвариант лотов) и прогнан: capture 118.7 ok/s p95 138 ms; idempotent replay 650 ok/s; contended drafts: 1 из 1044 (правильно); purchase confirm p95 ~0.7–1.7 с при 8 воркерах на одном партнёре (контеншн на одном мерчанте — ожидаемо) |
| 27 | Наблюдаемость | **P1 найден и исправлен**: Telegram-переменные не читались → канал добавлен; Sentry/metrics — owner |
| 28 | Бэкап/восстановление | `docs/DISASTER_RECOVERY_RUNBOOK.md`; WAL/PITR подтверждены учением 19.09; **restore drill 26.09 локально пройден** (`backup.sh` → `restore.sh --verify`, леджер сходится), дефект `backup.sh` исправлен; снапшоты тома и копия медиа — NOT VERIFIED/gap |
| 29–30 | Runbooks, аварийные рычаги | `docs/PRODUCTION_RUNBOOK.md`; **EmergencyFreezeGuard** (`EMERGENCY_FREEZE=true` → 503 на записи) — новый рычаг, unit+e2e |
| 31 | Pilot config | `PRODUCTION_RUNBOOK.md` §2 |
| 32 | E2E | `tests/e2e/money-movement.e2e.ts` переписан на settlement-поток |
| 33/37 | Deployment safety | Railway `checkSuites: true`, ruleset 5 checks; `docs/PRE_DEPLOY_CHECKLIST.md`; откат — runbook §1; CodeQL workflow добавлен (advisory) |
| 14 | Staging | `docs/STAGING_PLAN.md`: Render stale → предложение Railway environment `staging` (owner, стоимость) |
| 38 | Внешние/юридические блокеры по этапам | `docs/EXTERNAL_LEGAL_BLOCKERS.md` |
| 9 | Секреты | скан истории git (с 01.06) по паттернам ключей (AWS, PEM, Stripe, GitHub, Slack, Telegram-бот, Google) — 0 совпадений; `.env` файлов в истории нет |
| 7 | Карта гонок | покрыты тестами: employee deactivate × confirm, shift close × confirm, duplicate QR, two confirms, received × cancel, received × refund, stock × out-of-stock, sourcing claim × partner, dispute resolve × payout (8r), open dispute × settlement (8b), two drafts, two markPaid, retry × retry, two workers × one posting, referral accrual × withholding, PSP duplicate callbacks; **не покрыты отдельным тестом:** completion × return (есть received × refund), return × return (идемпотентность есть), markPaymentPending × dispute (тот же guard, что markPaid — покрыт 8c), reconciliation × payment — UNVERIFIED |
| 34 | Legal | черновики есть (`PUBLIC_OFFER_RU.md`, `PRIVACY_POLICY_RU.md`, `LEGAL_AGREEMENTS_DRAFT_RU.md`, `PERSONAL_DATA_INVENTORY_RU.md`) — юрист, owner |
| 35 | Docs = code | `FINANCIAL_CORE_DESIGN.md`, `PARTNER_COMMERCE.md` §14, `DEPLOYMENT.md` §5a обновлены |
| 36–39 | Тесты, мутации, self-audit | см. C |

## C. Чем доказано

### Локально (последовательно, одна тестовая PostgreSQL)

| Проверка | Результат |
|---|---|
| `typecheck` (build + spec), `eslint` изменённых файлов, admin typecheck/lint | чисто |
| API unit (финальный код) | **55/55 suites, 719/719 tests** |
| Затронутые integration после L1 | 13/13 suites, 120/120 |
| alerting + production-boot после Telegram | 2/2, 17/17 |
| financial-authorization после CI-fix | 15/15 |
| emergency-freeze (e2e через реальные guard'ы) + partner-state-and-fraud | 2/2, 10/10 |
| seed-baseline + seed-demo на чистой БД | end-to-end, `partnerSettlements: 1`, ledger TOTAL 0.0000 |
| load-test (8 воркеров × 3 с, 10 клиентов) | exit 0; 411 подтверждённых покупок; ledger sum 0.0000; 11/11 инвариантов |
| admin Payouts page | 8/8 |
| Restore drill (§15): `scripts/backup.sh` (дамп 2.4 MB, 84 таблицы) → `scripts/restore.sh --verify` на изолированной БД | ✓ восстановлено, 12 accounts sum 0, каждый account = replay postings; 2190 payments, 12 485 postings, 132 wallets; scratch-БД удалена |
| Найденный при drill дефект `backup.sh` (ложное «not a TuTak database» из-за SIGPIPE под `pipefail`) | исправлен ``576c6d45``, повторный backup exit 0 |
| **Полный integration-прогон на финальном коде** | **120/120 suites, 1578/1578 tests**, 1007.8 с, один процесс jest на одной тестовой PostgreSQL, SHA `7f53969a`, 19:23–19:40 UTC (`npx jest --selectProjects integration`) |

### Mutation-проверки

| Мутация | Ожидание | Результат |
|---|---|---|
| m1: `partner.settlement.paid` сделан settleable | «нельзя дважды» падает | **не пойман** — эквивалентный мутант для этого теста (net уходит в минус, draft всё равно отказан); честно фиксирую |
| m2: снят фильтр `settlementEntry: null` в `unsettled()` | «нельзя дважды» падает | **пойман** (1 failed) |
| Telegram: `ok:false` при HTTP 200 | not delivered | unit-тест (пойман бы регресс) |
| Freeze: `/v1/authority` (похоже на auth) | 503 | unit-тест |

### CI (GitHub Actions, ruleset «Protect main» — 5 обязательных проверок)

| SHA | Результат |
|---|---|
| `0e633188` | ❌ Integration 2/3 (financial-authorization читал удалённые методы), Build images (seed-demo без bank account) → исправлено `33e9cc10` |
| `ce1fe8de` | ❌ Build images: e2e Playwright `POST /payouts` 404 → e2e переписан `adb30a8f` |
| `adb30a8f` | ❌ Build images: e2e — неверный префикс `/partner-settlements` → `f1880574`; остальные job зелёные |
| `f1880574` | ✅ push-run 36264896679 — 5/5 GREEN (PR-run отменён следующим push) |
| **`7f53969a` (FINAL code)** | ✅ **10/10 GREEN**: push-run 36265901710 (5/5) + PR-run 36265903774 (5/5): Lint/test/build, Integration 1–3, Build images (E2E Playwright на собранном стеке, мобильное приложение против стека, backup/restore rehearsal). Плюс advisory job «Kimi + DeepSeek review» — BLOCKED_BY_API_KEY |

## D. Блокеры и статусы (матрица готовности, §41)

| Область | Статус | Что блокирует / кто |
|---|---|---|
| Деньги партнёров (settlement) | ✅ READY | — (один платильщик, maker/checker, dispute rules, тесты) |
| Бонусная экономика (QR, EV, рефералы) | ✅ READY для bonus-only | политика чёрного бонуса — расхождение док/код (owner) |
| Реальные деньги (PSP/Idram) | ⛔ BLOCKED_EXTERNAL | договор/ответы Idram, sandbox; флаги выключены — правильно |
| Наблюдаемость | 🟡 после деплоя `06d97e6a` + `alert:verify` владельцем | Sentry DSN, METRICS_TOKEN — owner |
| Инфраструктура / владение | ⛔ **P0 OWNER** | Railway у разработчика; артефакты учения; Render stale |
| Безопасность / доступ | 🟡 | ruleset без strict/approvals; Dependabot/secret scanning выкл.; 2FA NOT VERIFIED |
| Резервное копирование | 🟡 | WAL/PITR ✅ (19.09); снапшоты тома, копия медиа, внешний дамп — NOT VERIFIED/gap |
| Аварийные рычаги | ✅ | EMERGENCY_FREEZE, деактивация партнёра, блок выплат, лимиты — код + runbook |
| Мобильное приложение | 🟡 | CI-тесты зелёные; проверка на устройстве (PHONE_CHECKLIST) — owner |
| Юридика | ⛔ OWNER | черновики → юрист → публикация |
| Антифрод пилота | ✅ минимум реализован / 🟡 пороги | коммерческие пороги — owner decision |
| Регион | 🟡 | sfo; план миграции — owner decision |

## E. OWNER ACTIONS (в порядке важности)

1. **P0.** Перенести Railway-проект в свой workspace (или как минимум получить
   Admin) — `INFRASTRUCTURE_OWNERSHIP.md` §3. Пока не сделано, потеря доступа
   разработчика = потеря production.
2. Задеплоить `main` после merge этой ветки (merge — ваше решение): Telegram-канал
   заработает на существующих переменных; прогнать `alert:verify` и прислать
   скриншот сообщения.
3. Решить: удалить `Postgres-restored-20260919-1733` (50 GB) и принять staged
   delete `verify-restore-20260919`; Render `tutak-staging-*` (БД истекает 29.09)
   — удалить или на `main`; клиентские сайты — в отдельные репозитории.
4. `SENTRY_DSN` на api/admin/partner; включить Dependabot alerts + secret
   scanning; ruleset `main`: strict checks (+1 approval, когда появится второй человек).
5. Решения по политике: `SETTLEMENT_MANAGE` у ADMIN (сейчас да, maker/checker);
   чёрный бонус — документ vs код; пороги антифрода (§2 дизайна).
6. Домен (до любой миграции региона/аккаунта); регион EU — по плану.
7. Ключи `KIMI_API_KEY`, `DEEPSEEK_API_KEY` в GitHub Secrets — тогда AI-ревью
   начнёт работать на PR.
8. Проверить в боевой БД: `SELECT count(*) FROM payouts WHERE status='REQUESTED'`
   (legacy-хвосты); заполнить контакты/доступы в DR runbook §4.
9. Юрист: оферта, политика, договор партнёра.

## F. Что НЕ сделано / собственные ошибки

- **Не сделано:** живая проверка production (сеть закрыта); измерение
  латентности; полный baseline-аудит второй моделью (нет ключей); дневной
  потолок начислений и другие новые правила антифрода (пороги — owner);
  внешний дамп боевой БД; e2e на телефоне; ротация JWT с `_PREVIOUS`
  (процедура описана, не реализована как скрипт).
- **Ошибка 1:** после L1 я прогнала «затронутые» сьюты по grep legacy-методов и
  пропустила `financial-authorization.int-spec.ts` (метаданные удалённых
  методов) и e2e Playwright (`POST /payouts`); CI поймал — два лишних цикла.
- **Ошибка 2:** в промежуточном отчёте по settlement я написала
  «Telegram-алерты настроены» по наличию переменных, не проверив код. Канала
  не было. Исправлено кодом и признано здесь.
- **Ошибка 3:** в комментариях seed-demo и в правке docs я утверждала, что
  `SETTLEMENT_MANAGE` не выдаётся ADMIN — это было неверно (выдаётся);
  исправлено, политика зафиксирована тестом и вынесена владельцу.
- **Ошибка 4:** e2e для settlement я написала с неверным префиксом маршрута
  (`/partner-settlements` вместо `/admin/partner-settlements`) — CI поймал.
- **Ошибка 5:** первая мутация (m1) оказалась эквивалентной — не доказывает
  того, что я хотела; оставлена в отчёте как есть.
- **Ошибка 6:** запустила полный integration-прогон и параллельно правила
  исходники (ts-jest компилирует на лету) — 6 «падений» оказались моими
  TS-ошибками на полпути; прогон остановлен и перезапущен на зафиксированном
  SHA. Также один раз убила не тот процесс (`pkill` по паттерну), и осиротевший
  jest-воркер продолжил бегать на той же БД — отсюда deadlock'и в первых
  сьютах. Оба прогона в отчёт не идут; учтено — код не трогать во время прогона.
- Мои `console.log` — только в скриптах (`alert-verify`, `ai-review`), не в API.

## G. UNVERIFIED (прямым списком)

1. Значения production-переменных (DEMO_MODE, SEED_BASELINE, PUSH_ENABLED,
   CLIENT_IP_TRUSTED_HOPS, лимиты SMS) — видны только имена.
2. Расписание снапшотов тома Postgres в Railway; возраст базового бэкапа для PITR.
3. Копия бакета `tutak-media`.
4. GitHub: secrets (MapTiler, Expo), collaborators, 2FA, secret scanning.
5. Латентность Ереван ↔ sfo.
6. Legacy `payouts` со статусом REQUESTED в боевой БД.
7. Работа Telegram-канала в production (нужен деплой + `alert:verify`).
8. Владельцы Expo/Viva/Contabo/Telegram-бота.
9. Поведение мобильного приложения на устройстве.
10. Kimi/DeepSeek ревью — не выполнялось.

## H. Вердикт (§42)

**READY FOR CONTROLLED BONUS-ONLY PILOT: NO — при двух открытых P0/P1 вне кода.**
Код пилота готов (деньги выключены, один платильщик, freeze, алерты в коде),
но: (P0) production принадлежит не владельцу; (P1) до деплоя и `alert:verify`
никто не получает алерты. Как только владелец закроет E.1 и E.2 (и подтвердит
`alert:verify`), вердикт по коду — READY FOR CONTROLLED BONUS-ONLY PILOT с
ограничениями: партнёры без реальных денег, пороги антифрода по умолчанию,
ежедневный чек-лист runbook §3.

**PUBLIC LAUNCH: NOT READY** — Sentry, домен, юридика, ruleset, регион, DR-дыры (внешний дамп, медиа).

**REAL MONEY: BLOCKED_EXTERNAL** — Idram.
