# PR #54 — merge в main и post-merge проверка

Дата: 19.09.2026
Задание: merge PR #54 в main (verdict аудита — SAFE TO MERGE WITH MONEY
DISABLED); проверить, что объединённый main цел; доказать через реальные
API-маршруты, что деньги выключены; пройти существующий deployment
pipeline, не включая флаги и не проводя реальных платежей; отдельный
sanity-review на integration damage; финальный отчёт в формате MERGE /
MAIN CI / PRODUCTION / REGRESSIONS FOUND / MONEY STATUS / MANUAL ACTIONS /
NEXT GATE.

База: PR head `4c97555` на `main` = `7069614`; после merge — `main` =
`ef710f3` (merge commit, parents `7069614` + `4c97555`).

Одно замечание к заданию: пункт 4 (deployment) противоречил прежнему
ограничению «НЕ DEPLOY production». Принято так: у Railway стоит
auto-deploy каждого push в `main` без ожидания CI (`checkSuites: false`),
поэтому merge **и есть** deployment. Отдельного ручного деплоя не
делалось, флаги не трогались.

---

## MERGE

- **merged.** Метод — merge commit (не squash): 42 коммита ветки остаются
  достижимыми, отчёты ссылаются на их SHA.
- Новый `main`: **`ef710f3`**.
- Дерево merge-коммита байт-в-байт равно дереву PR head (`git diff` пуст),
  конфликтов не было, main не двигался с момента аудита (0 коммитов позади).
- Проверено перед merge: mergeable `clean`; CI на `4c97555` зелёный в обоих
  запусках (push и pull_request), все 5 job; все 42 коммита — из этой
  сессии, чужих нет; `pnpm-lock.yaml` и `migration_lock.toml` не менялись;
  13 миграций строго после последней миграции main
  (`20260913190000`); в `env.validation.ts` новые поля только
  `@IsOptional()` — production не требует новых переменных; три денежных
  флага читаются как `=== 'true'` и в Railway **отсутствуют**.

## MAIN CI

| Workflow | Результат |
|---|---|
| CI #783 (`ef710f3`) | зелёный, все 5 job: lint/typecheck/unit/migrations/mobile/admin/partner/build; три integration shard; образы API/Admin/Partner, boot стека с seed, Playwright E2E, прогон собранного мобильного приложения против стека, backup/restore rehearsal |
| Publish API image #18 (`ef710f3`) | зелёный |

Локально на `ef710f3`:

| Проверка | Результат |
|---|---|
| `pnpm lint`, `pnpm typecheck` | чисто |
| Unit (api) | 686 тестов, 49 suites |
| Integration (api), `connection_limit=5`, один процесс | 1463 тестов, 110 suites — все зелёные, 405 с (+ новый suite ниже: 6/6) |
| mobile | 530 тестов, 64 suites |
| admin / partner | 105 и 92 теста |
| `pnpm build`, `demo/` паритет, Sentry parity | чисто |
| Миграции на чистой БД + `migrate diff` | применены, «No difference detected» |
| Миграции как upgrade: схема `7069614` → 13 новых | все 13 применены по порядку, `migrate status` up to date, diff пуст |

Инцидент среды: во время первого локального прогона локальный Postgres
самопроизвольно перезапустился (лог: recovery, «database system is ready»
в 06:48:58), интеграционный прогон и репетиция миграций упали на
«not yet accepting connections». Это не код — оба перезапущены после
восстановления сервиса, результаты выше — из повторного прогона.

## PRODUCTION

- **deployed** — автоматически, Railway project «TuTak», environment
  `production`, все три сервиса с `ef710f3`:
  `tutak-api` (deployment `a8e3fbd1`, SUCCESS 06:48:02),
  `tutak-admin` (`917ad58d`, SUCCESS 06:47:10),
  `tutak-partner` (`a2efae32`, SUCCESS 06:47:04).
- Подтверждено по логам API: `71 migrations found`, применены все 13 новых
  миграций (06:47:56.649 → .849, ~200 мс), «All migrations have been
  successfully applied»; «15 recurring job(s) scheduled»; «Nest application
  successfully started»; healthcheck Railway — `/health/ready` (timeout
  120 с) пройден, иначе deployment не стал бы SUCCESS. Уровень error/warn
  после старта: пусто (единственные «error»-строки — предупреждение Prisma
  об устаревшем `package.json#prisma` на stderr).
- Admin и Partner: Next.js 16.3.5, «Ready».
- HTTP-трафик к API за последний час: **0 запросов** — проверить поведение
  под живыми запросами нечем; ошибок, соответственно, тоже нет.
- Feature flags в Railway (список имён переменных `tutak-api`):
  `TUTAK_PSP_ENABLED`, `PSP_REFUNDS_ENABLED`,
  `CUSTOMER_PREPAID_TOPUP_ENABLED` **отсутствуют** → `false`.
  `IDRAM_*` отсутствуют. `JWT_REFRESH_SECRET` задан — теперь необязателен,
  безвреден.
- Что **не** удалось проверить отсюда: прямой запрос к
  `https://tutak-api-production.up.railway.app/health/ready` — исходящий
  HTTPS из этой среды к Railway блокируется прокси (403). Обычная
  DIRECT-покупка, cashback, referral, read-path расчётов, Admin/Partner в
  браузере на production — **UNVERIFIED** (нет доступа к production API и
  к боевым учёткам; см. MANUAL ACTIONS).
- Sentry/alerts: DSN и `ALERT_WEBHOOK_URL` в Railway не заданы (их нет в
  списке переменных) — наблюдаемости на production по-прежнему нет.

## MONEY, THROUGH THE ROUTES

Добавлен `apps/api/test/money-disabled-routes.int-spec.ts` — реальные
HTTP-запросы с настоящим bearer-токеном, три переменные **удалены**,
креды Idram заданы намеренно:

| Маршрут | Ожидание | Результат |
|---|---|---|
| `POST /v1/purchase-intents` с `paymentRoute: TUTAK_PSP` (клиент) | 4xx, «not available», 0 строк | 4xx, 0 покупок |
| `POST /v1/psp/purchases/:id/begin` на застрявшей PSP-покупке (клиент) | 409, 0 попыток; `/status` отвечает 200 без SUCCEEDED | так |
| `POST /v1/psp/idram/callback` pre-check (`application/x-www-form-urlencoded`) для существующего счёта нашего мерчанта | тело `NO`, строка inbox `REJECTED` с причиной «disabled», 0 проводок | так |
| `POST /v1/balance/topup`, `GET /v1/balance/me` | 404 (контроллер не смонтирован) | 404 |
| `POST /v1/purchase-intents/:id/refund` на CONFIRMED PSP-покупке (владелец партнёра) | 400 «not available yet», 0 refund-строк, 0 проводок | так |
| DIRECT: `POST /v1/purchase-intents` → `POST /:id/confirm` (владелец) | 201 → 201, `CONFIRMED`, проводки есть, PSP-попыток нет | так |

Пробел, который это закрывает: `money-disabled-gate.int-spec.ts` проверял
сервисы, а не маршруты — контроллер, guard, DTO и форма отказа (4xx, а не
500) оставались недоказанными в production-состоянии.

Что **не** покрыто и осталось на сервисном уровне: положительный pre-check
при флаге ON и «доучёт» коллбэка после выключения (это race-тест в
`money-disabled-gate.int-spec.ts`, два экземпляра приложения; по HTTP он не
переписывался — нет причины).

## REGRESSIONS FOUND

**Новых дефектов кода после merge не найдено.**

Sanity-review на integration damage опирался на три независимых источника,
а не на чтение money engine заново:

1. CI #783 на `main`: Playwright E2E против собранного стека (регистрация,
   вход, Admin, Partner), прогон собранного мобильного приложения против
   стека, backup/restore rehearsal — зелёные.
2. Локальный полный интеграционный набор на `ef710f3`: 111 suites, в том
   числе auth (4), OTP (4), сессии (2), партнёры (21), QR (3), бонусы,
   рефералы (2), возвраты (9), EV (7), roaming (3), покупки (3), расчёты
   (5), PSP (8), бухгалтерия (2), health, sweeps, retention — 1463/1463.
3. Production-логи API после старта: 0 строк уровня error/warn, все
   маршруты старого контура смонтированы (`/auth`, `/purchase-intents`,
   `/qr`, `/ev`, `/roaming-cpo`, `/payouts`, `/admin/...`).

Что этот review **не** даёт: живого трафика на production за час не было
(0 запросов), так что поведение старого контура на боевой базе после 13
миграций подтверждено только миграционной репетицией «upgrade со схемы
`7069614`» и E2E на чистой базе, а не реальными пользователями.

Собственные ошибки по ходу:
- Первая версия нового теста создавала роль `PARTNER_OWNER` заново — роли
  сеются глобально и переживают `truncateAll`; 6/6 упали на unique. Заменено
  на `findUniqueOrThrow`.
- Параметр статуса покупки в helper'е был выведен как литерал, TS отверг
  сравнение с `CONFIRMED`; типизирован явно.
- Первый локальный прогон запущен параллельно с тяжёлой сборкой; Postgres
  среды перезапустился, прогон упал не по вине кода — потеряно ~10 минут.

## MONEY STATUS

- **CODE MERGED** — денежный контур в `main` и в production.
- **REAL MONEY DISABLED** — доказано через API-маршруты (выше) и через
  список переменных Railway.
- **IDRAM LIVE UNVERIFIED** — порядок checksum по выписке, не по письму;
  `EDP_TRANS_ID`, status-query, refund/reversal, retry policy, таймауты,
  sandbox/live E2E — внешние gates, ответов провайдера нет.

## MANUAL ACTIONS FOR ARMAN

Только то, что отсюда недоступно (нет выхода в production API и боевых
учёток).

**M-1. Готовность API (30 секунд)**
1. Открыть `https://tutak-api-production.up.railway.app/health/ready`.
2. Ничего не нажимать.
3. Должен быть ответ 200 с JSON, где база и Redis — `up`.
4. Прислать скриншот или текст ответа.

**M-2. Обычная покупка у кассы (3 минуты)**
1. Мобильное приложение (клиент) + Partner-кабинет (кассир) на production.
2. Создать покупку у любого партнёра, подтвердить кассиром.
3. Покупка `CONFIRMED`, у клиента появился кешбэк, реферер (если есть)
   получил своё.
4. Прислать скриншот покупки в приложении и строки в Partner-кабинете.

**M-3. Отсутствие PSP в интерфейсах (1 минута)**
1. Мобильное приложение, экран оплаты покупки.
2. Посмотреть, есть ли кнопка «оплатить в TuTak / через провайдера».
3. Её быть не должно (маршрут выключен); только обычная оплата у кассы.
4. Прислать скриншот экрана оплаты.

**M-4. Admin и Partner после merge (2 минуты)**
1. Admin → Settlements и Accounting; Partner → Settlements.
2. Открыть каждый раздел.
3. Страницы открываются, списки пустые или с данными, без ошибок.
4. Прислать три скриншота.

**M-5. Размер таблицы (30 секунд, тот же вопрос, что в E-1 аудита)**
1. Railway → Postgres → Query.
2. `SELECT count(*) FROM purchase_intents;` и
   `SELECT count(*) FROM psp_callback_inbox;`
3. Два числа; второе должно быть 0.
4. Прислать оба.

**M-6. Follow-up PR с regression-тестом**
1. GitHub → Pull requests → PR из ветки `claude/railway-connector-check-wy0ffq`.
2. Дождаться зелёного CI, нажать Merge (merge commit).
3. Railway задеплоит `main` автоматически; ничего больше не менять.
4. Ничего присылать не нужно.

## NEXT GATE

**Письменный ответ Idram по контракту** — прежде всего подтверждение состава
и порядка полей `EDP_CHECKSUM`, затем уникальность `EDP_TRANS_ID`,
наличие/отсутствие refund и status-query, retry policy и таймауты.

Почему именно это, а не что-то внутри платформы: код денежного контура в
production и выключен; всё, что можно доказать тестами, доказано. Единственное,
что отделяет `TUTAK_PSP_ENABLED=true` от безопасного включения — знание о
провайдере, которого в репозитории нет и которое нельзя вывести из кода.
Без письма любой sandbox-прогон — угадывание. Параллельно (не блокирует
письмо, но блокирует включение): Sentry DSN и `ALERT_WEBHOOK_URL` в
Railway — сейчас на production нет ни одного канала, по которому дохлый
коллбэк в inbox дойдёт до человека.
