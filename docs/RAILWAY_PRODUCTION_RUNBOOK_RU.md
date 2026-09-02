# TuTak на Railway — подготовка первого production-деплоя

**Ветка:** `claude/tutak-loyalty-mvp-e485jm`
**База задачи:** `28cbd6c` (hardening + runbook), актуальный HEAD указан в §H.
**Статус:** production **не задеплоен**. Ничего в Railway не создавалось,
не менялось и не запускалось. Этот документ — то, что нужно выполнить,
и в каком порядке.

Дополняет `docs/PRODUCTION_RUNBOOK_RU.md` (общая инфраструктурная схема,
расчёт Postgres, наблюдаемость). Здесь — только то, что специфично
для Railway, и то, что изменилось в репозитории под Railway.

---

## 0. Что изменено в репозитории этой задачей

Четыре изменения, все — инфраструктурные. Бизнес-логика не тронута,
ни один production guard не ослаблен.

| Файл | Что и почему |
|---|---|
| `apps/admin/Dockerfile`, `apps/partner/Dockerfile` | `CMD` переведён в shell-форму: `next start --port ${PORT:-3000}`. Railway **назначает** порт и ждёт, что процесс его прочитает; контейнер с фиксированным портом слушает не там, куда смотрит платформа, и Railway показывает это как провал healthcheck, а не как ошибку конфигурации. `exec` оставлен, чтобы сервер остался PID 1 и получал SIGTERM. Render и docker-compose ведут себя как раньше: `PORT` там не задаётся, срабатывает `:-3000` / `:-3001`. |
| `railway.admin.json`, `railway.partner.json` (новые) | Корневой `railway.json` указывает `apps/api/Dockerfile`. Один config на репозиторий — и все три сервиса собрали бы API. Каждому дашборду нужен свой файл, путь к нему задаётся в настройках сервиса (Config-as-code path). |
| `apps/api/docker-entrypoint.sh` | `GIT_COMMIT_SHA` теперь падает обратно на `RAILWAY_GIT_COMMIT_SHA` (раньше только `RENDER_GIT_COMMIT`). Без этого каждый production-отчёт об ошибке в Sentry был бы помечен релизом `unknown`. |
| комментарии в обоих Dockerfile | Убрано устаревшее «пустое значение → staging API»: fallback на staging удалён в `d2d8226`, сборка теперь падает. Комментарий противоречил коду. |

API уже читает `PORT` (`apps/api/src/main.ts:190` → `app.listen(port)`,
`port = process.env.PORT ?? 4000`), менять `apps/api/Dockerfile` не нужно.

---

## 1. Railway-аудит: сервисы и конфигурация

### 1.1 Как Railway должен собирать каждый сервис

| Сервис | Dockerfile | Config-as-code path | Healthcheck | Порт |
|---|---|---|---|---|
| `tutak-api` | `apps/api/Dockerfile` | `railway.json` | `/health` | из `$PORT` |
| `tutak-admin` | `apps/admin/Dockerfile` | `railway.admin.json` | `/login` | из `$PORT` |
| `tutak-partner` | `apps/partner/Dockerfile` | `railway.partner.json` | `/login` | из `$PORT` |

Два способа указать Dockerfile, **выбрать один и не смешивать**:

* **Config as code** (рекомендуется) — в настройках сервиса задать путь
  к его файлу: `railway.json` / `railway.admin.json` / `railway.partner.json`.
  Тогда builder, healthcheck и restart policy лежат в git и переживают
  пересоздание сервиса.
* **`RAILWAY_DOCKERFILE_PATH`** — переменная сервиса со значением
  `apps/admin/Dockerfile`. Проще, но healthcheck и restart policy придётся
  задавать руками в UI, и они нигде не записаны.

Root Directory **не задавать**. Все три Dockerfile рассчитаны на контекст
сборки = корень репозитория (`COPY packages ./packages`, `pnpm-workspace.yaml`).
Root Directory сузит контекст и сборка упадёт на первом `COPY` из `packages/`.

**Важно:** путь к config-файлу задаётся от корня репозитория и **не**
наследует Root Directory.

### 1.2 Что задано в конфигах

```json
{
  "build":  { "builder": "DOCKERFILE", "dockerfilePath": "apps/api/Dockerfile" },
  "deploy": { "healthcheckPath": "/health", "healthcheckTimeout": 120,
              "restartPolicyType": "ON_FAILURE", "restartPolicyMaxRetries": 3 }
}
```

* `healthcheckTimeout: 120` — у API это не запас «на всякий случай»:
  entrypoint выполняет `prisma migrate deploy` **до** старта процесса, и
  первая миграция на пустой базе занимает заметное время.
* `/health` (liveness) намеренно не проверяет базу и Redis: моргнувший
  Postgres не должен приводить к тому, что платформа убьёт процесс, который
  сам бы восстановился. Для проверки готовности есть `/health/ready`, но
  ставить его в healthcheck **не надо** — он вернёт 503 при недоступной
  зависимости и Railway начнёт перезапускать здоровый API.
* Дашборды: healthcheck указывает на `/login`. Корень `/` тоже отдаёт 200,
  но это оболочка дашборда, чья проверка авторизации выполняется в браузере;
  `/login` рендерится вообще без состояния сессии. Это же значение уже
  используется в `docker-compose.yml` для обоих дашбордов, так что healthcheck
  Railway проверяет ровно то, что проверяет CI.
* `restartPolicyMaxRetries: 3` — все boot guard'ы (см. §4) детерминированы:
  если API отказался стартовать из-за отсутствующей переменной, он откажется
  и на тридцатый раз. Три попытки отделяют «переменная не задана» от
  «Postgres ещё поднимается».

### 1.3 Приватная сеть

PostgreSQL и Redis подключать **через private networking**, не через
публичные хосты:

* `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` — Railway подставит внутренний
  адрес; проверить, что в значении `*.railway.internal`, а не `*.proxy.rlwy.net`.
* `REDIS_URL` = `${{Redis.REDIS_URL}}` — то же самое.

Публичный прокси Railway тарифицирует исходящий трафик и добавляет хоп;
для БД под нагрузкой это неверный выбор. Единственный сервис, которому нужен
публичный домен из этих троих — API (и дашборды).

### 1.4 Деплой по ветке

Каждый из трёх сервисов подключить к GitHub-репозиторию, ветка —
`claude/tutak-loyalty-mvp-e485jm` (или та, что станет production-веткой после
мержа). Watch Paths **не настраивать**: дашборды зависят от `packages/design`
и `packages/shared-types`, API — от `packages/*` тоже, и «умный» фильтр путей
здесь чаще пропустит нужную сборку, чем сэкономит.

---

## 2. Карты переменных Railway

Обозначения: **S** — секрет (не писать в git, не пересылать в чат);
**B** — нужна на этапе Docker **build**; **R** — runtime.

### 2.1 API (`tutak-api`)

#### Уже должно быть задано (reference variables)

| Переменная | Значение | Тип |
|---|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | R, S |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` | R, S |

`PORT` Railway задаёт сам — **не переопределять**.

#### Обязательно **до** первого деплоя

| Переменная | Значение | Тип | Почему |
|---|---|---|---|
| `NODE_ENV` | `production` | R | включает строгую проверку JWT-секретов |
| `APP_ENV` | `production` | R | включает production boot guards (§4) |
| `JWT_ACCESS_SECRET` | `openssl rand -hex 32` | R, S | boot blocker |
| `JWT_REFRESH_SECRET` | `openssl rand -hex 32`, **другое значение** | R, S | boot blocker |
| `CORS_ORIGINS` | origins дашбордов через запятую | R | boot blocker |
| `MEDIA_STORAGE_DRIVER` | `s3` | R | boot blocker |
| `MEDIA_STORAGE_S3_ENDPOINT` | из бакета (со схемой `https://`) | R | boot blocker |
| `MEDIA_STORAGE_S3_REGION` | из бакета | R | boot blocker |
| `MEDIA_STORAGE_S3_BUCKET` | `tutak-prod-media` | R | boot blocker |
| `MEDIA_STORAGE_S3_ACCESS_KEY_ID` | из бакета | R, S | boot blocker |
| `MEDIA_STORAGE_S3_SECRET_ACCESS_KEY` | из бакета | R, S | boot blocker |
| `MEDIA_PUBLIC_BASE_URL` | `https://api.tutak.am` — **origin API, без `/v1`, без слэша** | R | boot blocker |
| `PUSH_ENABLED` | `true` | R | boot blocker |
| `PUSH_ACCESS_TOKEN` | Expo access token | R, S | иначе push уходят в никуда |
| `SMS_ENDPOINT` | от оператора (§5) | R | boot blocker |
| `SMS_USERNAME`, `SMS_TOKEN` | от оператора | R, S | §5 |
| `SEED_ADMIN_PASSWORD` | ≥12 символов | R, S | нужен для §8; убрать после |

#### Задать до первого деплоя, значения известны

| Переменная | Значение | Почему |
|---|---|---|
| `QUEUE_PREFIX` | `tutak-prod` | изоляция очередей BullMQ от staging в общем Redis |
| `SWEEPS_ENABLED` | `true` | без этого не идут settlement, реконсиляция и сгорание бонусов |
| `DATABASE_CONNECTION_LIMIT` | см. §7.1 | без него Prisma берёт `CPU*2+1` **на процесс** |
| `DATABASE_POOL_TIMEOUT` | `15` | |
| `AUTH_COOKIE_SAMESITE` | `none` пока домены `*.up.railway.app`, снять после перехода на `*.tutak.am` — см. §6.3 | **иначе refresh не работает вообще** |

#### Можно задать после первого деплоя

| Переменная | Когда | Почему не раньше |
|---|---|---|
| `CLIENT_IP_STRATEGY`, `CLIENT_IP_TRUSTED_HOPS` | после измерения (§9) | значение на единицу больше нужного отдаёт `req.ip` тому, кто сам написал заголовок |
| `ALERT_WEBHOOK_URL` (S) | как только есть Slack-канал | без него алерт о деньгах остаётся в логе |
| `SENTRY_DSN` (S) | как только заведён проект | |
| `METRICS_TOKEN` (S) | когда есть Prometheus | пустое значение **выключает** `/metrics`, а не открывает его |
| `SMS_SENDER`, `SMS_AUTH_SCHEME`, `SMS_ENCODING` | вместе с §5 | зависят от контракта |
| `SMS_GLOBAL_MAX_PER_HOUR`, `SMS_GLOBAL_MAX_PER_DAY` | вместе с §5 | по умолчанию 500/5000 — размер для предзапуска, не для живой базы |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` (S) | опционально | трассировка |

#### Не задавать никогда в production

`DEMO_MODE`, `DEMO_SEED`, `DEMO_PASSWORD`, `CARD_PAYMENTS_ENABLED`,
`RESET_STAGING_ADMIN_PASSWORD`, `TUTAK_DEMO`, `SENTRY_VERIFY_*`.

`DEMO_MODE=true` — это ровно тот переключатель, который снимает запреты на
фейкового эквайера, фейкового SMS-оператора и фейковый push. `CARD_PAYMENTS_ENABLED=true`
поднимает `PaymentsModule`, у которого нет production-адаптера PSP, и он
откажется стартовать (`apps/api/src/modules/payments/payments.module.ts:44`).

### 2.2 Admin (`tutak-admin`) и Partner (`tutak-partner`)

| Переменная | Значение | Тип |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `https://api.tutak.am/v1` (**со `/v1`**) | **B + R** |
| `NODE_ENV` | `production` | R |
| `APP_ENV` | `production` | R |
| `NEXT_PUBLIC_SENTRY_DSN` | DSN дашборда | B, S |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | `production` | B |

Обратите внимание на асимметрию, она не случайна:
`NEXT_PUBLIC_API_BASE_URL` **со** `/v1` (это база HTTP-клиента), а
`MEDIA_PUBLIC_BASE_URL` у API — **без** `/v1` (`/v1` дописывает сам
`MediaDeliveryService`).

### 2.3 `NEXT_PUBLIC_API_BASE_URL` — почему это самый опасный пункт

Значение попадает в `connect-src` Content-Security-Policy дашборда.
CSP считается один раз, в `next build`, и **никакая runtime-переменная его
потом не меняет**. Сборка, которая угадала не тот хост, отдаёт политику,
запрещающую собственный API: браузер молча блокирует каждый запрос, а
единственный симптом — пользователь навсегда остаётся на `/login`.
Ровно это две недели ломало CI (`docs/CI_E2E_PARTNER_LOGIN_2026-09-01.md`).

Поэтому fallback убран: сборка без этой переменной теперь **падает**
(`apps/{admin,partner}/api-base-url.mjs`, тесты в `api-base-url.test.mjs`).

Railway пробрасывает переменные сервиса в Docker-сборку под теми именами,
которые Dockerfile объявил через `ARG` — а `ARG NEXT_PUBLIC_API_BASE_URL`
там объявлен, в build-стадии и в runtime-стадии. Это следует из документации
Railway и подтверждается практикой сообщества, но **это не проверено нами на
живом проекте**, и цена ошибки высока. Поэтому:

**Проверка — обязательная, после первой сборки каждого дашборда:**

1. Сборка не упала. Если упала с `ApiBaseUrlNotConfiguredError` — переменная
   до сборки не дошла; тогда либо переключиться на явный build arg, либо
   задать переменную на уровне окружения Railway, а не сервиса.
2. Хост реально «запечён»:

   ```bash
   curl -sSI https://admin.tutak.am/login | tr ';' '\n' | grep -i connect-src
   ```

   В `connect-src` должен стоять `https://api.tutak.am` — и **не** должно быть
   `localhost` или `tutak-staging-api.onrender.com`.
3. То же для partner.

Если пункт 2 показал не тот хост — исправить переменную и **пересобрать**;
рестарт не поможет, значение уже в бандле.

Не забыть `NEXT_PUBLIC_SENTRY_ENVIRONMENT`: по умолчанию `ARG` = `staging`,
и production-дашборд без явного значения будет слать ошибки в staging-окружение
Sentry.

---

## 3. Совместимость с бакетом Railway

### 3.1 Бакет обязан остаться приватным

Это не предпочтение, а следствие архитектуры доставки.
`MediaDeliveryService` (`apps/api/src/infrastructure/media/media-delivery.service.ts`)
выдаёт **свои** HMAC-подписанные URL вида
`{MEDIA_PUBLIC_BASE_URL}/v1/media/private/{assetId}/{variant}?aud=…&exp=…&sig=…`.
Подпись покрывает актив, вариант, срок **и того, кому URL выдан**; на каждом
обращении маршрут доставки заново проверяет права по базе, так что отозванное
согласие действует немедленно, а не когда истечёт ссылка. Presigned URL самого
S3 не используются вовсе — файлы читает API и отдаёт байты сам.

Публичный бакет обходит всё это целиком: аватар клиента становится доступен
любому, кто знает адрес объекта.

Права ключа — минимальные: `GetObject`, `PutObject`, `DeleteObject` на один
бакет `tutak-prod-media`. Больше ничего.

### 3.2 Как заполнить переменные

Railway показывает у бакета собственный набор переменных (endpoint, имя
бакета, ключи, регион). **Брать значения оттуда, а не придумывать формат.**
Сопоставление:

| Наша переменная | Что взять | Формат |
|---|---|---|
| `MEDIA_STORAGE_S3_ENDPOINT` | endpoint бакета | обязательно **со схемой**: `https://…`. Код делает `new URL(endpoint)` (`s3-media-storage.ts:100`), голый хост бросит исключение. Без имени бакета в пути. |
| `MEDIA_STORAGE_S3_BUCKET` | имя бакета | `tutak-prod-media` |
| `MEDIA_STORAGE_S3_REGION` | регион бакета | если Railway региона не называет — `us-east-1`; регион участвует только в подписи SigV4 |
| `MEDIA_STORAGE_S3_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` | ключи бакета | секреты |

Можно использовать reference variables (`${{Bucket.…}}`) — тогда ротация
ключа не требует правки переменных API.

### 3.3 `MEDIA_STORAGE_S3_FORCE_PATH_STYLE`

**Оставить незаданной.** Значение по умолчанию изменено на `true`
(`apps/api/src/config/configuration.ts:467`), и это правильное значение для
S3-совместимых хранилищ (MinIO, Ceph и то, на чём стоят бакеты Railway):
адрес строится как `{endpoint}/{bucket}/{key}`. Virtual-hosted стиль
(`{bucket}.{endpoint}/{key}`) требует wildcard-DNS на хосте бакета, чего у
таких хранилищ обычно нет.

Раньше по умолчанию было `false` — это было унаследовано от AWS и для Railway
неверно. Исправлено.

Если после деплоя загрузка медиа падает с 403/404 от хранилища — это тот
случай, когда стоит попробовать `MEDIA_STORAGE_S3_FORCE_PATH_STYLE=false`.
Проверка (§7, шаг 9): загрузить логотип партнёра через админку и открыть
выданный URL.

---

## 4. Переменные, без которых API не стартует (проверено по коду)

Всё ниже проверено чтением исходников при `APP_ENV=production`,
`NODE_ENV=production`, `DEMO_MODE` не задан.

### 4.1 Жёсткие boot blockers — процесс падает при старте

| Переменная | Где проверяется | Сообщение |
|---|---|---|
| `DATABASE_URL` | `config/env.validation.ts` | ошибка валидации |
| `JWT_ACCESS_SECRET` (≥32) | там же | ошибка валидации |
| `JWT_REFRESH_SECRET` (≥32) | там же | ошибка валидации |
| `REDIS_URL` | `infrastructure/redis/redis.module.ts:29` | `REDIS_URL must be configured in production` |
| `CORS_ORIGINS` | `main.ts:84` | `CORS_ORIGINS must list the allowed origins outside development` |
| `MEDIA_STORAGE_DRIVER=s3` | `media-storage.module.ts:50` | локальный диск не переживает редеплой |
| `MEDIA_PUBLIC_BASE_URL` | `media-storage.module.ts:60` | |
| 5 переменных `MEDIA_STORAGE_S3_*` | `media-storage.module.ts:~80` | перечисляет недостающие поимённо |
| `PUSH_ENABLED=true` | `push/push.module.ts:31` | `PUSH_ENABLED must be true in production` |
| `SMS_ENDPOINT` | `infrastructure/sms/sms-transport.ts:42` | `SMS_ENDPOINT must be configured in production` |

### 4.2 Security blockers — падают на содержимом, а не на отсутствии

`assertProductionJwtSecretsAreStrong` (`env.validation.ts:109`) отказывает, если
JWT-секрет: похож на плейсхолдер (`change-me`, `example`, `test-secret`, …),
имеет низкую энтропию (<8 различных символов), **или равен второму секрету**.
Порождать только через `openssl rand -hex 32`, по разу на каждый.

`TRUST_PROXY` и `CLIENT_IP_STRATEGY=xff-depth` одновременно — тоже отказ
(`main.ts:126`). Задавать ровно одно; на Railway — `CLIENT_IP_STRATEGY`.

### 4.3 Коммерческие блокеры — не мешают старту, но ломают продукт

* `PUSH_ACCESS_TOKEN` — пустой не мешает загрузиться, но доставки не будет.
* `SMS_USERNAME` / `SMS_TOKEN` — без них каждый запрос кода вернёт
  «временно недоступно». Код нигде не пишется в лог, так что обходного пути нет.
* `SEED_ADMIN_PASSWORD` — без него seed откажется работать и войти в админку
  будет некому.

### 4.4 Опциональная наблюдаемость — старту не мешает

`SENTRY_DSN`, `ALERT_WEBHOOK_URL`, `METRICS_TOKEN`, `OTEL_*`.
`ALERT_WEBHOOK_URL` не блокирует старт **сознательно**, но именно он решает,
узнает ли живой человек, что с деньгами что-то не так.

### 4.5 Чего в списке нет

**PSP/эквайер не является блокером.** `CARD_PAYMENTS_ENABLED` не задан →
`PaymentsModule` вообще не поднимается (`app.module.ts:105`), и его требование
production-адаптера не срабатывает. Это уже сделано ранее (задача «PSP-optional
production boot»); никаких действий не нужно, кроме как не включать флаг.

---

## 5. SMS — что запросить у оператора

Credentials ещё не получены. Ничего не подставлено, фейкового провайдера нет,
guard не ослаблен: без `SMS_ENDPOINT` API в production **не стартует**.

### 5.1 Что нужно получить

1. **URL HTTP-эндпоинта отправки** — полный, со схемой.
2. **Способ аутентификации**: HTTP Basic (логин+пароль) или Bearer-токен.
3. **Логин/пароль или токен.**
4. **Формат тела**: `application/x-www-form-urlencoded` или JSON.
5. **Sender ID / alphanumeric sender** — как подписаны сообщения. Для Армении
   отправитель обычно регистрируется у оператора заранее.
6. **Лимиты контракта**: сколько сообщений в час и в сутки разрешено/оплачено.
7. Поддержка **UCS-2/Unicode** — армянский текст в GSM-7 не помещается.

### 5.2 Как это ложится в переменные Railway

```
SMS_ENDPOINT=<полный URL со схемой>
SMS_AUTH_SCHEME=basic            # или bearer
SMS_USERNAME=<логин>             # только для basic
SMS_TOKEN=<пароль или токен>     # секрет
SMS_SENDER=TuTak                 # согласованный sender ID
SMS_ENCODING=form                # или json
SMS_GLOBAL_MAX_PER_HOUR=<из контракта>
SMS_GLOBAL_MAX_PER_DAY=<из контракта>
```

Значения по умолчанию: `basic`, `form`, sender `TuTak`, 500/сутки·час→5000.
Глобальные лимиты — единственное, что ограничивает **счёт от оператора**, а не
охват одного атакующего, и они fail-closed: при недоступном Redis отправка
останавливается, а не становится безлимитной. Взять числа из контракта, а не
из этих значений по умолчанию.

### 5.3 Проверка после настройки

Запросить код на реальный номер и убедиться, что SMS пришла. Кода нет ни в
логах, ни в ответе API — это намеренно, другого способа проверить не существует.

---

## 6. Публичный домен и CORS

### 6.1 Порядок

1. Включить Railway-домен у `tutak-api` → получится `…-api-….up.railway.app`.
2. Тем же способом — у `tutak-admin` и `tutak-partner`.
3. Подключить кастомные домены: `api.tutak.am`, `admin.tutak.am`,
   `partner.tutak.am`; в DNS добавить CNAME, которые покажет Railway.
   Дождаться выпуска сертификатов.
4. Только после этого выставить финальные значения:

```
CORS_ORIGINS=https://admin.tutak.am,https://partner.tutak.am
MEDIA_PUBLIC_BASE_URL=https://api.tutak.am
NEXT_PUBLIC_API_BASE_URL=https://api.tutak.am/v1     # обоим дашбордам
```

5. **Пересобрать** оба дашборда (не рестартовать) — §2.3.

### 6.2 Какие origins нужны в `CORS_ORIGINS`

Только веб-источники: `https://admin.tutak.am` и `https://partner.tutak.am`.
Мобильное приложение — нативный клиент, у него нет Origin и CORS к нему не
применяется; добавлять туда что-либо для мобильного не нужно и вредно.
Схему указывать обязательно, слэш в конце не ставить.

### 6.3 SameSite — подтверждённая проблема доменов Railway

Refresh-токен живёт в httpOnly-cookie. По умолчанию `SameSite=Strict`, и это
верно, **если дашборд и API — один site** (один registrable domain).

`up.railway.app` **находится в Public Suffix List** — проверено по
первоисточнику (`publicsuffix.org`, раздел «Railway Corporation»). Значит
`…-api-….up.railway.app` и `…-admin-….up.railway.app` — **разные sites**, и
при `Strict` браузер не отправит cookie на API **никогда**: refresh не будет
работать вообще, а не изредка.

Отсюда:

* пока дашборды и API на сгенерированных доменах `*.up.railway.app` →
  `AUTH_COOKIE_SAMESITE=none` (это автоматически включает `Secure`);
* после перевода всех трёх на `*.tutak.am` → **убрать** переменную, вернув
  `strict`: у `admin.tutak.am` и `api.tutak.am` общий registrable domain
  `tutak.am`, и `Strict` даёт защиту от CSRF бесплатно.

Не забыть шаг «убрать»: `none` отдаёт эту защиту. Она частично компенсирована
`assertTrustedCookieOrigin` (`auth/refresh-cookie.ts`), которая от SameSite не
зависит, но лучше иметь обе.

**Проверка:** войти в админку, подождать истечения access-токена, убедиться,
что сессия продлилась, а не выкинула на `/login`.

---

## 7. Runbook первого деплоя

### 7.1 До нажатия Deploy

1. **Посчитать `DATABASE_CONNECTION_LIMIT`.** Узнать `max_connections`
   у Railway Postgres:

   ```sql
   SHOW max_connections;
   ```

   Формула:

   ```
   DATABASE_CONNECTION_LIMIT = (max_connections − 10) / (число инстансов API)
   ```

   Вычет 10 — на миграции, `psql`, бэкап и мониторинг платформы.
   При одном инстансе и `max_connections = 100` это 90; ставить **20** как
   безопасный старт: Prisma по умолчанию возьмёт `CPU×2+1` **на процесс** и
   при масштабировании упрётся в `FATAL: sorry, too many clients already` —
   на всех инстансах сразу, включая healthcheck. `DATABASE_POOL_TIMEOUT=15`.
2. Убедиться, что заданы **все** переменные из §4.1. Отсутствие любой — падение
   при старте, а не деградация.
3. Проверить, что `DEMO_MODE`, `DEMO_SEED`, `CARD_PAYMENTS_ENABLED`,
   `RESET_STAGING_ADMIN_PASSWORD` **не заданы**.
4. Проверить, что `JWT_ACCESS_SECRET ≠ JWT_REFRESH_SECRET`.
5. Проверить, что `DATABASE_URL` и `REDIS_URL` указывают на `*.railway.internal`.

### 7.2 Порядок деплоя

**Сначала только API.** Дашборды бессмысленно собирать, пока не известен
финальный публичный адрес API — их CSP запекается на сборке.

1. Задеплоить `tutak-api`. В логах должно быть:
   * `prisma migrate deploy` применил миграции;
   * нет ни одного `Refusing to start` / `must be configured`;
   * healthcheck прошёл.
2. `curl -fsS https://<api>/health` → `{"status":"ok","demoMode":false}`.
   **`demoMode` обязан быть `false`.**
3. `curl -fsS https://<api>/health/ready` → `{"status":"ok","checks":{"database":"ok","redis":"ok"}}`.
   Это же и есть проверка, что Redis подключён.
4. Выполнить seed (§8).
5. Настроить домены и CORS (§6), включая `AUTH_COOKIE_SAMESITE`.
6. Только теперь задеплоить `tutak-admin` и `tutak-partner` с корректным
   `NEXT_PUBLIC_API_BASE_URL`.
7. Проверить `connect-src` у обоих (§2.3, пункт 2).
8. Войти в админку под seed-администратором, сменить временный пароль.
9. **Проверка S3:** загрузить логотип партнёра через админку, открыть
   выданный URL, убедиться, что картинка отдаётся. Это единственная сквозная
   проверка того, что endpoint, ключи и path-style верны.
10. **Проверка Sentry:** намеренно падающий эндпоинт в production не
    добавляется. Достаточно того, что первая же реальная ошибка приедет в
    Sentry с тегом релиза = SHA деплоя (`RAILWAY_GIT_COMMIT_SHA`, §0).
    Проверить сам факт доставки лучше заранее на staging: `sentry-verify`
    разрешён только в `development`/`staging`/`test` и в production откажется
    по имени окружения.
11. **Проверка алерта:** после задания `ALERT_WEBHOOK_URL` убедиться, что в
    Slack-канал приходит сообщение. Безопасный способ — вызвать реконсиляцию
    на заведомо расходящихся данных в staging, а не в production.
12. Измерить `CLIENT_IP_TRUSTED_HOPS` (§9) и задать его.

---

## 8. Seed и что происходит при рестарте

### 8.1 Процедура

1. Задать `SEED_ADMIN_PASSWORD` (≥12 символов) и `SEED_BASELINE=true`.
2. Redeploy. В логе появится
   `SEED_BASELINE=true — seeding permissions, roles and the super admin`.
3. Войти в админку, **сменить пароль** (у пользователя выставлен
   `mustChangePassword: true`).
4. **Убрать `SEED_BASELINE`** и **убрать `SEED_ADMIN_PASSWORD`**.

### 8.2 Пересоздаёт ли рестарт временный пароль — нет

Проверено по коду. `apps/api/src/scripts/seed-baseline.ts` создаёт
администратора через `prisma.user.upsert({ where: …, update: {}, create: { … } })`.
`update: {}` — пустой: если пользователь уже есть, **не меняется ничего**,
включая `passwordHash`. Так что даже если `SEED_BASELINE=true` останется
включённым, рестарт не вернёт временный пароль. Убрать флаг всё равно стоит —
чтобы не делать лишнюю работу на каждом старте и чтобы намерение было явным.

Роли и permissions — тоже upsert, они переживают рестарт корректно.

### 8.3 Восстановление доступа в production

Пути `RESET_STAGING_ADMIN_PASSWORD` в production **нет**: entrypoint
отказывается стартовать, если `NODE_ENV != staging`. Это сделано намеренно.
Следствие: **`SEED_ADMIN_PASSWORD` и пароль администратора после смены нужно
сохранить в менеджере паролей до деплоя.** Восстановление возможно только
через `railway run`/shell с прямым доступом к базе.

---

## 9. `X-Forwarded-For` на Railway — как измерить

### 9.1 Почему нельзя угадать

`CLIENT_IP_TRUSTED_HOPS` — число хопов, отсчитываемых **справа**.
Завышение на единицу заставляет Express взять запись, которую написал сам
клиент: каждый запрос получает свежую корзину rate limit, и лимиты OTP,
логина и сброса пароля перестают существовать. Занижение — все запросы
выглядят как один адрес.

Express считает **сам сокет первым доверенным хопом**. Это проверено против
Express в `apps/api/src/config/client-ip.spec.ts`, а не предположено: для
сервиса за одним балансировщиком, который дописывает увиденный адрес,
правильное значение — **1**.

### 9.2 Ограничение, которое надо знать заранее

Процедура из `docs/PRODUCTION_RUNBOOK_RU.md` §8 говорит «посмотреть в логах
API, какой `X-Forwarded-For` реально дошёл». **В текущем коде это невозможно:**
ни middleware, ни логгер, ни Sentry не пишут этот заголовок — Sentry
намеренно вырезает объект `request` целиком
(`common/observability/sentry-sanitize.ts`). Добавлять логирование сырого
клиентского заголовка не стоит: это ровно тот вектор, о котором предупреждает
комментарий в `request-context.middleware.ts` (инъекция переводов строки в лог).

### 9.3 Процедура для Railway

**Способ, не трогающий production-код (рекомендуется).** Поднять в том же
проекте и окружении Railway одноразовый echo-сервис, снять с него заголовки,
удалить сервис. Он проходит через тот же edge, что и API.

```bash
# запрос к временному echo-сервису с подделанным левым значением
curl -sS https://<echo>.up.railway.app/ -H 'X-Forwarded-For: 203.0.113.99'
```

В ответе найти `X-Forwarded-For`. Он будет вида:

```
203.0.113.99, <ваш реальный IP>, <хопы, дописанные edge Railway>
```

1. Посчитать, сколько записей edge дописал **справа** от вашего настоящего
   адреса. Обозначим `N`.
2. **`CLIENT_IP_TRUSTED_HOPS = N + 1`** (сокет — первый доверенный хоп).
3. Записать:

```
CLIENT_IP_STRATEGY=xff-depth
CLIENT_IP_TRUSTED_HOPS=<измеренное>
```

4. Удалить echo-сервис.

`TRUST_PROXY` на Railway **не использовать**: он предназначен для прокси,
который вычищает входящий `X-Forwarded-For` перед тем, как дописать свой.
Edge Railway, как и Render, только дописывает. Задать обе переменные сразу —
отказ при старте (§4.2).

### 9.4 Проверка, что значение верное

После установки — убедиться, что подделанный левый адрес **не** даёт свежий
лимит:

```bash
for i in $(seq 1 12); do
  curl -sS -o /dev/null -w '%{http_code} ' https://api.tutak.am/v1/auth/otp/request \
    -H 'Content-Type: application/json' \
    -H "X-Forwarded-For: 203.0.113.$i" \
    -d '{"phone":"+374XXXXXXXX","purpose":"LOGIN"}'
done; echo
```

Ожидается: несколько `2xx`, затем `429`. Если все двенадцать `2xx` — значение
завышено, лимит обходится подделкой заголовка; уменьшить на единицу и повторить.

Делать это **до** объявления запуска: каждая успешная попытка — реальная SMS
и реальные деньги.

---

## 10. Cloudflare

Отвечаю на заданный ранее вопрос: **Cloudflare (или аналога) у нас сейчас нет
нигде** — ни в репозитории, ни в конфигурации инфраструктуры. Ни один конфиг
его не упоминает.

Более того, код **сознательно отказывается** доверять заголовку
`CF-Connecting-IP` (`apps/api/src/config/client-ip.ts`): он был бы лучшим
ответом на вопрос «кто клиент», но только если доказано, что весь трафик
действительно идёт через Cloudflare и что Cloudflare перезаписывает
клиентскую копию заголовка на этом пути. Подтвердить это по первоисточникам
не удалось, а неподтверждённый заголовок хуже адреса сокета: выглядит
авторитетно и подделывается любым, кто достучится до origin напрямую.

Функции, которые обычно ждут от Cloudflare, сейчас закрыты так:

| Функция | Чем закрыта |
|---|---|
| TLS-сертификаты | Railway выпускает сам для кастомных доменов |
| CDN для статики | Next.js отдаёт свои ассеты; медиа проходит через API (§3.1) и кэшируется по `Cache-Control` |
| Rate limiting | на уровне приложения (`ThrottlerGuard` + лимиты OTP + глобальный бюджет SMS) |
| WAF / DDoS | **не закрыто** |

Если Cloudflare всё же ставится перед Railway — это меняет число хопов, и
`CLIENT_IP_TRUSTED_HOPS` придётся **переизмерить** по §9. Ставить Cloudflare
и не переизмерить — тот самый способ незаметно сломать все лимиты по IP.

Отдельным решением (не задачей этого документа) может быть переход на
`CF-Connecting-IP` — но только после того, как будет доказано, что origin
недостижим в обход Cloudflare.

---

## 11. Итоговая таблица

| Компонент | Что создать/купить | План | ENV | Проверка | Блокер |
|---|---|---|---|---|---|
| PostgreSQL | есть | платный, не free | `DATABASE_URL`, `DATABASE_CONNECTION_LIMIT` | `/health/ready` | `max_connections` не измерен |
| Redis | есть | с персистентностью | `REDIS_URL`, `QUEUE_PREFIX` | `/health/ready` | — |
| API | есть | не «спящий» | §2.1 | `/health`, `demoMode:false` | SMS credentials |
| Admin | есть | — | §2.2 | `connect-src` | адрес API |
| Partner | есть | — | §2.2 | `connect-src` | адрес API |
| Бакет | есть, приватный | — | 5×`MEDIA_STORAGE_S3_*`, `MEDIA_PUBLIC_BASE_URL` | загрузка логотипа | endpoint не сверен |
| Домены | купить/настроить | `*.tutak.am` | `CORS_ORIGINS`, `AUTH_COOKIE_SAMESITE` | продление сессии | DNS |
| SMS | получить у оператора | по контракту | 8 переменных `SMS_*` | реальная SMS | **GO-блокер** |
| Push | Expo access token | — | `PUSH_ENABLED`, `PUSH_ACCESS_TOKEN` | уведомление на телефон | токен |
| Sentry | проект | — | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | ошибка с тегом релиза | — |
| Алерты | Slack webhook | — | `ALERT_WEBHOOK_URL` | сообщение в канал | — |
| Client IP | — | — | `CLIENT_IP_*` | §9.4 | не измерен |

---

# Финальный отчёт

## A. Что уже готово

* **Репозиторий готов к Railway.** Все три Dockerfile читают `$PORT`; у каждого
  сервиса свой config-as-code файл; entrypoint помечает релиз Sentry
  SHA-коммитом Railway.
* **Архитектурная неоднозначность `NEXT_PUBLIC_API_BASE_URL` устранена** (ранее,
  `d2d8226` + `28cbd6c`): сборка без переменной падает вместо того, чтобы
  запечь в CSP staging-адрес; значение доходит и до build-, и до runtime-стадии.
* **`MEDIA_STORAGE_S3_FORCE_PATH_STYLE` по умолчанию исправлен на `true`** —
  верное значение для бакетов Railway; переменную задавать не нужно.
* **Список boot blockers проверен по коду**, а не по документации (§4), с
  указанием файла и строки для каждого.
* **PSP перестал быть блокером** — `PaymentsModule` не поднимается без
  `CARD_PAYMENTS_ENABLED`.
* **Seed безопасен к рестарту** — проверено: `upsert` с пустым `update`,
  существующий пароль администратора не переписывается (§8.2).
* **Проблема SameSite на доменах Railway найдена и подтверждена по
  первоисточнику** (`up.railway.app` в Public Suffix List) — до её решения
  refresh-сессии не работали бы вообще (§6.3).
* **Процедура измерения `CLIENT_IP_TRUSTED_HOPS` для Railway написана** и
  вместе с ней найдено ограничение: прежняя процедура «посмотреть в логах»
  неисполнима, потому что заголовок нигде не логируется (§9.2).

## B. Что блокирует **первый деплой**

1. **SMS credentials.** `SMS_ENDPOINT` — жёсткий boot blocker: без него API в
   `APP_ENV=production` не стартует. Ничего не подставлено и не должно быть.
2. **`max_connections` Postgres не измерен** → `DATABASE_CONNECTION_LIMIT`
   не посчитан. Не мешает старту одного инстанса, но обязателен до
   масштабирования.
3. **Endpoint и регион бакета не сверены** с тем, что показывает Railway.
4. **Expo `PUSH_ACCESS_TOKEN`** — `PUSH_ENABLED=true` обязателен для старта,
   но без токена доставки не будет.

## C. Что блокирует **GO** (сверх пунктов B)

5. **`CLIENT_IP_TRUSTED_HOPS` не измерен** — лимиты OTP по IP сейчас
   отключены (приложение это само определяет и не пытается делать вид, что
   лимит работает). Остаётся только глобальный бюджет SMS.
6. **`ALERT_WEBHOOK_URL` не задан** — о проблеме с деньгами никто не узнает
   ночью.
7. **`SENTRY_DSN` не задан** — production-ошибки не собираются.
8. **Кастомные домены не подключены**; пока их нет, нужен
   `AUTH_COOKIE_SAMESITE=none`, а это отдаёт CSRF-защиту, которую `Strict`
   давал бесплатно.
9. **Сквозная проверка S3 не выполнена** (загрузка логотипа) — до неё
   корректность `forcePathStyle`/endpoint остаётся предположением.
10. **WAF/DDoS не закрыт ничем** (§10) — это осознанный, а не забытый пробел.

## D. Задачи владельца (никто, кроме вас, их не сделает)

1. Получить SMS credentials у оператора — 7 пунктов из §5.1.
2. Завести Expo access token.
3. Завести проект Sentry, взять DSN для API и по DSN на каждый дашборд.
4. Завести Slack (или иной) incoming webhook для алертов.
5. Купить/настроить DNS: `api.tutak.am`, `admin.tutak.am`, `partner.tutak.am`.
6. Сгенерировать два JWT-секрета (`openssl rand -hex 32`, разные) и
   `SEED_ADMIN_PASSWORD`; **сохранить их в менеджере паролей** — в production
   пути восстановления доступа нет (§8.3).
7. Внести все переменные в Railway (они не должны попадать в git).
8. Выбрать план Postgres и Redis; убедиться, что API-сервис не «засыпает» —
   спящий API не выполняет settlement, реконсиляцию и сгорание бонусов.
9. Выполнить §9.3 (echo-сервис) и §9.4, задать `CLIENT_IP_*`.
10. Решить, нужен ли Cloudflare/WAF; если да — переизмерить хопы.

## E. Задачи Claude (по вашей команде)

1. Обновить документацию под фактические имена переменных бакета Railway,
   когда вы их пришлёте.
2. Если проверка §2.3 покажет, что Railway не пробрасывает переменную в
   сборку — переключить дашборды на явные build args и проверить в CI.
3. Если §9.4 покажет обход лимита — разобрать и исправить.
4. Подготовить production-вариант мобильного `app.config.js` под финальный
   адрес API.
5. Настроить загрузку source maps в Sentry отдельной задачей CI
   (`docs/SENTRY_SOURCEMAPS_FUTURE_RU.md`).
6. По вашему решению — добавить безопасное (санитизированное) логирование
   цепочки `X-Forwarded-For`, если echo-сервис окажется неудобным.

## F. Последовательность после получения SMS credentials

1. Внести переменные `SMS_*` (§5.2).
2. Внести остальные обязательные переменные API (§2.1) и проверить §7.1.
3. Задеплоить **только API**. Проверить `/health` (`demoMode:false`) и
   `/health/ready`.
4. Выполнить seed (§8.1), войти, сменить пароль, убрать `SEED_*`.
5. Проверить отправку реальной SMS на реальный номер.
6. Подключить домены (§6.1), выставить `CORS_ORIGINS`,
   `MEDIA_PUBLIC_BASE_URL`, `AUTH_COOKIE_SAMESITE`.
7. Задеплоить дашборды с `NEXT_PUBLIC_API_BASE_URL` и **проверить
   `connect-src`** (§2.3).
8. Проверить продление сессии (§6.3).
9. Загрузить логотип партнёра — проверка S3 (§7.2, шаг 9).
10. Измерить и задать `CLIENT_IP_*` (§9), проверить §9.4.
11. Задать `ALERT_WEBHOOK_URL`, `SENTRY_DSN`, убедиться в доставке.
12. Посчитать и задать `DATABASE_CONNECTION_LIMIT` (§7.1).
13. Провести один реальный сквозной сценарий: регистрация по OTP → покупка по
    QR → начисление бонуса → settlement партнёра.
14. Только после 13 — объявлять запуск.

## G. GO / NO-GO для первого production-деплоя

**NO-GO на сегодня** — по одной причине, которая не является дефектом:
без SMS credentials API в `APP_ENV=production` физически не стартует.
Это защита, а не проблема, и обходить её нельзя.

**GO WITH CONDITIONS после получения credentials** — то есть первый деплой
можно делать, но **это ещё не запуск для клиентов**. Условия, которые обязаны
быть закрыты до допуска реальных пользователей:

* пункты C5 (client IP), C6 (алерты), C7 (Sentry) — закрыты;
* сквозная проверка S3 и продления сессии — пройдены;
* `DATABASE_CONNECTION_LIMIT` — посчитан;
* сценарий F13 — выполнен на реальных данных.

До закрытия этих условий система пригодна для внутренней проверки, но не для
приёма настоящих денег: без измеренного client IP лимиты OTP по IP выключены,
а без webhook о финансовом расхождении никто не узнает вовремя.

Ослаблять ради ускорения нечего: ни один production guard не отключался и
не должен отключаться.

## H. Git и CI

* **Ветка:** `claude/tutak-loyalty-mvp-e485jm`
* **Коммит:** `__SHA__`
* **CI:** `__CI__`

Ни одного production-деплоя в рамках этой задачи не выполнено. Секретные
значения в репозиторий не добавлялись. Бизнес-логика не изменялась.
Ни один production guard не ослаблен.
