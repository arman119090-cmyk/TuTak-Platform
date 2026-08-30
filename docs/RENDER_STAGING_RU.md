# Render staging: безопасный первый деплой

Корневой `render.yaml` описывает staging без `DEMO_MODE` и `DEMO_SEED`.
Никакого deploy этой задачей не выполняется.

## 1. Sentry для первого staging

Первый staging должен собираться и запускаться **без `SENTRY_AUTH_TOKEN` и без
загрузки source maps**.

Для API используется runtime-переменная `SENTRY_DSN`. Для admin и partner
оставлены `NEXT_PUBLIC_SENTRY_DSN` и `NEXT_PUBLIC_SENTRY_ENVIRONMENT=staging`.
DSN не является секретом. Если build-система не передаст `NEXT_PUBLIC_*` во
время `docker build`, образ всё равно должен успешно собраться: DSN по
умолчанию пустой, а environment в Dockerfile по умолчанию `staging`.

Не считать подтверждённым механизмом предположение, что runtime env Render
автоматически становится Docker `ARG`. Поэтому критические условия первого
деплоя не зависят от такого поведения.

`GIT_COMMIT_SHA` остаётся build-time входом в Dockerfile и используется для
Sentry release, когда сборочная система действительно передаёт его. При его
отсутствии release будет `unknown`; это не должно ломать сборку или запуск.
Для API `docker-entrypoint.sh` отдельно умеет взять runtime
`RENDER_GIT_COMMIT`, если `GIT_COMMIT_SHA` не задан.

`SENTRY_AUTH_TOKEN`, `SENTRY_ORG` и `SENTRY_PROJECT` отсутствуют в
`render.yaml` для admin/partner. Source maps в `next.config.ts` явно отключены
через `sourcemaps.disable: true`.

Будущая безопасная реализация source maps вынесена в
`docs/SENTRY_SOURCEMAPS_FUTURE_RU.md`.

## 2. Baseline seed

`SEED_BASELINE=true` разрешён только как bootstrap свежей staging-базы.
Он создаёт:

- permissions;
- roles и связи role-permission;
- одного временного super admin;
- связь этого admin с ролью SUPER_ADMIN.

Он **не должен** создавать партнёров, wallet, referral code, покупки,
скидки, рефералы, платежи, settlements или любые иные бизнес-данные.
Это дополнительно покрыто unit-тестом `seed-baseline.spec.ts`.

`SEED_ADMIN_PASSWORD` должен быть не короче 12 символов. Администратор
создаётся с `mustChangePassword=true`.

После первого успешного входа обязательно:

1. сменить пароль временного администратора;
2. установить `SEED_BASELINE=false` в Render;
3. только после этого считать bootstrap завершённым.

Повторный запуск baseline не меняет пароль уже существующего администратора,
но после bootstrap флаг всё равно должен быть выключен.

## 3. Переменные Render

### API

- `NODE_ENV=staging`
- `PORT=4000`
- `DATABASE_URL` из staging Postgres
- `REDIS_URL` из staging Redis
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` — generated
- `SEED_BASELINE=true` только до завершения bootstrap
- `SEED_ADMIN_PASSWORD` — generated
- `CORS_ORIGINS` — `sync: false`
- `TRUST_PROXY` — `sync: false`
- `SWEEPS_ENABLED=true`
- `QUEUE_PREFIX=tutak-staging`
- `SENTRY_DSN` — `sync: false`

### Admin / Partner

- `NODE_ENV=production` — режим `next start`, не название среды
- `APP_ENV=staging`
- `PORT=3000` / `3001`
- `NEXT_PUBLIC_API_BASE_URL` — значение нужно при сборке для рабочего клиента
- `NEXT_PUBLIC_SENTRY_DSN` — значение нужно при сборке для Sentry клиента
- `NEXT_PUBLIC_SENTRY_ENVIRONMENT=staging`
- `SENTRY_VERIFY_ENABLED` — runtime opt-in
- `SENTRY_VERIFY_TOKEN` — generated

Запрещено добавлять в runtime Render для этих сервисов:

- `SENTRY_AUTH_TOKEN`
- любые будущие upload credentials для source maps

## 4. Перед Apply

Проверить, что:

- в `render.yaml` нет `SENTRY_AUTH_TOKEN`;
- в admin/partner `next.config.ts` стоит `sourcemaps.disable: true`;
- Dockerfile не содержит `ARG SENTRY_AUTH_TOKEN`;
- baseline seed не пишет в business tables;
- после bootstrap есть операционная инструкция выключить `SEED_BASELINE` и
  сменить пароль.

Эта задача не выполняет Apply/Deploy и не меняет настройки Render.
