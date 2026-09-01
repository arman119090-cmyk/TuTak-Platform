# Production readiness — аудит и результаты

Дата: 2026-09-01. Ветка `claude/tutak-loyalty-mvp-e485jm`.
База: `6fe89b4` (CI run 33543390698, зелёный).
Итог этой работы: **`7b85f76`**.

Production не деплоился. Продуктовая логика не менялась.

---

## A. Подтверждённые launch blockers

Только то, что найдено в коде и конфигурации репозитория.

### A1. Админ-дашборд запрещал себе собственный API — HIGH — **исправлено**

**Файлы:** `apps/admin/next.config.ts:23` (до правки), `apps/admin/Dockerfile:29`,
`render.yaml:101`.

**Причина.** `headers()` брал `NEXT_PUBLIC_API_BASE_URL` напрямую с откатом на
localhost. Значение вычисляется **один раз при сборке**, внутри стадии `build`
Dockerfile. На Render эта переменная — **runtime**-значение (`sync: false` в
`render.yaml`) и до сборки не доходит: в образ попадал `ARG` по умолчанию,
`http://localhost:4000/v1`. Отданная политика поэтому называла
`http://localhost:4000` — адрес, недостижимый из браузера на хосте Render, —
тогда как `httpClient.ts` правильно определял staging-API по hostname страницы.
Любой запрос дашборда отклонялся его же политикой.

Это тот же дефект, что был у партнёрского дашборда (исправлен в `ff3f047`), но
в зеркальную сторону.

**Проверка.** Production-сборка админки без единой заданной переменной — ровно
случай Render:

```
до:    connect-src 'self' http://localhost:4000
после: connect-src 'self' https://tutak-staging-api.onrender.com
```

**Исправление.** Разрешение адреса вынесено в `apps/admin/api-base-url.mjs`,
которым пользуются обе половины; `ARG` по умолчанию пуст («не задано» означает
не задано); CI явно передаёт build-arg с адресом того стека, который он сам и
поднимает. Регрессионный тест `apps/admin/api-base-url.test.mjs` запускается в
существующем шаге CI `Partner/Admin dashboard tests`.

### A2. `sentry-verify` отказывался работать на staging — MEDIUM — **исправлено**

**Файл:** `apps/api/src/scripts/sentry-verify.ts:38` (до правки).

**Причина.** Проба отказывалась при `NODE_ENV=production`. С коммита `5d86ff8`
`NODE_ENV=production` стоит во **всех** развёрнутых окружениях (это то, что
переводит фреймворки и охранники на production-путь), а метка окружения живёт в
`APP_ENV`. В результате единственное окружение, где оператор и должен доказать,
что события доходят до Sentry, — staging — пробу запустить не могло.
`apps/admin` этот переезд уже сделал; API отстал.

**Исправление.** Гейт читает `APP_ENV` и разрешает по имени:
`development`, `staging`, `test`. Всё остальное, включая незаданное значение,
отказ. +3 unit-теста.

### A3. Что искали и не нашли

Проверено на текущем HEAD, дефектов не обнаружено:

- **Куки.** `httpOnly` всегда; `secure` вне development; `SameSite` по умолчанию
  `strict`, значение из конфигурации, неизвестное значение откатывается к
  `strict`; `path=/v1/auth`; отдельная защита `assertTrustedCookieOrigin`,
  которая не зависит от SameSite (`apps/api/src/modules/auth/refresh-cookie.ts`).
- **CORS.** Публичное развёртывание **отказывается стартовать** без
  `CORS_ORIGINS` (`main.ts:83`). Отражение произвольного origin невозможно.
- **Swagger.** Выключен в публичных развёртываниях (`main.ts:165`).
- **JWT-секреты.** В production отказ при плейсхолдере, при низкой энтропии и
  при совпадении access- и refresh-секрета (`config/env.validation.ts`).
- **Клиентские суммы.** `grossAmount` предлагает покупатель, но операция не
  существует, пока её не подтвердит персонал партнёра
  (`POST /purchase-intents/:id/confirm`, под `assertPartnerScope`). Клиентская
  сумма сама по себе никогда не авторитетна.
- **Транзакции на денежных путях.** `$transaction` во всех двенадцати денежных
  сервисах; `Serializable` с ретраями там, где две операции могут гоняться за
  одним остатком (`bonus-engine`, `deferred-bonus-lot`, `roaming-cpo-settlement`).
- **Идемпотентность, гонки, откаты, округление, IDOR, branch-scoping, RBAC.**
  Покрыты отдельными наборами, которые выполняются в CI и прошли целиком:
  `idempotency`, `concurrency-probe`, `crash-recovery`, `money-rounding`,
  `money-sequence-fuzz`, `minting-ceiling`, `adversarial-probe`, `idor-sweep`,
  `partner-tenant-isolation`, `financial-authorization`,
  `branch-scope-read-isolation`, `payout-engine`, `partner-reconstruction`,
  `production-boot`, `error-disclosure`, `id-validation`, `distributed-lock`.
  **1075 интеграционных тестов, 79 наборов — все зелёные.**

Честная оговорка: по разделу 5 я **выполнил** эти состязательные наборы и
проверил перечисленные выше инварианты точечно; я не переписывал построчный
аудит всех денежных путей заново — он был сделан ранее (см. `docs/AUDIT_*`,
`docs/HARDENING_*`) и его результат зафиксирован именно этими тестами.

---

## A′. Что показало живое staging (не код — среда)

Render-сервисы читались только на чтение. Ниже — факты из работающего
`tutak-staging-api` на HEAD `172a1c7` (деплой `dep-dabhn9uq1p3s739ph0eg`,
статус `live`).

### A′1. Ночная сверка не выполняется — HIGH — **не исправлено (инфраструктура)**

```
[critical] Background job 'reconciliation.nightly' has stopped running —
It last completed 2630 minute(s) ago, and its tolerance is 1560 minute(s).
(job=reconciliation.nightly silentMinutes=2630 toleranceMinutes=1560 everRan=true)
```

Сорок четыре часа молчания при допуске в двадцать шесть. Причина не в коде:
план сервиса **free**, такой инстанс засыпает без входящего трафика, а вместе с
ним не работает планировщик — то есть не идут ни settlement, ни промоушен
бонусов, ни экспирация, ни сверка. Механизм слежения при этом сработал ровно
так, как задуман: он сам это и обнаружил.

**Что нужно:** always-on инстанс (платный план) для сервиса, который держит
sweeps. Это блокирует production.

### A′2. Критический алерт никто не получил — HIGH — **не исправлено (конфигурация)**

`ALERT_WEBHOOK_URL` не задан ни в `render.yaml`, ни в дашборде, поэтому алерт
выше ушёл **только в лог**. Код это разрешает намеренно (боот не падает, пишется
предупреждение), но для production «деньги под угрозой» обязано доходить до
человека.

### A′3. Bootstrap-сид выполняется при каждом рестарте — MEDIUM

```
18:39:22  SEED_BASELINE=true — seeding permissions, roles and the super admin
18:39:26  Baseline seed complete. Disable SEED_BASELINE after the first successful login…
```

`SEED_BASELINE=true` зафиксирован в `render.yaml:56`, поэтому временный
супер-админ пересоздаётся на каждом деплое. Для staging это осознанный
компромисс; в production переменная должна быть `false` сразу после первого
входа и ротации пароля.

### A′4. Медиа лежат на локальном диске развёрнутого сервиса — MEDIUM

```
[warn] Using the local-disk media driver at /repo/apps/api/.media-storage.
Development only — this is not durable and is not shared between replicas.
```

На Render это эфемерный диск: файлы исчезают при каждом деплое, а в БД остаются
`MediaAsset`, указывающие в никуда. `MediaModule` отказывается стартовать на
не-`s3` только при `APP_ENV=production`, поэтому staging сюда попадает
законно — но production обязан задать S3.

### A′5. Лимиты OTP по IP сейчас отключены — MEDIUM

```
[warn] Neither CLIENT_IP_STRATEGY nor TRUST_PROXY is set. req.ip will be the
direct TCP peer … Per-IP OTP limits are disabled in that state …
```

Ровно то поведение, которое заложено (лучше отключить лимит, чем свести всех
пользователей в одно ведро за балансировщиком), и предупреждение честное. Но
это значит, что один из контролей OTP на живом сервисе **выключен**, пока не
измерено число хопов.

### A′6. Free-Postgres истекает 2026-09-29 — INFO

`tutak-staging-db`: план `free`, PostgreSQL 18, `connectionPool: none`,
`highAvailability: false`, `expiresAt: 2026-09-29`. База со сроком годности не
может быть основанием для production-решения.

---

## B. Остаточные риски (не блокируют старт)

1. **Связь CSP и runtime-переменной остаётся косвенной.** `connect-src`
   фиксируется при сборке, `NEXT_PUBLIC_API_BASE_URL` на Render — при запуске.
   Сейчас они сходятся, потому что оба указывают на staging-API. Если оператор
   задаст runtime-переменную на другой хост, политика останется прежней и
   запросы будут отклонены. Правильное решение — передавать адрес API как
   build-arg на Render (или собирать образ под окружение).
2. **`decode-uri-component` (moderate, GHSA-vcc3-ghjq-m6fr)** остаётся: см. раздел D.
3. **`image-size` (2 × high)** остаётся: исправленной версии не существует.
4. **Суточного лимита OTP на телефон нет** — только часовой.
5. **`verify-phone/request` и `password-reset/request`** не имеют часового
   лимита по IP; их покрывает глобальный бюджет SMS.
6. **Свежесть Prisma:** предупреждение `package.json#prisma` deprecated, удалят
   в Prisma 7 — миграция на `prisma.config.ts` до обновления мажора.
7. **Разделение staging/production не существует.** В аккаунте Render есть
   только `tutak-staging-*`. Production-окружения нет ни одного, поэтому его
   переменные никем не проверены (раздел C).

---

## C. Production ENV checklist

«Известно» = значение подтверждено из репозитория или из живого Render.
Секретные значения не публикуются.

| Переменная | Где используется | Обязательна | Значение известно | Рекомендация |
|---|---|---|---|---|
| `NODE_ENV` | всё; production-путь фреймворков | да | да | `production` во **всех** развёртываниях |
| `APP_ENV` | `config/app-environment.ts`; выбор контролей | да | да | `production` только для production |
| `DATABASE_URL` | Prisma | да | нет (production) | из управляемой БД, не free-плана |
| `DATABASE_CONNECTION_LIMIT` | `infrastructure/prisma/database-url.ts` | нет | нет | см. раздел «Пул соединений» |
| `DATABASE_POOL_TIMEOUT` | там же | нет | нет | 10–20 с; ставить вместе с лимитом |
| `REDIS_URL` | очередь, лимиты, бюджет SMS | да | да (staging) | обязателен; при его недоступности отправка SMS **падает закрыто** |
| `JWT_ACCESS_SECRET` | подпись access | да | генерируется Render | `openssl rand -hex 32`; ≠ refresh-секрету |
| `JWT_REFRESH_SECRET` | подпись refresh | да | генерируется Render | то же, другое значение |
| `AUTH_COOKIE_SAMESITE` | `refresh-cookie.ts` | нет | нет | `none` только если дашборды и API на разных сайтах (случай `onrender.com`); иначе не задавать |
| `CORS_ORIGINS` | `main.ts` | **да** | нет | точный список origin; без него публичный боот падает |
| `NEXT_PUBLIC_API_BASE_URL` | CSP (сборка) + runtime-конфиг дашбордов | да | нет | передавать **как build-arg**, а не только как runtime |
| `CLIENT_IP_STRATEGY` | `config/client-ip.ts` | нет | нет | `xff-depth` **после** измерения |
| `CLIENT_IP_TRUSTED_HOPS` | там же | нет | нет | измеренное число; завышение выбирает адрес атакующего |
| `TRUST_PROXY` | `main.ts` | нет | нет | не задавать на Render (её edge не вычищает XFF) |
| `SMS_ENDPOINT` + креды | `SmsModule` | да | нет | без него отправка отдаёт 503, код в лог не пишется |
| `SMS_GLOBAL_MAX_PER_HOUR` / `_DAY` | `SmsBudgetService` | да | нет | по контракту с оператором; падает закрыто |
| `ALERT_WEBHOOK_URL` | `AlertsModule` | **де-факто да** | нет | без него критические алерты уходят только в лог (см. A′2) |
| `METRICS_TOKEN` | `/metrics` | нет | нет | не задан → эндпоинт выключен (безопасно) |
| `SENTRY_DSN` | `common/observability/sentry.ts` | да | нет | без него события не отправляются вообще |
| `NEXT_PUBLIC_SENTRY_DSN` | дашборды | да | нет | публичный DSN дашбордов |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | дашборды | да | да (`staging`) | `production` для production |
| `SENTRY_VERIFY_ENABLED` / `_TOKEN` | проба дашбордов | нет | генерируется | **не включать в production**; гейт и так запрещает |
| `OTEL_EXPORTER_OTLP_ENDPOINT` / `_HEADERS` | трассировка | нет | нет | пусто → трассировка выключена |
| `MEDIA_STORAGE_DRIVER` | `MediaModule` | **да для production** | нет | `s3`; production не стартует на другом |
| `MEDIA_STORAGE_S3_*` | там же | да для production | нет | бакет/ключи |
| `MEDIA_PUBLIC_BASE_URL` | ссылки на медиа | да для production | нет | абсолютный origin API |
| `SEED_BASELINE` | `docker-entrypoint.sh:49` | нет | да (`true`) | **`false` в production** после первого входа |
| `SEED_ADMIN_PASSWORD` | baseline-сид | только при сиде | генерируется | убрать после ротации |
| `DEMO_MODE` | `configuration.ts` | нет | не задан | **никогда** в production |
| `CARD_PAYMENTS_ENABLED` | `PaymentsModule` | нет | не задан | оставить выключенным (канонической модели PSP не нужен) |
| `FEATURE_QR_LEDGER_MIRROR` | зеркало в реестр | нет | не задан | включать только после чистой сверки цикла |
| `PAYOUT_DUAL_CONTROL` | выплаты | нет | не задан → `true` | не выключать |
| `SWEEPS_ENABLED` | планировщик | нет | да (`true`) | `true`; требует always-on инстанс |
| `QUEUE_PREFIX` | BullMQ | да при общей Redis | да | свой префикс на окружение |
| `PUSH_ENABLED` / `PUSH_*` | пуши | да для production | нет | production не стартует без креденшелов |
| `PURCHASE_POOL_*_BPS` | экономика | нет | значения по умолчанию | не задавать без решения владельца; сумма 10000 проверяется при старте |

---

## Пул соединений PostgreSQL (раздел 3 задания)

**Что уже сделано в коде.** Значение управляется явно через окружение и
ничего не выдумывает: `applyPoolSettings` дописывает `connection_limit` и
`pool_timeout` в `DATABASE_URL`, только если переменные заданы, и никогда не
перезаписывает то, что оператор уже положил в саму строку подключения
(`apps/api/src/infrastructure/prisma/database-url.ts`, тесты рядом).

**Что известно точно (из Render, на чтение):**

- `tutak-staging-api`: `numInstances: 1`, план `free`;
- `tutak-staging-db`: план `free`, PostgreSQL 18, `connectionPool: none`
  (пулера перед базой нет), реплик нет.

**Что неизвестно.** `max_connections` прочитать не удалось: соединение к базе
через MCP отклоняется (`FATAL: SSL/TLS required`). Число не выдумываю.

**Что нужно узнать перед production:**

1. `max_connections` целевой БД — `SHOW max_connections;` либо карточка плана;
2. `superuser_reserved_connections` (обычно 3);
3. итоговое число инстансов API;
4. будет ли перед базой пулер (PgBouncer / Render connection pooling).

**Арифметика, которую надо подставить:**

```
инстансы × connection_limit
  + миграции (1)
  + резерв админа/psql (2)
  + резерв мониторинга платформы (2)
  + superuser_reserved_connections
  <  max_connections
```

**Безопасный временный диапазон.** Пока числа не подтверждены, при одном
инстансе: `DATABASE_CONNECTION_LIMIT` в диапазоне **5–10**,
`DATABASE_POOL_TIMEOUT` **10–20** секунд. Это заведомо ниже любого плана,
который вообще годится под production, и убирает главную опасность — дефолт
Prisma `num_cpus × 2 + 1`, который зависит от того, на какую машину попал
контейнер, а не от размера базы.

Без задания переменных поведение остаётся прежним (дефолт Prisma) — правка
ничего не ломает и ничего не решает за оператора.

---

## D. Dependency audit — до и после

**До** (`pnpm audit`, 1570 зависимостей): **5 high, 2 moderate, 0 critical.**

| Пакет | Версия | GHSA / CVE | Тип | Приходит через | Достижимо в TuTak | Риск | Есть фикс | Обновлено |
|---|---|---|---|---|---|---|---|---|
| `js-yaml` | 5.2.1 | GHSA-pm4m-ph32-ghv5 / CVE-2026-73643 | runtime (API) | `@nestjs/swagger` | нет — YAML из ввода пользователя не разбирается, Swagger в публичных развёртываниях выключен | низкий | 5.2.2 | **да** |
| `nanoid` | 3.3.17 | GHSA-2v37-7h3g-55p8 / CVE-2026-67213 | build | `@tailwindcss/postcss > postcss` | нет — сборка CSS | низкий | 3.3.18 | **да** |
| `deepmerge-ts` | 7.1.5 | GHSA-ggr8-5vv4-36mx / CVE-2026-40345 | build/CLI | `prisma > @prisma/config` | нет — конфиг Prisma CLI | низкий | 8.0.0 | **да** |
| `uuid` | 7.0.3 | GHSA-w5hq-g745-h8pq / CVE-2026-41907 | build | `expo > @expo/config-plugins > xcode` | нет — уязвим только вызов с аргументом `buf`, генерация iOS-проекта | низкий | 11.1.1 | **да** |
| `image-size` | 1.2.1 | GHSA-w3rx-r6r6-pgpr, GHSA-5p2g-fcmc-qvqq | dev (бандлер) | `expo > @expo/metro > metro` | нет — в рантайм приложения не попадает | низкий | **нет** (`patched: <0.0.0`) | нет |
| `decode-uri-component` | 0.2.2 | GHSA-vcc3-ghjq-m6fr / CVE-2026-45822 | runtime (mobile) | `@react-navigation/native > … > query-string` | теоретически — разбор параметров ссылки | низкий | 0.5.0, **только ESM** | нет |

**После:** **2 high, 1 moderate, 0 critical.**

```
до:    {"info":0,"low":0,"moderate":2,"high":5,"critical":0}
после: {"info":0,"low":0,"moderate":1,"high":2,"critical":0}
```

Правки сделаны через `pnpm.overrides`, **каждая ограничена уязвимым диапазоном**
(`"js-yaml@>=5.0.0 <5.2.2"` и т. п.), поэтому другие потребители тех же имён
(`js-yaml` 3.x и 4.x в дереве) не сдвинулись.

**Почему остались две записи:**

- **`image-size` (2 × high).** Исправленной версии не существует ни одной:
  `patched: <0.0.0`. Пакет — зависимость бандлера Metro, в рантайм приложения не
  попадает; вектор — DoS при разборе подготовленного ICNS/JXL/HEIF файла во
  время сборки. Ждать апстрим.
- **`decode-uri-component` (moderate).** Единственная исправленная версия
  `0.5.0` — **ESM-only**, а `query-string` требует её из CommonJS внутри
  мобильного бандла. Попытка выполнена и откачена: два набора мобильных тестов
  перестали загружаться с
  `SyntaxError: Unexpected token 'export'`. Ослаблять `transformIgnorePatterns`
  ради этого я не стал — это правка конфигурации приложения ради обхода
  несовместимости зависимости.

`--force`, `ignore`, `continue-on-error`, удаление шага аудита и подавление
findings не использовались.

---

## E. Выполненные проверки

Локально, на реальном стеке (Postgres 18 + Redis + API + production-сборки обоих
дашбордов):

```
pnpm audit                      до: 5 high / 2 moderate → после: 2 high / 1 moderate
prisma generate                 ок (проверяет deepmerge-ts 8)
pnpm typecheck                  8/8 пакетов
eslint apps packages tests scripts   чисто
API unit                        29 наборов / 424 теста
API integration                 79 наборов / 1075 тестов
mobile                          35 наборов / 306 тестов
admin                           9 наборов / 60 тестов + 3 node --test
partner                         9 наборов / 62 теста + 3 node --test
pnpm build                      все приложения
demo/ drift                     0 файлов расхождения
CSP админки (сборка без переменных)   http://localhost:4000 → https://tutak-staging-api.onrender.com
```

Живое staging (только чтение): статус деплоя, лог загрузки, предупреждения
MediaStorage / CLIENT_IP, факт выполнения baseline-сида, критический алерт по
`reconciliation.nightly`, план и срок жизни БД.

CI на финальном SHA `7b85f76`: run 33547608359, **зелёный целиком** — оба
job'а и все шаги. Ни один существующий шаг не удалён и не ослаблен;
`continue-on-error`, `|| true`, пропуск тестов и увеличение таймаутов не
использовались (единственный `continue-on-error` — на шаге
`Dependency audit (advisory only)` — существовал раньше и не трогался).

---

## Раздел 4: план smoke-теста наблюдаемости

Намеренно падающего production-эндпоинта не добавлено и не предлагается.

1. **Backend.** На staging (`APP_ENV=staging`) выполнить
   `pnpm --filter @tutak/api sentry:verify`. Отправляет один
   `SentryVerificationProbe`, тегированный `service=api`, `kind=sentry-verify`.
   В production скрипт откажется — это и есть проверка гейта.
2. **Дашборды.** `POST /api/internal/sentry-verify` с заголовком
   `x-sentry-verify-token`. Требуются одновременно `APP_ENV` из списка,
   `SENTRY_VERIFY_ENABLED=true`, заданный `SENTRY_VERIFY_TOKEN` и верный
   токен; любая нехватка — одинаковый 404 без тела.
3. **Mobile.** Сборка `development`/`staging`-профиля, вызвать существующий
   отладочный путь приложения; проверить, что событие пришло с тем же release.
4. **Environment.** В событии поле `environment` должно совпадать с `APP_ENV`
   сервиса, а не с `NODE_ENV` (он везде `production`).
5. **Release.** `NEXT_PUBLIC_SENTRY_RELEASE` для дашбордов равен
   `GIT_COMMIT_SHA`/`GITHUB_SHA`; сверить с задеплоенным SHA.
6. **Sanitization.** В событии остаются только теги из allowlist и
   `exception.type`; свободный текст, включая сообщение ошибки, вырезается —
   поэтому и ищут по имени класса и тегу.
7. **Утечки.** Открыть событие и убедиться, что нет пароля, токена, cookie,
   номера телефона. Парность санитайзера API и `@tutak/observability`
   проверяется отдельным шагом CI (`Sentry sanitizer parity`).
8. **Алерты.** Задать `ALERT_WEBHOOK_URL` и дождаться (или спровоцировать)
   алерта о молчащем sweep — сейчас такой алерт уже генерируется и никуда не
   уходит (A′2), так что это готовый живой тест канала.
9. **Трассировка.** Без `OTEL_EXPORTER_OTLP_ENDPOINT` трассировка выключена;
   после задания — проверить, что спаны появляются в коллекторе.

---

## F. Финальное решение

### GO WITH CONDITIONS

Код к production готов: два найденных дефекта конфигурации исправлены и
проверены, состязательные наборы по деньгам, авторизации и гонкам выполнены
целиком и зелёные, зависимости приведены к минимуму того, что вообще исправимо.

Старт блокируют не дефекты кода, а среда, которой пока нет:

1. **Production-окружения не существует.** В Render только `tutak-staging-*` на
   free-планах; production-переменные никем не заданы и не проверены.
2. **Sweeps не работают на free-инстансе** — живой критический алерт о 44 часах
   молчания ночной сверки (A′1). Нужен always-on инстанс.
3. **Критические алерты никуда не уходят** — `ALERT_WEBHOOK_URL` не задан (A′2).
4. **Обязательные переменные production не заданы**: `MEDIA_STORAGE_DRIVER=s3`
   и `MEDIA_STORAGE_S3_*`, `SMS_ENDPOINT`, `CORS_ORIGINS`, `SENTRY_DSN`,
   `PUSH_*`, `SEED_BASELINE=false`.
5. **`CLIENT_IP_TRUSTED_HOPS` не измерен** — лимиты OTP по IP выключены (A′5).
6. **`DATABASE_CONNECTION_LIMIT` не посчитан** — нужны `max_connections` и
   число инстансов.
7. **База staging истекает 2026-09-29** и не годится как основание для решения.

Выполните эти семь пунктов — и решение становится GO. Ни один из них не требует
изменения кода.

---

## G. Git

- **Финальный SHA:** `7b85f76`
- **CI run:** [33547608359](https://github.com/arman119090-cmyk/TuTak-Platform/actions/runs/33547608359) — **success**
- **Job status:**
  - `Lint, test and build` — success
  - `Build the container images` — success

  (включая шаги `Dependency audit`, `Unit tests`, `Integration tests`,
  `Migration drift check`, `Mobile tests`, `The demo app matches the app it was
  generated from`, `Admin/Partner dashboard tests`, `Build all applications`,
  `End-to-end tests`, `Drive the built mobile app against the stack`,
  `Backup and restore rehearsal`.)
- **Изменённые файлы:**

**Новые**
- `apps/admin/api-base-url.mjs`
- `apps/admin/api-base-url.test.mjs`

**Изменённые**
- `apps/admin/next.config.ts`
- `apps/admin/src/lib/httpClient.ts`
- `apps/admin/Dockerfile`
- `apps/admin/package.json`
- `apps/api/src/scripts/sentry-verify.ts`
- `apps/api/src/scripts/sentry-verify.spec.ts`
- `package.json` (pnpm.overrides)
- `pnpm-lock.yaml`
