# Sentry: активация staging без source-map upload

Этот документ описывает только безопасную активацию Sentry для первого
staging. Source-map upload для admin/partner в эту задачу **не входит**.

## API

Runtime:

- `NODE_ENV=staging`
- `SENTRY_DSN=<dsn проекта tutak-api>`
- `GIT_COMMIT_SHA` — если доступен; иначе entrypoint использует
  `RENDER_GIT_COMMIT`, а при отсутствии обоих release будет `unknown`.

Проверочная команда внутри staging-контейнера:

```bash
node dist/scripts/sentry-verify.js
```

Production-гард в скрипте должен запрещать запуск при
`NODE_ENV=production`.

## Admin / Partner

Для первого staging нужны:

- `NEXT_PUBLIC_SENTRY_DSN` — отдельный DSN для каждого приложения;
- `NEXT_PUBLIC_SENTRY_ENVIRONMENT=staging`;
- `APP_ENV=staging`;
- `SENTRY_VERIFY_ENABLED=true` только на время проверки;
- `SENTRY_VERIFY_TOKEN` как runtime secret.

Маршрут проверки:

```text
POST /api/internal/sentry-verify
x-sentry-verify-token: <token>
```

`SENTRY_AUTH_TOKEN` в Render runtime для admin/partner **запрещён**.
`SENTRY_ORG` и `SENTRY_PROJECT` для первого staging тоже не нужны, потому что
source maps явно отключены в обоих `next.config.ts`:

```ts
sourcemaps: { disable: true }
```

Не считать доказанным, что Render автоматически прокидывает runtime env в
Docker `ARG`. Поэтому отсутствие build-time Sentry значений не должно ломать
Docker build: Dockerfile содержит безопасные значения по умолчанию.

## Source maps

Source maps проверяются и включаются только отдельной будущей задачей:
`docs/SENTRY_SOURCEMAPS_FUTURE_RU.md`.

До выполнения той задачи нельзя:

- добавлять `SENTRY_AUTH_TOKEN` в `render.yaml`;
- хранить его как runtime env admin/partner;
- коммитить токен в репозиторий;
- утверждать, что source maps загружены.

## Что можно считать подтверждением первого staging

Для каждого приложения достаточно подтвердить доставку тестового события с
правильными `service`, `environment` и, когда доступен, `release`.
Минифицированный stack trace на этом этапе допустим: source maps сознательно
отложены.

Эта инструкция не выполняет deploy и не изменяет Sentry/Render аккаунты.
