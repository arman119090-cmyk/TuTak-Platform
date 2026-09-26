# TuTak — Production Infrastructure Runbook

Дата: 2026-09-01. База: `7b85f76`. Итог: **`28cbd6c`**,
CI run [33552417299](https://github.com/arman119090-cmyk/TuTak-Platform/actions/runs/33552417299) — зелёный
(оба job'а: `Lint, test and build`, `Build the container images`).
Шаблон блюпринта: `render.production.yaml` (**не применён**).

Этот документ — процедура создания production-окружения с нуля.
**Production в рамках этой задачи не разворачивался**, данные не менялись,
секретов в репозитории нет.

Читать вместе с `docs/PRODUCTION_READINESS_2026-09-01.md` — там аудит, который
объясняет, откуда взялись многие требования ниже.

---

## 1. Схема production-инфраструктуры

```
                    ┌──────────────────────┐
   покупатель ─────►│  Mobile (Expo/EAS)   │──┐
                    └──────────────────────┘  │
                    ┌──────────────────────┐  │   HTTPS
   партнёр ────────►│ tutak-prod-partner   │──┤   (CORS allowlist,
                    │ Next.js, Render web  │  │    CSP connect-src)
                    └──────────────────────┘  │
                    ┌──────────────────────┐  │
   оператор ───────►│ tutak-prod-admin     │──┤
                    │ Next.js, Render web  │  │
                    └──────────────────────┘  │
                                              ▼
                                  ┌───────────────────────┐
                                  │   tutak-prod-api      │
                                  │   NestJS, Render web  │
                                  │   always-on, /health  │
                                  │   + планировщик sweeps│
                                  └───┬───────┬───────┬───┘
                                      │       │       │
              ┌───────────────────────┘       │       └────────────────┐
              ▼                               ▼                        ▼
   ┌────────────────────┐         ┌────────────────────┐    ┌────────────────────┐
   │  tutak-prod-db     │         │ tutak-prod-redis   │    │  S3 / объектное    │
   │  PostgreSQL        │         │ очередь sweeps,    │    │  хранилище медиа   │
   │  ledger + данные   │         │ rate limits,       │    │  (логотипы,        │
   │  бэкапы, PITR      │         │ бюджет SMS         │    │   аватары)         │
   └────────────────────┘         └────────────────────┘    └────────────────────┘

   Наружу от API:
     SMS-оператор ──── коды OTP (глобальный бюджет, падает закрыто)
     Expo Push   ──── уведомления
     Sentry      ──── ошибки API / Admin / Partner / Mobile
     OTLP        ──── трассировка (опционально)
     Alert webhook ── критические финансовые события → человеку
```

Кто с кем говорит и на чём это держится:

| Связь | Протокол | Чем защищено |
|---|---|---|
| Браузер → Admin/Partner | HTTPS | security headers, CSP |
| Браузер → API | HTTPS + cookie | CORS allowlist, `SameSite`, httpOnly, `assertTrustedCookieOrigin` |
| Mobile → API | HTTPS + Bearer | SecureStore, ротация refresh |
| API → PostgreSQL | TCP/TLS | приватная сеть Render, `ipAllowList: []` |
| API → Redis | TCP | приватная сеть Render |
| API → S3 | HTTPS | ключи доступа, подписанные URL с TTL 12 ч |
| API → SMS/Push/Sentry/OTLP/webhook | HTTPS | токены в ENV, никогда в git |

---

## 2. Спецификация сервисов Render

Все три сервиса — `runtime: docker`. Build command и start command заданы
Dockerfile'ами, а не полями Render; ниже указано, что именно выполняется.

### 2.1 `tutak-prod-api`

| Поле | Значение |
|---|---|
| Тип | Web Service (Docker) |
| План | **`starter` или выше — не `free`** (см. §5) |
| Instances на старте | **1** |
| Health check | `/health` (Render), `/health/ready` для ручной проверки БД+Redis |
| Dockerfile | `apps/api/Dockerfile`, контекст — корень репозитория |
| Build | multi-stage: `pnpm install --frozen-lockfile` → `prisma generate` → `nest build` |
| Start | `./docker-entrypoint.sh` → `prisma migrate deploy` → (опц. `seed-baseline`) → `node dist/main.js` |
| Пользователь | `node` (uid 1000), не root |

**ENV.** B = build-time, R = runtime, 🔒 = секрет.

| Переменная | B/R | 🔒 | Значение / источник |
|---|---|---|---|
| `NODE_ENV` | R | | `production` |
| `APP_ENV` | R | | `production` |
| `PORT` | R | | `4000` |
| `DATABASE_URL` | R | 🔒 | `fromDatabase` |
| `DATABASE_CONNECTION_LIMIT` | R | | посчитать по §4 |
| `DATABASE_POOL_TIMEOUT` | R | | посчитать по §4 |
| `REDIS_URL` | R | 🔒 | `fromService` |
| `QUEUE_PREFIX` | R | | `tutak-prod` |
| `SWEEPS_ENABLED` | R | | `true` |
| `JWT_ACCESS_SECRET` | R | 🔒 | `generateValue: true` |
| `JWT_REFRESH_SECRET` | R | 🔒 | `generateValue: true`, **≠ access** |
| `CORS_ORIGINS` | R | | origin'ы Admin и Partner через запятую |
| `AUTH_COOKIE_SAMESITE` | R | | не задавать (`strict`), либо `none` при разных сайтах |
| `CLIENT_IP_STRATEGY` | R | | `xff-depth` **после** измерения (§8) |
| `CLIENT_IP_TRUSTED_HOPS` | R | | измеренное число (§8) |
| `SMS_ENDPOINT` | R | 🔒 | оператор связи |
| `SMS_USERNAME` / `SMS_TOKEN` | R | 🔒 | оператор связи |
| `SMS_SENDER` | R | | буквенный отправитель |
| `SMS_GLOBAL_MAX_PER_HOUR` / `_DAY` | R | | из контракта (§10 readiness) |
| `ALERT_WEBHOOK_URL` | R | 🔒 | §6 |
| `SENTRY_DSN` | R | 🔒 | Sentry |
| `MEDIA_STORAGE_DRIVER` | R | | `s3` (иначе production не стартует) |
| `MEDIA_STORAGE_S3_*` | R | 🔒 | §7 |
| `MEDIA_PUBLIC_BASE_URL` | R | | абсолютный origin API |
| `PUSH_ENABLED` | R | | `true` |
| `PUSH_ACCESS_TOKEN` | R | 🔒 | Expo |
| `OTEL_EXPORTER_OTLP_ENDPOINT` / `_HEADERS` | R | 🔒 | коллектор, опционально |
| `OTEL_SERVICE_NAME` | R | | `tutak-api` |
| `METRICS_TOKEN` | R | 🔒 | не задан → `/metrics` выключен |
| `SEED_BASELINE` | R | | `false`; на один боот `true` (§9) |
| `SEED_ADMIN_PASSWORD` | R | 🔒 | только на время §9, потом удалить |

Не задавать никогда: `DEMO_MODE`, `DEMO_SEED`, `CARD_PAYMENTS_ENABLED`,
`FEATURE_QR_LEDGER_MIRROR` (до чистой сверки), `SENTRY_AUTH_TOKEN`.

### 2.2 `tutak-prod-admin` и `tutak-prod-partner`

| Поле | Admin | Partner |
|---|---|---|
| Тип | Web Service (Docker) | Web Service (Docker) |
| План | `starter` | `starter` |
| Instances | 1 | 1 |
| Health check | `/login` (публичная страница, 200 без сессии) | `/login` |
| Dockerfile | `apps/admin/Dockerfile` | `apps/partner/Dockerfile` |
| Build | `pnpm install --frozen-lockfile --filter …` → `next build` | то же |
| Start | `next start --port 3000 --hostname 0.0.0.0` | `--port 3001` |
| Порт | 3000 | 3001 |

| Переменная | B/R | 🔒 | Значение |
|---|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | **B (обязательно) + R** | | origin production-API + `/v1` |
| `NODE_ENV` | R | | `production` |
| `APP_ENV` | R | | `production` |
| `PORT` | R | | `3000` / `3001` |
| `NEXT_PUBLIC_SENTRY_DSN` | B+R | | публичный DSN дашборда |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | B | | `production` |
| `GIT_COMMIT_SHA` | B | | SHA сборки → release в Sentry |
| `SENTRY_VERIFY_ENABLED` / `_TOKEN` | R | 🔒 | **не задавать в production** |

---

## 3. `NEXT_PUBLIC_API_BASE_URL` — неоднозначность устранена

**Что было.** Значение решает, что попадёт в `connect-src` политики
Content-Security-Policy дашборда. Политика вычисляется **один раз при сборке**
и никакая runtime-переменная её потом не меняет. Если при сборке значения не
было, код подставлял **staging-API**. Для staging это случайно совпадало; для
production это означало бы образ, которому разрешён только staging-хост, а
первым симптомом стали бы клиенты, не способные войти.

**Что стало (`apps/{admin,partner}/api-base-url.mjs`).**

| Вход | Результат |
|---|---|
| значение задано | используется как есть |
| не задано, `next dev` | локальный API |
| **не задано, сборка развёртывания** | **сборка падает** с `ApiBaseUrlNotConfiguredError` |

Staging-константа осталась только для проверки hostname в `httpClient.ts` —
ни одна сборка на неё больше не откатывается.

**Проверено на настоящей сборке:**

```
$ NODE_ENV=production npx next build            # ничего не задано
Error [ApiBaseUrlNotConfiguredError]: NEXT_PUBLIC_API_BASE_URL was not set for
this build. It fixes the connect-src of this dashboard's Content-Security-Policy…

$ NODE_ENV=production NEXT_PUBLIC_API_BASE_URL=https://api.tutak.am/v1 npx next build
$ curl -sSD- -o /dev/null localhost:3011/login | grep -i connect-src
connect-src 'self' https://api.tutak.am
```

**Значение нужно и сборке, и рантайму.** `next start` перечитывает
`next.config.ts` — именно оттуда берутся заголовки ответа, — поэтому
контейнер должен получить тот же ответ, что и сборка. Dockerfile переносит
build-arg в рантайм-стадию (`ARG` объявлен второй раз + `ENV`); без этого
контейнер падал при старте, что CI поймал как
`curl: (52) Empty reply from server` на дашборде, который до этого собрался
без ошибок.

**Как доставить значение в сборку на Render.** Dockerfile объявляет
`ARG NEXT_PUBLIC_API_BASE_URL=""`, поэтому:

- **Способ A.** Задать переменную сервиса в дашборде Render. Render передаёт
  переменные окружения сервиса в `docker build` как build-arg'и, если в
  Dockerfile есть одноимённый `ARG`. **Это надо подтвердить на первой же
  сборке**, а не принимать на веру.
- **Способ B (если A не сработал).** Собирать образ в CI с явным
  `--build-arg NEXT_PUBLIC_API_BASE_URL=…` и деплоить готовый образ.

**Проверка, которая отвечает на вопрос однозначно** — сразу после деплоя:

```bash
curl -sSD- -o /dev/null https://admin.tutak.am/login \
  | tr ';' '\n' | grep -i connect-src
# должно быть:  connect-src 'self' https://api.tutak.am
```

Если сборка упала с `ApiBaseUrlNotConfiguredError` — значение до сборки не
дошло, переходите к способу B. Если сборка прошла, а в заголовке чужой хост —
значит собрали с чужим значением. Третьего варианта («тихо не тот хост»)
больше не существует.

---

## 4. PostgreSQL: получить числа, потом считать

### 4.1 Получить

Через Render Shell сервиса API либо `psql` с `DATABASE_URL`:

```sql
SHOW max_connections;
SHOW superuser_reserved_connections;
-- PostgreSQL 18 добавил ещё один резерв; он тоже вычитается:
SHOW reserved_connections;
```

Наличие пулера:

```
Render Dashboard → tutak-prod-db → Info → Connection Pooling
```

либо в API блюпринта поле `connectionPool` (`none` = пулера нет).
На staging сейчас `connectionPool: none`.

Полезно посмотреть, сколько соединений занято на самом деле:

```sql
SELECT state, count(*) FROM pg_stat_activity GROUP BY state;
```

### 4.2 Посчитать

```
instances × connection_limit
  + migrations (1)
  + admin reserve (2)
  + monitoring reserve (2)
  + superuser_reserved_connections (+ reserved_connections)
  <  max_connections
```

Отсюда:

```
connection_limit  =  ⌊ (max_connections − 5 − reserved) / instances ⌋
```

и затем **округлить вниз ещё раз**, оставив запас на пики и на второй инстанс,
который однажды появится.

**Пример (числа подставить свои, это не рекомендация):** если
`max_connections = 100`, `superuser_reserved_connections = 3`,
`reserved_connections = 0`, `instances = 1`:

```
(100 − 5 − 3) / 1 = 92   →  берём не 92, а 20:
1 × 20 + 1 + 2 + 2 + 3 = 28  <  100 ✓
```

Двадцать, а не девяносто два, потому что пул — это не то, что можно занять,
а то, что понадобится: 20 параллельных запросов к БД с одного инстанса — это
уже много, а оставшийся запас нужен ручному `psql` во время инцидента.

`DATABASE_POOL_TIMEOUT` — **10–20 секунд**. Меньше 10 — запросы начнут падать
на всплесках; больше 20 — очередь ожидания станет длиннее, чем терпение
клиента.

**Если пулер (PgBouncer) есть:** `connection_limit` считается против лимита
пулера, а не базы, и в `DATABASE_URL` добавляется `pgbouncer=true`.

### 4.3 Записать

Обе переменные — runtime, задаются в дашборде сервиса API. Код уже умеет их
читать (`apps/api/src/infrastructure/prisma/database-url.ts`) и **ничего не
выдумывает**, если они не заданы: остаётся собственный дефолт Prisma
`num_cpus × 2 + 1`, который зависит от машины, а не от базы. Именно поэтому
задать их нужно.

---

## 5. Always-on и фоновые задачи

**Факт, а не предположение.** На живом staging (план `free`) 2026-09-01
зафиксировано:

```
[critical] Background job 'reconciliation.nightly' has stopped running —
It last completed 2630 minute(s) ago, and its tolerance is 1560 minute(s).
```

Free-инстанс засыпает без входящего трафика, а вместе с ним останавливается
планировщик. Сорок четыре часа без ночной сверки.

**Требование:** план сервиса API — такой, который не засыпает (`starter` и
выше), `SWEEPS_ENABLED=true`, Redis с персистентностью (очередь и heartbeat
живут в нём).

Что именно перестаёт работать на спящем инстансе — 14 повторяющихся задач:

| Задача | Что делает |
|---|---|
| `reconciliation.nightly` | сверяет каждый счёт с его же проводками |
| `partner-settlement.biweekly-check` | расчёты с партнёрами |
| `outbox.drain` | доставка событий, на которых держится settlement |
| `bonus.promote-pending` | перевод бонусов в доступные |
| `bonus.expire-lots` | сгорание бонусов |
| `bonus.release-expired-reservations` | снятие зависших резервов |
| `deferred-bonus.expire-lots` | отложенные лоты |
| `purchase-intent.expire` | протухшие намерения покупки |
| `ev.expire-stale-reservations` / `ev.expire-stale-sessions` | зарядки |
| `ev.reconcile-roaming-cdrs` | сверка роуминговых CDR |
| `account.anonymize-deleted` | удаление персональных данных в срок |
| `retention.prune` | ретенция нефинансовых записей |

**Проверка после деплоя (через 25 часов после старта):** в логах не должно
быть `sweep.silent`. Быстрее — посмотреть heartbeat в Redis или дождаться
первого ночного прогона `reconciliation.nightly` в логе.

---

## 6. Alerts

**Что это.** `ALERT_WEBHOOK_URL` — любой endpoint, принимающий `POST`
`application/json`. Формат тела совместим со Slack/Mattermost/Discord
(`text` — готовая строка), плюс машиночитаемые поля:

```json
{
  "text": "🔴 *<заголовок>* — production\n<тело>\n• ключ: значение",
  "severity": "critical",
  "title": "...", "body": "...", "key": "...",
  "environment": "production",
  "context": { },
  "firedAt": "2026-09-01T18:49:51.363Z"
}
```

Таймаут отправки — 5 с; зависший webhook не держит транзакцию и не блокирует
воркер. Повторные одинаковые алерты подавляются окном дедупликации.

**Что настроить.**

1. Создать incoming webhook в Slack/Mattermost/Telegram-мосте.
2. Направить его в канал, **который кто-то читает ночью**, и включить
   мобильные уведомления для `severity: critical`.
3. Задать `ALERT_WEBHOOK_URL` в сервисе API (секрет).
4. Проверить: в логах боота появляется
   `Alerts will be delivered by webhook (production)`.
5. Живой тест: см. §10.

Без переменной алерты уходят только в лог — код это разрешает намеренно (боот
не падает), но для production это означает «никто не узнал».

---

## 7. Media / S3

Production не стартует ни с чем, кроме `MEDIA_STORAGE_DRIVER=s3`, — и это
правильно: локальный диск на Render эфемерный, файлы исчезают при деплое, а в
БД остаются `MediaAsset`, указывающие в никуда.

| Переменная | Что это |
|---|---|
| `MEDIA_STORAGE_DRIVER` | `s3` |
| `MEDIA_STORAGE_S3_ENDPOINT` | endpoint провайдера (AWS/Cloudflare R2/MinIO) |
| `MEDIA_STORAGE_S3_REGION` | регион |
| `MEDIA_STORAGE_S3_BUCKET` | имя бакета |
| `MEDIA_STORAGE_S3_ACCESS_KEY_ID` | 🔒 ключ |
| `MEDIA_STORAGE_S3_SECRET_ACCESS_KEY` | 🔒 секрет |
| `MEDIA_STORAGE_S3_FORCE_PATH_STYLE` | `true` по умолчанию; AWS принимает, self-hosted требует |
| `MEDIA_SIGNED_URL_TTL_SECONDS` | `43200` (12 ч) по умолчанию |
| `MEDIA_PUBLIC_BASE_URL` | абсолютный origin API, напр. `https://api.tutak.am` |

Бакет — **приватный**. Аватар покупателя не публичен: URL подписан HMAC по
активу, варианту, сроку и тому, кому он выдан. Публичный бакет обходит это.

Права ключа: `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` на один
бакет. Ничего больше.

---

## 8. Client IP / OTP — измерить, а не угадать

**Почему нельзя угадывать.** `CLIENT_IP_TRUSTED_HOPS` — число хопов,
отсчитываемых **справа** в `X-Forwarded-For`. Завышение на единицу выбирает
запись, которую написал сам клиент, — и лимиты OTP начинают считать
несуществующие адреса. Edge Render **не вычищает** входящий `X-Forwarded-For`,
поэтому левое значение всегда подконтрольно вызывающему; `TRUST_PROXY`
(который называет адрес прокси) здесь не применяется.

**Процедура измерения.** С незаданными `CLIENT_IP_STRATEGY` и
`CLIENT_IP_TRUSTED_HOPS` (то есть сразу после первого деплоя):

1. Отправить запрос с подделанным заголовком:

   ```bash
   curl -sS https://api.tutak.am/health \
     -H 'X-Forwarded-For: 203.0.113.99'
   ```

2. Найти в логах API строку запроса и посмотреть, какой `X-Forwarded-For`
   реально дошёл до приложения. Он будет вида
   `203.0.113.99, <ваш реальный IP>, <адрес(а) edge Render>`.
3. Посчитать, сколько записей edge **дописал справа** от вашего настоящего
   адреса. Обозначим это `N`.
4. **Число хопов = `N + 1`.** Express считает сам сокет первым доверенным
   хопом — это была ошибка на единицу в первой версии нашей же модели, и её
   поймали тесты (`apps/api/src/config/client-ip.spec.ts`).

**Записать:**

```
CLIENT_IP_STRATEGY=xff-depth
CLIENT_IP_TRUSTED_HOPS=<измеренное>
```

**Проверка, что значение верное:**

```bash
# запрос с подделанным левым значением не должен давать свежий лимит
for i in $(seq 1 12); do
  curl -sS -o /dev/null -w '%{http_code} ' https://api.tutak.am/v1/auth/otp/request \
    -H 'Content-Type: application/json' \
    -H "X-Forwarded-For: 203.0.113.$i" \
    -d '{"phone":"+37400000000","purpose":"LOGIN"}'
done
# ожидание: лимит срабатывает (429), а не 12 успешных ответов
```

Пока значение не измерено — **не задавать ничего**. В этом состоянии лимиты
по IP выключены осознанно (в логе есть предупреждение), а расходы держит
глобальный бюджет SMS.

---

## 9. Первый запуск и seed

`seed-baseline` создаёт только права, роли и одного временного супер-админа.
Никаких партнёров, покупателей и денег. Все записи — upsert, пароль
существующего админа не трогается.

**Процедура.**

1. В сервисе API задать:
   - `SEED_BASELINE=true`
   - `SEED_ADMIN_PASSWORD=<сильный, ≥12 символов>` (секрет, одноразовый)
2. Задеплоить / перезапустить. В логе:
   `SEED_BASELINE=true — seeding permissions, roles and the super admin`
   → `Baseline seed complete.`
3. Войти в Admin под супер-админом.
4. **Сменить пароль** внутри приложения.
5. Создать именные учётные записи для реальных операторов, роли выдать по
   минимуму (супер-админ — не рабочая учётка).
6. Вернуть `SEED_BASELINE=false`.
7. **Удалить** `SEED_ADMIN_PASSWORD` из переменных сервиса.
8. Перезапустить и убедиться, что строки `SEED_BASELINE=true — seeding…` в
   логе больше нет.

**Почему нельзя оставлять `true`.** Сид выполняется при каждом рестарте
(зафиксировано на staging), то есть временный супер-админ пересоздаётся на
каждом деплое. `DEMO_SEED` не задавать никогда — это отдельный флаг, который
изобретает партнёров, покупателей и платежи.

---

## 10. Smoke-test наблюдаемости

Прогонять сначала на staging, потом — те пункты, что применимы, на production.
Намеренно падающих production-эндпоинтов нет и не добавляется.

| # | Что | Как | Ожидание |
|---|---|---|---|
| 1 | Sentry API | на staging: `pnpm --filter @tutak/api sentry:verify` | событие `SentryVerificationProbe`, теги `service=api`, `kind=sentry-verify` |
| 2 | Sentry API, гейт | то же на production | отказ: `sentry-verify refuses to run in APP_ENV=production` |
| 3 | Sentry Admin | `POST /api/internal/sentry-verify` + `x-sentry-verify-token` (staging) | событие в проекте Admin |
| 4 | Sentry Admin, гейт | тот же запрос на production | `404`, пустое тело |
| 5 | Sentry Partner | как 3–4 | то же |
| 6 | Sentry Mobile | сборка development/staging-профиля, штатный отладочный путь | событие с тем же release |
| 7 | Environment | открыть любое событие | `environment` = `APP_ENV` сервиса, **не** `NODE_ENV` (он везде `production`) |
| 8 | Release | сверить `NEXT_PUBLIC_SENTRY_RELEASE` / release события | равен задеплоенному SHA |
| 9 | Sanitization | открыть событие | только теги из allowlist и `exception.type`; свободный текст вырезан |
| 10 | Утечки | то же событие | нет пароля, токена, cookie, телефона |
| 11 | OTEL | задать `OTEL_EXPORTER_OTLP_ENDPOINT`, сделать запрос | спаны в коллекторе, `service.name=tutak-api` |
| 12 | Alerts | задать `ALERT_WEBHOOK_URL` | в логе `Alerts will be delivered by webhook`; сообщение дошло в канал |
| 13 | Alerts, живой | дождаться/спровоцировать `sweep.silent` | 🔴 сообщение в канале, а не только в логе |
| 14 | `/metrics` | `curl` без токена и с токеном | без токена — закрыт; с токеном — метрики |

---

## 11. Итоговая таблица

| Компонент | Что купить/создать | План | ENV | Проверка | Blocker |
|---|---|---|---|---|---|
| **API** | Render Web Service | `starter`+ (не спит) | весь блок §2.1 | `/health` 200, `/health/ready` 200 | **да** |
| **Admin** | Render Web Service | `starter` | §2.2 + build-arg | `connect-src` = production API | **да** |
| **Partner** | Render Web Service | `starter` | §2.2 + build-arg | `connect-src` = production API | **да** |
| **PostgreSQL** | Render Postgres (платный) | `starter`+ | `DATABASE_URL`, лимиты §4 | `migrate deploy` прошёл; `pg_stat_activity` в норме | **да** |
| **Redis** | Render Key Value | `starter` (с персистентностью) | `REDIS_URL`, `QUEUE_PREFIX` | `/health/ready` показывает redis ok | **да** |
| **S3 / медиа** | бакет + ключ | — | `MEDIA_STORAGE_*`, `MEDIA_PUBLIC_BASE_URL` | загрузка логотипа партнёра и его отдача | **да** |
| **SMS** | договор с оператором | — | `SMS_ENDPOINT`, креды, бюджеты | OTP реально приходит | **да** |
| **Sentry** | проект(ы) | free хватает на старт | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | §10 п. 1–10 | **да** |
| **Alert webhook** | канал + incoming webhook | — | `ALERT_WEBHOOK_URL` | §10 п. 12–13 | **да** |
| **Push** | Expo access token | — | `PUSH_ENABLED`, `PUSH_ACCESS_TOKEN` | тестовый пуш на устройство | **да** (иначе API не стартует) |
| **OpenTelemetry** | коллектор | — | `OTEL_EXPORTER_OTLP_*` | §10 п. 11 | нет |
| **Домены** | `api.` / `admin.` / `partner.` | — | `CORS_ORIGINS`, `MEDIA_PUBLIC_BASE_URL` | TLS выдан, редирект на HTTPS | **да** |
| **Бэкапы/PITR** | план БД с бэкапами | — | — | пробное восстановление (`scripts/`) | **да** |
| **Client IP** | — (измерение) | — | `CLIENT_IP_*` | §8 | нет (но лимиты OTP выключены) |

---

## 12. Кто что делает

### Только владелец (вручную)

1. Оплатить и создать: Render Postgres (платный), Redis, три web-сервиса на
   непроспящем плане.
2. Купить/настроить домены и TLS: `api.`, `admin.`, `partner.`.
3. Договор с SMS-оператором: endpoint, логин, токен, буквенный отправитель,
   согласованные лимиты в час/сутки.
4. Создать S3-бакет (приватный) и ключ с правами только на него.
5. Создать проект(ы) Sentry и получить DSN (backend + два публичных).
6. Создать incoming webhook в мессенджере и канал, который читают ночью.
7. Получить Expo push access token.
8. Ввести все секреты в дашборд Render (не в git).
9. Выполнить измерения, которые требуют живого сервиса: `SHOW max_connections`,
   `SHOW superuser_reserved_connections`, наличие пулера, число хопов
   `X-Forwarded-For`.
10. Пройти процедуру §9: первый вход, смена пароля, `SEED_BASELINE=false`,
    удаление `SEED_ADMIN_PASSWORD`.
11. Решить: производится ли деплой из этой ветки или из `main` после merge.

### Может сделать Claude

1. ✅ Убрать зависимость production от staging fallback (§3) — **сделано**.
2. ✅ Шаблон блюпринта `render.production.yaml` без единого секрета — **сделано**.
3. ✅ Этот runbook — **сделано**.
4. По полученным от владельца числам — посчитать `DATABASE_CONNECTION_LIMIT`
   и `DATABASE_POOL_TIMEOUT` и записать их в блюпринт.
5. По измеренному числу хопов — записать `CLIENT_IP_STRATEGY` и
   `CLIENT_IP_TRUSTED_HOPS`.
6. Настроить CI-сборку образов с явным build-arg, если способ A из §3 не
   сработает.
7. Прогнать smoke-test §10 и разобрать любое расхождение.
8. Держать CI зелёным и разбирать падения.
9. Проверить восстановление из бэкапа на отдельной базе.

---

## 13. Последовательность до GO

| Шаг | Действие | Кто | Готово, когда |
|---|---|---|---|
| 1 | Создать Postgres (платный) и Redis | владелец | статус `available` |
| 2 | Снять `max_connections`, `superuser_reserved_connections`, пулер | владелец | числа записаны |
| 3 | Посчитать и записать `DATABASE_CONNECTION_LIMIT` / `_POOL_TIMEOUT` | Claude | §4 сходится |
| 4 | Создать S3-бакет и ключ | владелец | ключ выдан |
| 5 | Договор с SMS-оператором | владелец | endpoint и креды есть |
| 6 | Sentry-проекты, alert webhook, Expo token | владелец | DSN/URL/token есть |
| 7 | Домены и TLS | владелец | сертификаты выданы |
| 8 | Создать три сервиса из `render.production.yaml` | владелец | сервисы созданы, ещё не задеплоены |
| 9 | Ввести все ENV (§2), кроме `CLIENT_IP_*` | владелец | ни одного пустого обязательного |
| 10 | Первый деплой API | владелец | `/health` 200, в логе нет отказа боота |
| 11 | Проверить, что миграции применились | владелец | `migrate deploy` в логе без ошибок |
| 12 | Деплой Admin и Partner **с build-arg** | владелец/Claude | `connect-src` = production API (§3) |
| 13 | Процедура первого входа и seed (§9) | владелец | `SEED_BASELINE=false`, пароль сменён |
| 14 | Измерить хопы, задать `CLIENT_IP_*` (§8) | владелец + Claude | подделка XFF не даёт свежий лимит |
| 15 | Smoke-test наблюдаемости (§10) | Claude | все 14 пунктов пройдены |
| 16 | Дождаться первого ночного прогона sweeps (§5) | — | нет `sweep.silent` через 25 часов |
| 17 | Пробное восстановление из бэкапа | Claude | реестр сходится после restore |
| 18 | Проверить алерт живьём (§10 п. 13) | владелец | сообщение пришло человеку |
| 19 | **GO** | владелец | шаги 1–18 закрыты |

Между шагами 16 и 19 — сутки ожидания; они не сокращаются, потому что
единственный способ узнать, что ночная сверка работает, — дождаться ночи.

---

## Что этот документ не покрывает

- Railway. Всё выше — про Render. Переносится не один-в-один: своя
  конфигурация, **другое число хопов**, другое поведение прокси.
- Нагрузочный профиль. Числа §4 — про безопасность, а не про
  производительность; когда появится реальный трафик, их надо пересчитать.
- Мобильные релизы (EAS submit, магазины) — отдельная процедура.
