# Первый успешный деплой tutak-api — 09.09.2026

## Итог

`tutak-api` поднялся и работает. Деплой `c12159ce-3477-4a05-9799-fbe7983f9311`
— `SUCCESS`. Все три сервиса в окружении `production` сейчас `online`, без
предупреждений и ошибок:

| сервис | статус | реплики |
|---|---|---|
| tutak-api | online | 1/1 |
| Postgres | online | 1/1 |
| Redis | online | 1/1 |

Домен: `https://tutak-api-production.up.railway.app` (порт 4000, управляется
Railway).

## Что подтверждено журналом старта

- `Nest application successfully started`, `TuTak API listening on port 4000`.
- Маршруты подключены, включая `/health`, `/health/ready`, `/metrics`.
- 13 периодических задач запланировано (`SweepsScheduler`).
- Печатается баннер:
  ```
  DEMO MODE — no real money can move through this instance
  Payments run on the sandbox acquirer: every charge is simulated...
  Every other protection is on: CORS allowlist, security headers, rate limits,
  secret validation.
  ```
  Это подтверждает: `DEMO_MODE=true` реально активен и виден в логе, как и
  требовал план.
- `SMS transport: budgeted:unavailable` — транспорт SMS помечен недоступным
  (ожидаемо: Viva ещё не подключена). Отмечу расхождение с планом: в плане
  ожидалась строка вида `SMS transport: unavailable` уровня `error`; по факту
  формулировка `budgeted:unavailable` и уровень `info`. По смыслу то же самое
  (транспорта нет), но стоит иметь в виду при переходе к шагу с Viva — если
  после включения Viva транспорт всё ещё будет показывать `unavailable`,
  сверяемся по этому же полю.
- Строка «SMS codes are written to this log» — **отсутствует**, как и
  требовалось.

## Что я не смог проверить сам

Прямой HTTP-доступ к публичному домену `tutak-api-production.up.railway.app`
из этой рабочей среды заблокирован сетевым прокси (egress blocked) — не
хватает исходящего доступа к интернету за пределами GitHub/Railway API.
Поэтому два пункта из плана нужно проверить вам вручную, открыв ссылки в
браузере:

1. **`https://tutak-api-production.up.railway.app/health`** — ожидается
   `{"status":"ok","demoMode":true}` по HTTPS.
2. **`POST https://tutak-api-production.up.railway.app/v1/auth/demo-session`**
   — ожидается **404** (переменная `DEMO_PASSWORD` не задавалась, значит
   маршрут должен быть выключен). Проверить можно через `curl -i -X POST ...`
   или Postman/Insomnia — из браузерной адресной строки POST не отправить.

Если оба пункта подтвердятся — первый деплой (шаг 4 плана, без Viva) закрыт
полностью.

## Дальше по плану

1. Подтвердить `/health` и `POST /v1/auth/demo-session` (см. выше).
2. Шаг 1 из общего плана — проверка `_prisma_migrations` на чистоту базы —
   фактически уже пройден: в логах первого деплоя (21:01) база была пуста и
   применила все 51 миграцию с нуля. Отдельно перепроверять не нужно.
3. Переходим к шагу 5 — переменные Viva, второй деплой.
