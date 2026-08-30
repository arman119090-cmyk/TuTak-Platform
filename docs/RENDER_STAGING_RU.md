# Render staging: переменные и порядок применения

Корневой `render.yaml` описывает **staging** — настоящую непроизводственную
среду: без `DEMO_MODE`, без `DEMO_SEED`, без выдуманных клиентов и платежей.
Демонстрационный blueprint сохранён рядом как `render.demo.yaml`.

**Ничего не развёрнуто.** Этот документ описывает конфигурацию, которая лежит
в репозитории, и ровно те действия, которые остаётся сделать человеку с
доступом к Render.

---

## 1. Что создаётся

| Объект Render | Имя | План |
|---|---|---|
| PostgreSQL | `tutak-staging-db` | free |
| Key Value (Redis) | `tutak-staging-redis` | free |
| Web (Docker) | `tutak-staging-api` | free |
| Web (Docker) | `tutak-staging-admin` | free |
| Web (Docker) | `tutak-staging-partner` | free |

База и Redis закрыты `ipAllowList: []` — снаружи недоступны, изнутри сети
Render сервисы к ним ходят.

---

## 2. Три вида переменных

- **runtime** — Render передаёт в запущенный контейнер. Меняется без пересборки.
- **build-time** — нужна во время `docker build`. Render передаёт значение
  переменной сервиса в сборку как build-arg для каждого `ARG`, объявленного в
  Dockerfile; в `apps/admin/Dockerfile` и `apps/partner/Dockerfile` такие `ARG`
  объявлены. Изменение такой переменной требует пересборки образа (Render
  пересобирает сам при сохранении).
- **generated** — Render генерирует случайное значение один раз при первом
  Apply (`generateValue: true`). Человек не придумывает и не хранит его.

`sync: false` означает «Render спросит значение при Apply и хранит его в
своей панели». Ни одного реального значения нет и не должно быть в
репозитории.

---

## 3. `tutak-staging-api`

| Переменная | Тип | Значение | Комментарий |
|---|---|---|---|
| `NODE_ENV` | runtime | `staging` | перекрывает `production` из Dockerfile; включает CORS-гард и выключает Swagger, но не требует живого эквайера и SMS-оператора |
| `PORT` | runtime | `4000` | |
| `DATABASE_URL` | runtime | из `tutak-staging-db` | подставляет Render |
| `REDIS_URL` | runtime | из `tutak-staging-redis` | подставляет Render |
| `JWT_ACCESS_SECRET` | generated | — | |
| `JWT_REFRESH_SECRET` | generated | — | |
| `SEED_BASELINE` | runtime | `true` | роли, права и один супер-админ; бизнес-данных не создаёт |
| `SEED_ADMIN_PASSWORD` | generated | — | первый пароль админа, аккаунт создаётся с `mustChangePassword` |
| `CORS_ORIGINS` | runtime, `sync: false` | вписать после первого деплоя | `https://<admin>,https://<partner>`; без него API не стартует |
| `TRUST_PROXY` | runtime, `sync: false` | необязательно | пусто — лимиты считаются по прямому TCP-адресу; см. §7 |
| `SWEEPS_ENABLED` | runtime | `true` | |
| `QUEUE_PREFIX` | runtime | `tutak-staging` | |
| `SENTRY_DSN` | runtime, `sync: false` | DSN проекта `tutak-api` | серверная переменная, в браузер не попадает; пусто — Sentry просто выключен |
| `GIT_COMMIT_SHA` | runtime, автоматически | — | не задаётся: `docker-entrypoint.sh` берёт `RENDER_GIT_COMMIT`, если своё значение не задано |

---

## 4. `tutak-staging-admin` и `tutak-staging-partner`

Одинаковый набор, разные значения DSN и `SENTRY_PROJECT`, разные порты.

| Переменная | Тип | Значение | Комментарий |
|---|---|---|---|
| `NODE_ENV` | runtime | `production` | это требование Next.js к `next start`, а не описание среды |
| `PORT` | runtime | admin `3000`, partner `3001` | должно совпадать с портом в CMD соответствующего Dockerfile |
| `APP_ENV` | runtime | `staging` | именно это значение делает среду непроизводственной для маршрута проверки Sentry |
| `NEXT_PUBLIC_API_BASE_URL` | **build-time**, `sync: false` | `https://<api>/v1` | вшивается в браузерный бандл; менять только с пересборкой |
| `NEXT_PUBLIC_SENTRY_DSN` | **build-time**, `sync: false` | DSN проекта `tutak-admin` / `tutak-partner` | не секрет |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | **build-time** | `staging` | |
| `SENTRY_ORG` | **build-time**, `sync: false` | слаг вашей организации | только для загрузки source maps |
| `SENTRY_PROJECT` | **build-time** | `tutak-admin` / `tutak-partner` | |
| `SENTRY_AUTH_TOKEN` | **build-time, СЕКРЕТ**, `sync: false` | токен с правом записи в проект | см. §5 |
| `SENTRY_VERIFY_ENABLED` | runtime, `sync: false` | ровно `true`, когда нужна проверка | иначе маршрут проверки отвечает 404 |
| `SENTRY_VERIFY_TOKEN` | generated | — | Render генерирует; передаётся в заголовке `x-sentry-verify-token` |
| `GIT_COMMIT_SHA` | **build-time**, необязательно | — | если Render передаст в сборку `RENDER_GIT_COMMIT`, релиз подставится сам; иначе релиз будет `unknown` |

---

## 5. Почему `SENTRY_AUTH_TOKEN` не попадает в образ

Токен читает `next.config.ts` во время сборки, чтобы загрузить source maps.
В Dockerfile он объявлен как `ARG` в сборочной стадии, **никогда** не
превращается в `ENV` и передаётся только команде сборки. Финальная стадия
начинается заново от базового образа и копирует лишь результат сборки, поэтому
токена нет ни в опубликованном образе, ни в его истории, ни в слоях.

Чего Render не умеет: у Docker-сервисов нет переменных «только для сборки».
Поэтому значение будет присутствовать и в окружении запущенного контейнера —
кодом приложения оно там не читается. Если это нежелательно, удалите
переменную из сервиса после успешной сборки; следующая сборка тогда просто
пропустит загрузку source maps.

---

## 6. Порядок применения

1. Render → **New → Blueprint** → репозиторий и нужная ветка → Render
   прочитает корневой `render.yaml`.
2. Render спросит значения `sync: false`. Настоящих URL ещё нет, поэтому
   `CORS_ORIGINS` и оба `NEXT_PUBLIC_API_BASE_URL` заполните заглушками, а
   Sentry-переменные оставьте пустыми, если Sentry пока не подключаете.
3. **Apply**. Первая сборка — десятки минут (три Docker-образа).
4. Выпишите три выданных адреса и подставьте настоящие значения:
   - `tutak-staging-api` → `CORS_ORIGINS` = `https://<admin>,https://<partner>`;
   - обе панели → `NEXT_PUBLIC_API_BASE_URL` = `https://<api>/v1` (пересборка).
5. Пароль администратора: `tutak-staging-api` → Environment →
   `SEED_ADMIN_PASSWORD`. При первом входе система потребует его сменить.
6. Sentry (по желанию): вписать DSN, `SENTRY_ORG`, `SENTRY_AUTH_TOKEN`,
   `SENTRY_VERIFY_ENABLED=true` — и проверить по
   `docs/SENTRY_STAGING_ACTIVATION_RU.md`.

---

## 7. Что знать заранее

- **Free-план**: сервисы засыпают после ~15 минут простоя и просыпаются
  30–50 секунд; бесплатная база живёт 30 дней. Для репетиционной среды это
  приемлемо, для production — нет.
- **`TRUST_PROXY`**: пока не задан, все запросы приходят с адреса роутера
  Render, то есть все клиенты делят один лимит запросов. Задавайте только
  тот адрес/подсеть, которые действительно знаете: голое число хопов код
  отвергает намеренно.
- **Медиа**: вне production драйвер хранения — локальная директория, а диск
  контейнера эфемерный. Загруженные картинки исчезнут при передеплое. Для
  постоянного хранения нужен S3-совместимый бакет (`MEDIA_STORAGE_*`).
- **SMS, push, эквайер**: в staging их нет, и это сознательно — код держит
  соответствующие boot-гарды только для `production`.
- **Демонстрация**: если нужен именно демо-стенд с выдуманными данными,
  копируйте `render.demo.yaml` в `render.yaml` на отдельной ветке и
  разворачивайте её; в staging `DEMO_MODE`/`DEMO_SEED` не включаются.
