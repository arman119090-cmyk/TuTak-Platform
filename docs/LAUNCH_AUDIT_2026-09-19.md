# TuTak — полный независимый аудит перед реальным запуском

Дата: 19.09.2026
Задание: максимально глубокий аудит всего TuTak в текущем состоянии;
источник истины — код, `main`, открытые PR, GitHub Actions, Railway
production, фактические конфигурации; главный вопрос — что конкретно
отделяет TuTak от безопасного полноценного запуска; найденные дефекты, в
которых уверен, исправлять с regression-тестами; не включать реальные
деньги, не проводить платежей, не публиковать секреты, не трогать
production-данные.

База: `main` = `98da0a4` на старте; в ходе аудита влиты #57 (`369eda1`);
ветка аудита `claude/railway-connector-check-wy0ffq` (от `369eda1`).

Правило, по которому написан документ: не доказать, что готово, а
попытаться доказать, что не готово. Там, где доказать «не готово» не
удалось, стоит READY — с основанием, а не с пожеланием.

---

## 1. EXECUTIVE VERDICT

| Область | Вердикт | Основание |
|---|---|---|
| BACKEND | **READY WITH CONDITIONS** | 1471 интеграционных + 691 unit тестов зелёные на пуле 5; глобальные guard'ы (throttle → JWT → roles → permissions → password-rotation); `ValidationPipe` whitelist+forbidNonWhitelisted; ни одного `$queryRawUnsafe`; 16 DB-триггеров и CHECK/UNIQUE-инварианты денег; 60 одновременных покупок подтверждаются ровно один раз за 0,7 с. Условия: нет автоматического backup (§14), production никогда не видел живого трафика. |
| MOBILE | **UNVERIFIED** | Код и 530 тестов зелёные; но ни одна сборка из текущего `main` не запускалась на физическом Android/iPhone; последний production-APK (#57) собран из ветки PR #52, а не из `main`; Android-дефект потери фокуса исправлен в коде (`collapsable={false}`), на устройстве **не подтверждён**; iOS-сборки не было никогда. Сборка APK из `main` запущена этим аудитом (см. §7). |
| ADMIN | **READY WITH CONDITIONS** | 17 разделов, 105 тестов, Playwright E2E против собранного стека в каждом CI; maker/checker на расчётах и PSP-реконсиляции. Условие: одиночный админ с `PAYMENT_REFUND` может вернуть деньги один (§3, D-7). |
| PARTNER | **READY** | Изоляция партнёров и веток проверена 17 негативными интеграционными тестами (403 на чужие purchases/settlements/QR); cashier/owner/manager разведены в коде и guard'ах; заявка → одобрение → ветка → кассир → QR → покупка → расчёт → выписка проходит E2E. |
| LOYALTY / REFERRALS | **READY** | Начисление внутри транзакции подтверждения (один claim `updateMany`), self-referral — no-op, `ReferralInvite.refereeUserId` уникален, вклад в челлендж уникален по `transactionId`, экономика заморожена триггером после одобрения продавцом, возврат откатывает бонусы и реферальные, FIFO/резервации покрыты тестами; нагрузочный тест: 10 рефереров получили ровно по 10 наград при 60 параллельных покупках. |
| SETTLEMENT | **READY WITH CONDITIONS** | Maker/checker двумя разными запросами, CHECK-констрейнты, `updateMany`-claim на каждом переходе, выгрузки дебет=кредит. Условие: реальные банковские переводы — ручные, процесс и человек не назначены (§16). |
| EV | **NOT READY** (для реальной зарядки) | Реального внешнего CPO нет: `OCPI_BASE_URL`/`OCPI_TOKEN` в production отсутствуют → `NoopOcpiAdapter`; `HttpOcpiAdapter` существует, но ни разу не работал с настоящим оператором; roaming-CPO входящий API защищён ключами, но ни одного реального CPO не подключено. Код и тесты (7 EV + 3 roaming suites) — READY как код. |
| IDRAM | **NOT READY** (реальные деньги) / READY как код с выключенным флагом | Контракт по выписке, не по подтверждению Idram; ни одного реального/sandbox-платежа; `TUTAK_PSP_ENABLED` отсутствует; boot-guard'ы (креды, https, webhook) и HTTP-доказательство выключенности есть. Пакет вопросов — `docs/IDRAM_PROVIDER_CONFIRMATION.md`. |
| BOT | **NOT READY** | Railway «TuTak Bot» / «TuTak tg Bot»: **offline**, активных деплоев нет, последние деплои 05.08.2026 — два FAILED, три REMOVED; источник — чужой репозиторий `Styop0909/sb-loyalty-bot` (не в этом монорепо, не в CI, переменные `BOT_TOKEN`, `DATABASE_URL`, `OCPI_TOKEN_A_NEW` — старого продукта). **BOT PRODUCTION READY: NO.** |
| SECURITY | **READY WITH CONDITIONS** | argon2, JWT 15 мин + opaque refresh 30 д с ротацией и `httpOnly`/`secure` cookie для панелей, helmet, CORS по списку, OTP-лимиты по телефону и IP, локаут, маскирование телефона в логах, Sentry-санитайзер с parity-тестом, секретов в git-истории не найдено (0 совпадений по паттернам, `.env` не коммитились). Условия: `pnpm audit` — 23 high/7 moderate, но все в мобильном toolchain (expo/metro/jest), в runtime API только `qs` moderate; `DEMO_MODE` присутствует в production-переменных (значение по отчёту 13.09 — `false`; удалить). |
| INFRASTRUCTURE | **READY WITH CONDITIONS** | Все сервисы online, API 100 МБ из 8 ГБ, CPU ~0; миграции применяются на старте; healthcheck `/health/ready`. Условия: **Railway деплоит `main` не дожидаясь CI** (`checkSuites: false`) — плохой merge попадает в production раньше, чем CI его увидит; один реплик, без HA; restart policy была ON_FAILURE×3 — **исправлено на ALWAYS** этим аудитом. |
| OBSERVABILITY | **NOT READY** | Цепочка в коде полная (dead-letter → alert, ageing, sweep.failed, drift, heartbeat; с #57 «delivered» = 2xx получателя), но в production **нет ни `ALERT_WEBHOOK_URL`, ни `SENTRY_DSN`, ни `METRICS_TOKEN`**: ERROR DETECTED — да; ALERT CREATED — да; ALERT DELIVERED — **нет** (console); HUMAN RECEIVED — **нет**. |
| BACKUP / DR | **NOT READY** | Скрипты `backup.sh`/`restore.sh`/`pitr-basebackup.sh` есть и репетируются в CI, но **ни одного автоматического backup production нет**: нет cron-сервиса, нет scheduled workflow, Railway-бэкапы тома не подтверждены. Postgres — один узел, том 5 ГБ. Если БД исчезнет сейчас — теряем всё, что не в git. |
| LEGAL / BUSINESS | **NOT READY** | `apps/api/public/legal/privacy.html` и оферта содержат `[OPERATOR]`, `[ADDRESS]`, `[CONTACT EMAIL]` (в privacy.html — 15 плейсхолдеров), помечены «не проверено юристом»; приложение ссылается на `https://tutak.am/privacy` — работает ли домен, отсюда не проверить; iOS никогда не собирался; процессов для спорных покупок/возвратов/зависших PSP нет ни runbook, ни назначенных людей. |

---

## 2. LAUNCH BLOCKERS

**P0 — запускать нельзя (с реальными пользователями и деньгами):**

1. **Нет автоматического backup production-БД** (§14). Одна ошибка
   миграции, один сбой тома — и данные клиентов, партнёров, ledger
   потеряны безвозвратно. Restore-скрипты есть, бэкапить нечего.
2. **Никто не узнает об ошибке** (§13): `ALERT_WEBHOOK_URL` и
   `SENTRY_DSN` не заданы. Любой dead-letter, drift, упавший sweep — строка в
   консоли контейнера. Для DIRECT-контура без денег провайдера это P0
   по эксплуатации, а не по деньгам; для Idram — boot-guard уже не даст
   включиться без webhook.
3. **Юридические документы с плейсхолдерами и без юриста** (§17) — для
   публичного запуска и для магазинов приложений.

**P1 — до полноценного публичного запуска:**

4. Railway auto-deploy без ожидания CI (`checkSuites: false`) — §12.
5. Мобильное приложение не проверено на физических устройствах из
   текущего `main`; Android-фокус не подтверждён; iOS-сборки нет — §5.
6. PR #52 (биометрия) конфликтует с `main` (4 файла i18n/demo) и содержит
   мобильные изменения, которых нет в `main`; решить: влить с
   разрешением конфликтов или закрыть.
7. Ручные банковские переводы партнёрам, спорные покупки, возвраты,
   потерянные телефоны — нет владельца процесса и runbook — §16.
8. `DEMO_MODE` удалить из production-переменных (сейчас, по отчёту
   13.09, `false`; переменная, которая при `true` включает sandbox-PSP
   и demo-login, не должна существовать в production вовсе).

**P2 — можно после ограниченного запуска:**

9. Одиночный админ с `PAYMENT_REFUND` возвращает деньги один (D-7).
10. `DATABASE_CONNECTION_LIMIT` не задан явно (пул по числу CPU
    контейнера); при одном реплике безопасно, при масштабировании — §15.
11. `METRICS_TOKEN` не задан → `/metrics` выключен; мониторинга
    `tutak_ledger_imbalance_amd` нет.
12. 16 устаревших веток (август–сентябрь), стоит удалить, чтобы
    «потерянные изменения» не искались в них снова (§1).
13. EV: реальный CPO — отдельный проект, не блокер запуска лояльности.

---

## 3. DEFECTS FOUND

| # | Severity | Модуль | Сценарий | Root cause | Доказательство | Исправлено | Regression test |
|---|---|---|---|---|---|---|---|
| D-1 | **P0 (ops)** | Railway `tutak-api` deploy policy | Транзиентный сбой Postgres/Redis на старте → `prisma migrate deploy` падает → контейнер перезапускается 3 раза и **остаётся лежать** до ручного redeploy | `restartPolicyMaxRetries: 3` с ON_FAILURE | `describe-service`: `restartPolicyMaxRetries: 3`, тип не ALWAYS | **Да**: `update-service` → `restartPolicyType: ALWAYS` (применится на следующем деплое; деплой `369eda1` шёл в этот момент — проверить в Railway, что политика ALWAYS) | инфраструктурное, теста нет |
| D-2 | **P0 (ops)** | Backup | Потеря тома Postgres = потеря всех данных | Нет ни одного автоматического backup; `backup.sh` запускается только руками и в CI на тестовой базе | Railway: нет cron-сервиса; workflows без `schedule:`; Postgres без подтверждённых volume-backups | **Нет** — требует решения владельца (Railway backup или внешний cron с `backup.sh` + шифрование) | — |
| D-3 | **P0 (ops)** | Observability | Dead-letter/drift/sweep.failed никуда не доставляются | `ALERT_WEBHOOK_URL`, `SENTRY_DSN` отсутствуют в production | список переменных `tutak-api` | **Код — да** (#57: verify не лжёт, PSP не стартует без webhook); **значения — нет** (Arman) | `webhook-alert.channel.spec.ts`, `alert-verify.spec.ts`, `env.validation.spec.ts` |
| D-4 | P1 | Railway source policy | Плохой merge деплоится до CI | `checkSuites: false` на всех трёх сервисах | `describe-service` | **Нет** — MCP не меняет source-настройки; действие для Arman (§7) | — |
| D-5 | P1 | Repo | PR #55 устарел и вводил в заблуждение (та же правка уже в main) | целевая ветка влита в #54 | CI #757/#758 красный на устаревшей базе | **Да** — закрыт с комментарием | — |
| D-6 | P1 | Repo / mobile | PR #52 (биометрия) конфликтует с main; мобильные изменения живут только в ветке | ветка от `d9d3f02`, 48 коммитов позади | `git merge-tree`: конфликты в 4 файлах i18n/demo | **Нет** — решение владельца (нужна ли биометрия в первом релизе) | — |
| D-7 | P2 | Refunds | Скомпрометированный/ошибающийся админ с `PAYMENT_REFUND` делает возврат один; refund-request path требует второго человека (`requestedByUserId === approverUserId` → отказ), а прямой admin-refund — нет | дизайн: два пути возврата с разной строгостью | `refunds.controller.ts` (только permission + throttle 20/мин); `purchase-intent-refund-request.service.ts:517` | **Нет** — предложение: лимит суммы для одиночного admin-refund или обязательный второй человек | — |
| D-8 | P2 | Legal | Плейсхолдеры в опубликованной политике | не заполнены реквизиты | `apps/api/public/legal/privacy.html`: `[CONTACT EMAIL]`×11, `[OPERATOR]`×2, `[ADDRESS]`×2 | **Нет** — данные компании и юрист | — |
| D-9 | P2 | Perf | Нет воспроизводимого нагрузочного теста DIRECT-контура на пуле 5 (k6 в среде нет; `load-test.ts` — для legacy card engine) | — | добавлен `launch-load.int-spec.ts` | **Да** | сам тест: 60 покупок/20 партнёров/10 рефералов, 50 OTP |

Что искали и **не нашли** (adversarial pass, §19): двойное начисление
(claim + accrual в одной транзакции; outbox-обработчики идемпотентны по
`transactionId`), двойной referral (unique invite, unique contribution,
награда в транзакции подтверждения), двойное подтверждение (`updateMany`
по статусу, E2E «confirming twice does not double-credit»), оплата меньше
(`maxBonusPaymentPercent` cap, `ordinaryPaymentRemainder`), партнёру
больше (contribution-rule заморожен триггером, `updateMany`-claim
расчётов), потеря между PSP и ledger (durable inbox, FOR UPDATE claim,
доучёт при выключенном флаге), необеспеченный баланс
(`wallets_balances_non_negative` CHECK, ledger sum = 0 после 60
параллельных расчётов), обход maker/checker (CHECK-констрейнты на
разных актёров, два запроса), двойной refund (idempotency key + FOR
UPDATE + `refundedAmount`), cashback после refund
(`reverseLoyaltyEffectsV2`), debit ≠ credit (aggregate = 0 во всех
suites), IDOR (все `:id`-маршруты проходят `assertPartnerScope` /
`assertBranchScope` / `CurrentUser`), mass assignment (whitelist +
forbidNonWhitelisted), SQLi (нет raw-unsafe), replay/подделка коллбэка
(checksum + мерчант + сумма + bill), two devices (refresh per `deviceId`,
single-flight с epoch в мобильном клиенте), Redis outage (alerts «sending
anyway», sweeps re-upsert heartbeat'ом), Postgres outage (readiness 503 +
теперь restart ALWAYS), старый клиент (только аддитивные DTO, `/v1`).

---

## 4. FIXED DURING AUDIT

| SHA / где | Что |
|---|---|
| `369eda1` (`main`, merge #57) | Alerting: «delivered» = 2xx получателя; `alert:verify` не сертифицирует мёртвый канал; `TUTAK_PSP_ENABLED=true` требует `ALERT_WEBHOOK_URL`; пакет Idram и sandbox-план |
| `98da0a4` (`main`, merge #56) | HTTP-доказательство выключенных денег (`money-disabled-routes.int-spec.ts`) |
| `623d93c` (ветка, PR ниже) | `launch-load.int-spec.ts` — нагрузка первого дня на пуле 5 |
| Railway `tutak-api` | `restartPolicyType: ALWAYS` (было ON_FAILURE, 3 попытки) |
| GitHub | PR #55 закрыт как устаревший, с объяснением |
| GitHub Actions | Запущена сборка production-APK **из `main`** (`android-apk.yml`, builder local, API production) — первая сборка из текущего main; ссылка на релиз появится в Actions → Android APK |

---

## 5. UNVERIFIED

- Живой production под запросами: трафика 0 за сутки; из этой среды
  боевой API недоступен (прокси 403). `/health` → `demoMode` не прочитан.
- Значение `DEMO_MODE` в Railway (OAuth отдаёт только имена; по отчёту
  13.09 — `false`).
- Railway volume backups для Postgres (в API не видно).
- Android-фокус на реальном Samsung/Xiaomi после `collapsable={false}`.
- iOS вообще (ни одной сборки).
- Домен `tutak.am` и опубликованная политика по ссылке из приложения.
- Idram: всё из §1–§8 `IDRAM_PROVIDER_CONFIRMATION.md`.
- Реальный CPO для EV.
- Telegram-бот: код вне репозитория; что он делал и с какой БД — не видно.
- Поведение под 1000+ пользователей: проверено 60 одновременных покупок
  и 50 OTP на пуле 5; k6-сценарии в `load/` не запускались (бинарника
  нет).

---

## 6. PRODUCTION REALITY

**Реально работает в production (по деплою, логам, конфигурации):**
API `369eda1` online, миграции применены (71), 15 recurring jobs
запланированы, SMS-транспорт `budgeted:viva` (настоящий Viva), push
включён, S3-хранилище медиа, Admin и Partner online. Обычная касса
(DIRECT), бонусы, рефералы, QR ветки, расчёты партнёров (черновик →
одобрение вторым человеком → отметка оплаты вручную), возвраты,
бухгалтерские выгрузки — код в production и покрыт E2E на стеке.

**Только проходит тесты, в production не работает или выключено:**
Idram (флаг отсутствует), PSP refunds, prepaid top-up (модуль не
смонтирован), EV через настоящий CPO (Noop-адаптер), Telegram-бот
(offline, чужой репо), алерты (console), Sentry (выкл.), metrics (выкл.),
backups (только руками).

**Никогда не наблюдалось живьём:** ни одного реального клиента, кассира,
покупки на production.

---

## 7. MANUAL ACTIONS FOR ARMAN

**A-1. Backup production Postgres (P0).**
Railway → project TuTak → Postgres → вкладка **Backups** → включить
ежедневные бэкапы тома (если доступно на плане) → должно появиться
расписание и первый snapshot → прислать скриншот вкладки. Если вкладки
нет: сказать об этом — тогда нужен внешний cron с `scripts/backup.sh` и
`BACKUP_AGE_RECIPIENT`, и я подготовлю его.

**A-2. Канал оповещений (P0).**
Slack/Mattermost/Discord → создать Incoming Webhook в канал, который
читают ночью → Railway → tutak-api → Variables → `ALERT_WEBHOOK_URL` =
URL → сервис перезапустится → локально с тем же `ALERT_WEBHOOK_URL` и
`REDIS_URL` выполнить `pnpm --filter @tutak/api alert:verify` → в
консоли «accepted … webhook answered 200», в канале «TuTak alert channel
test» → прислать скриншот сообщения в канале.

**A-3. Sentry (P1).** sentry.io → проект → DSN → Railway → tutak-api →
`SENTRY_DSN` → `pnpm --filter @tutak/api sentry:verify` → событие в
Sentry → прислать ссылку на событие.

**A-4. Railway: ждать CI перед деплоем (P1).**
Railway → tutak-api → Settings → Source → включить **«Wait for CI» /
Check Suites** → повторить для tutak-admin и tutak-partner → следующий
merge в `main` деплоится только после зелёного CI → прислать скриншот
настройки любого из трёх.

**A-5. Restart policy (проверка моей правки).** Railway → tutak-api →
Settings → Deploy → Restart Policy должно быть **Always** → если ещё
«On failure / 3» — нажать Redeploy → прислать скриншот.

**A-6. Удалить `DEMO_MODE` из production.** Railway → tutak-api →
Variables → `DEMO_MODE` → удалить → после перезапуска открыть
`https://tutak-api-production.up.railway.app/health` → в ответе
`"demoMode": false` → прислать текст ответа.

**A-7. APK из `main` на реальные телефоны (P1).** GitHub → Actions →
«Android APK» → дождаться запущенного мной run → Releases → скачать
APK → установить на Samsung и Xiaomi → регистрация → OTP → вход с
паролем (два поля) → второе поле принимает фокус, клавиатура не
закрывается → покупка у тестового партнёра → прислать: модель
телефона, версия Android, короткое видео ввода на экране входа, скриншот
подтверждённой покупки.

**A-8. Юрист (P0 для публичного запуска).** Передать
`docs/PRIVACY_POLICY_RU.md`, `docs/PUBLIC_OFFER_RU.md`,
`docs/PARTNER_TERMS.md`, `apps/api/public/legal/privacy.html` армянскому юристу с
вопросами из §17 → получить правки и реквизиты → заменить `[OPERATOR]`,
`[ADDRESS]`, `[CONTACT EMAIL]` → прислать финальные тексты; я вставлю их
и опубликую.

**A-9. Решение по PR #52 (биометрия).** GitHub → PR #52 → решить: нужна
в первом релизе или нет → если да, скажите — разрешу конфликты и доведу
до CI; если нет — закрыть.

**A-10. Idram.** Отправить письмо из §2 `docs/IDRAM_PROVIDER_CONFIRMATION.md`
→ прислать ответ как есть.

**A-11. Telegram-бот.** Решить, нужен ли бот в запуске. Если да —
дать доступ к репозиторию `Styop0909/sb-loyalty-bot` (или перенести код в
монорепо), тогда аудит бота возможен; если нет — удалить сервис в Railway,
чтобы не путал.

**A-12. Смержить PR с нагрузочным тестом и этим отчётом** (номер — в
чате) после зелёного CI.

---

## 8. EXTERNAL BLOCKERS

- **Idram:** подтверждение контракта (checksum, `EDP_TRANS_ID`, pre-check,
  retry policy, status-query, refund, сроки), sandbox-креды.
- **CPO (EV):** ни одного реального оператора; договор и OCPI-endpoint.
- **Apple:** Apple Developer аккаунт, подписанная сборка, TestFlight;
  для App Store — Privacy Policy URL, account deletion (есть в
  приложении), permission strings (есть: камера, геолокация).
- **Google:** Play Console, Data safety form, Privacy Policy URL,
  политика account deletion (есть), target SDK по требованиям 2026 —
  проверить при первой загрузке.
- **Юридические:** реквизиты оператора, политика конфиденциальности,
  оферта, партнёрский договор, условия лояльности/рефералов, условия
  возвратов, платёжные раскрытия — все требуют армянского юриста.
- **Банк:** реальные переводы партнёрам — ручной процесс, реквизиты
  партнёров (`partner_bank_accounts` есть в схеме), кто платит.
- **Viva (SMS):** работает, но лимиты бюджета (`SMS_GLOBAL_MAX_*`) и
  договор — проверить перед волной регистраций.

---

## 9. WHAT IS MISSING FOR LAUNCH

Не включает уже выполненное.

- [ ] Автоматический ежедневный backup production Postgres + одна
      настоящая репетиция restore с production-дампа.
- [ ] `ALERT_WEBHOOK_URL` задан, `alert:verify` подтверждён человеком.
- [ ] `SENTRY_DSN` задан, `sentry:verify` пройден.
- [ ] Railway «Wait for CI» на трёх сервисах.
- [ ] `DEMO_MODE` удалён из production; `/health` показывает `false`.
- [ ] Restart policy ALWAYS подтверждена в UI.
- [ ] APK из `main` проверен на Samsung и Xiaomi: регистрация, OTP, вход
      с двумя полями, покупка, история, выход, повторный вход.
- [ ] Решение по PR #52; ветка либо влита, либо закрыта.
- [ ] iOS: аккаунт, подписанная сборка, TestFlight-прогон того же пути.
- [ ] Юридические тексты без плейсхолдеров, проверенные юристом,
      опубликованные по адресу, на который ссылается приложение.
- [ ] Runbook и владелец для: спорной покупки, возврата, зависшей
      PSP-оплаты (когда включат), потерянного телефона/смены номера,
      жалобы на начисление, банковского перевода партнёру.
- [ ] Два разных человека с `PSP_RECONCILE` и два с
      `CONTRIBUTION_RULE_APPROVE`.
- [ ] `METRICS_TOKEN` и внешний монитор на `tutak_ledger_imbalance_amd`.
- [ ] `DATABASE_CONNECTION_LIMIT` рассчитан и задан до второго реплика.
- [ ] Удалить 16 устаревших веток.
- [ ] Для денег через Idram — весь `IDRAM_PROVIDER_CONFIRMATION.md` §3.
- [ ] Для EV — реальный CPO.
- [ ] Для бота — код в репозитории или закрытие сервиса.

---

## 10. NEXT 5 ACTIONS

1. Включить backup production Postgres (A-1) и прогнать один restore из
   него на отдельную базу.
2. Задать `ALERT_WEBHOOK_URL` и подтвердить `alert:verify` человеком
   (A-2); затем `SENTRY_DSN` (A-3).
3. Включить «Wait for CI» в Railway на трёх сервисах и удалить
   `DEMO_MODE` (A-4, A-6).
4. Установить APK из `main` на Samsung и Xiaomi и пройти путь
   регистрация → покупка → выход → вход (A-7); закрыть вопрос
   Android-фокуса фактом, а не документом.
5. Отдать юридические документы юристу и отправить письмо Idram
   (A-8, A-10) — самые долгие внешние gates, запускать параллельно с 1–4.

---

## 11. FINAL ANSWER

**Если завтра придут первые 100 реальных пользователей — что сломается
или приведёт к потере денег/данных?**

Денег внутри платформы — ничего из найденного: DIRECT-контур, бонусы,
рефералы и расчёты выдерживают параллельность и держат ledger в нуле;
провайдерских денег нет вообще. Что сломается:

1. Если что-то упадёт — **никто не узнает**: алерты уходят в консоль, Sentry
   выключен. Первый dead-letter или drift будет обнаружен клиентом.
2. Если упадёт том Postgres — **потеряем всех 100 пользователей, их
   бонусы и все проводки**, восстанавливать не из чего.
3. Если у половины из них Samsung/Xiaomi и дефект фокуса не исправлен на
   практике — **они не смогут войти**; это не доказано ни в ту, ни в другую
   сторону.
4. Если 100 пользователей приходят с iPhone — приложения для них нет.
5. Если кто-то попросит возврат, потеряет телефон или оспорит покупку —
   процедуры нет, будет импровизация.

**Что мешает запустить TuTak сегодня?**

Не код. Внутри платформы критических дефектов не осталось — я их искал
специально и нашёл только эксплуатационные (restart policy — исправлено;
deploy-до-CI — действие для Arman). Мешают четыре вещи, все вне кода:
(1) нет backup, (2) нет доставки алертов человеку, (3) мобильное
приложение из `main` не проверено на настоящих телефонах и не существует
для iOS, (4) юридические тексты не готовы. Первые две закрываются за час
в Railway, третья — за день с двумя телефонами, четвёртая — юристом.
После этого TuTak можно запускать **ограниченно** (кассы, бонусы,
рефералы, без денег провайдера и без EV); Idram, EV и бот — отдельные
проекты со своими внешними gates.

---

## Чем доказано и что не сделано

**Прогоны (локально, `main` `369eda1` + тест нагрузки):** lint,
typecheck, build — чисто; unit 691/50; integration 1469/111 (полный
набор ветки #57) + `launch-load` 2/2 (create 60: 227 мс, confirm 60: 704
мс, otp 50: 68 мс, 0 отказов, ledger = 0). CI main #791 на `369eda1` — на
момент записи шёл (lint/unit/mobile/admin/partner уже зелёные; итог — на
странице Actions).

**Собственные ошибки по ходу:** первая версия нагрузочного теста
обращалась к несуществующей модели `authOtp` (правильно —
`authOtpToken`); Railway `update-service` не умеет менять source-политику
(`checkSuites`) — пришлось оставить это действием для Arman вместо
исправления; попытка прочитать значение `DEMO_MODE` через API невозможна
(только имена).

**Не сделано:** реальные проверки на устройствах и production API (нет
доступа); аудит бота (код вне репозитория); k6 (нет бинарника);
удаление устаревших веток (не удалял чужие ветки без решения владельца).
