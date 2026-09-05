# Первый деплой на Railway — чеклист под сегодняшнее решение

Ветка `claude/tutak-loyalty-mvp-e485jm` (commit `f63b34f` и позже). Решение
владельца (2026-09-05):

* **Домен:** `tutak.am` куплен будет, но **ещё не куплен** — значит первый
  подъём неизбежно идёт на Railway-сгенерированных доменах, миграция на
  `tutak.am` — отдельным шагом ниже, когда домен будет куплен и DNS настроен.
* **SMS:** реальный канал Viva/Contabo не готов (см. `VIVA_GATEWAY_STATUS_RU.md`
  — там весь GO/NO-GO красный) → первый деплой поднимается с
  `APP_ENV=staging`. SMS честно недоступен (`UnavailableSmsProvider`), сервис
  не падает.

Ничего из значений ниже не выдумано — источник: `RAILWAY_ENV_CONTRACT_RU.md`
и `RAILWAY_READINESS_2026-09-03.md`.

---

## Шаг 1 — поднять API, получить домен

Задать на сервисе API в Railway:

```
APP_ENV=staging
NODE_ENV=production

DATABASE_URL=<из Railway Postgres, обычно уже проброшен как reference>
REDIS_URL=<из Railway Redis, обычно уже проброшен как reference>

JWT_ACCESS_SECRET=<сгенерировать: openssl rand -hex 32>
JWT_REFRESH_SECRET=<сгенерировать: openssl rand -hex 32, ДРУГОЕ значение>

SEED_ADMIN_PASSWORD=<временный пароль ≥ 12 символов>
SEED_BASELINE=true

SMS_GLOBAL_MAX_PER_HOUR=500
SMS_GLOBAL_MAX_PER_DAY=5000

CLIENT_IP_STRATEGY=xff-depth
CLIENT_IP_TRUSTED_HOPS=1
```

`SMS_ENDPOINT` и `SMS_DRIVER` — **не задавать**. При `APP_ENV=staging` это не
уронит сервис (см. §2 контракта): вместо `throw` включается
`UnavailableSmsProvider`.

`DEMO_SEED` — **не задавать** ни в каком виде.

`MEDIA_STORAGE_DRIVER` / S3-переменные / `PUSH_ENABLED` под `staging` не
обязательны (сняты вместе с блокировкой production-guard'ов) — можно оставить
пустыми на этом шаге.

Включить Networking → Generate Domain на сервисе API. Записать выданный
домен, например `tutak-api-production.up.railway.app`.

---

## Шаг 2 — получить домены admin и partner

Сделать Generate Domain и для сервисов admin и partner тоже (до их успешного
деплоя это доступно — сеть не зависит от здоровья контейнера). Записать оба
домена.

---

## Шаг 3 — дозаполнить API теми доменами, что уже есть

```
CORS_ORIGINS=https://<домен admin>,https://<домен partner>
MEDIA_PUBLIC_BASE_URL=https://<домен API>
AUTH_COOKIE_SAMESITE=none
NEXT_PUBLIC_SENTRY_ENVIRONMENT=production
```

`AUTH_COOKIE_SAMESITE=none` — обязательно на сгенерированных доменах: без
этого сессия в кабинетах тихо умирает через ~15 минут (refresh-cookie не
уходит между разными `*.up.railway.app`).

Передеплоить API.

---

## Шаг 4 — собрать admin и partner с правильным API-адресом

На **обоих** сервисах (admin, partner):

```
NEXT_PUBLIC_API_BASE_URL=https://<домен API>/v1
NEXT_PUBLIC_SENTRY_ENVIRONMENT=production
```

`NEXT_PUBLIC_API_BASE_URL` — build-time переменная, без неё сборка падает
специально (`ApiBaseUrlNotConfiguredError`). Пересобрать оба сервиса после
задания переменной — простого редеплоя недостаточно, нужна именно пересборка
образа.

---

## Шаг 5 — вход и проверка

* URL: `https://<домен admin>`
* Телефон: `+37400000000`
* Пароль: тот, что указан в `SEED_ADMIN_PASSWORD`
* Система сразу потребует сменить пароль (`mustChangePassword`).

После первого входа и смены пароля `SEED_BASELINE` можно выключить.

Обычная OTP-регистрация клиентов работать не будет, пока не подключён SMS —
это ожидаемо на этом шаге.

---

## Шаг 6 — когда `tutak.am` куплен и DNS настроен

Не раньше, чем шаги 1–5 пройдены и кабинеты подтверждённо работают на
Railway-доменах:

1. В Railway → Custom Domain для каждого из трёх сервисов: `api.tutak.am`,
   `admin.tutak.am`, `partner.tutak.am` (или похожая схема) — Railway выдаст
   CNAME/A-записи, прописать их у регистратора.
2. На API поменять:
   ```
   CORS_ORIGINS=https://admin.tutak.am,https://partner.tutak.am
   MEDIA_PUBLIC_BASE_URL=https://api.tutak.am
   AUTH_COOKIE_SAMESITE=strict
   ```
   (`strict` можно вернуть, потому что все три поддомена под одним
   registrable-доменом `tutak.am` — это уже не разные сайты для браузера).
3. Передеплоить API.
4. На admin и partner:
   ```
   NEXT_PUBLIC_API_BASE_URL=https://api.tutak.am/v1
   ```
   и пересобрать оба.
5. Замерить `CLIENT_IP_TRUSTED_HOPS` заново на новом домене
   (`RAILWAY_PRODUCTION_RUNBOOK_RU.md §9`) — топология не должна была
   поменяться, но проверить дешевле, чем гадать.
6. Мобильный APK пересобрать с `API_BASE_URL=https://api.tutak.am/v1` —
   до реального домена этого не делаю намеренно (см. §11 в
   `RAILWAY_READINESS_2026-09-03.md`).

---

## Когда будет готов Viva/Contabo

Отдельный порядок уже описан в `RAILWAY_READINESS_2026-09-03.md §12` — коротко:
задать `SMS_VIVA_*` секреты в Railway (не в git), уточнить у Viva
`SMS_VIVA_NUMBER_FORMAT`, направить `SMS_ENDPOINT` на Contabo-шлюз, включить
`SMS_DRIVER=viva`, проверить доставку на реальный номер до анонса.

Пока это не сделано, `APP_ENV` можно оставить `staging` сколько угодно долго —
это осознанный, а не временный-забытый выбор: единственная его цена —
недоступность SMS, а не ослабление какой-либо другой защиты.
