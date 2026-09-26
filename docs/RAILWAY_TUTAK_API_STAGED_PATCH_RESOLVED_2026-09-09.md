# Старый патч закрыт, остался один шаг до первого успешного деплоя — 09.09.2026

## Главный итог

Deploy из карточки `tutak-api` (3 изменения) применился именно так, как
показывал интерфейс — **точечно**, без затрагивания Postgres и Redis.

Проверка через API после деплоя:

| ресурс | было | стало |
|---|---|---|
| Окружение `production` | `staged: STAGED`, 40 изменений | **`staged: null`** — патча больше нет |
| Postgres | `live-with-staged-changes` | **`live`**, 0 staged, все переменные на месте (`DATABASE_URL`, `PGPASSWORD`, `POSTGRES_PASSWORD` и др. — присутствуют) |
| Redis | `live-with-staged-changes` | **`live`**, 0 staged, все переменные на месте (`REDIS_URL`, `REDISPASSWORD` и др. — присутствуют) |

Старая проблема с зависшим патчем с 1 сентября закрыта полностью. Мой
инструмент какое-то время показывал устаревшие данные (40 изменений,
неизменный таймстемп) — сейчас он тоже подтверждает чистое состояние.

## Новый деплой tutak-api — прогресс, но снова CRASHED

Деплой `9a99f287-a695-4101-b00e-74a857873cc7`:

- Подключение к Postgres — успешно, 51 миграция на месте, `No pending
  migrations to apply`.
- `SEED_BASELINE=true` — **успешно до конца**: `Seeding permissions... roles...
  temporary super admin user... Baseline seed complete.` Значит
  `SEED_ADMIN_PASSWORD` принят (≥12 символов, как и требовалось).
- Дальше падает сам NestJS при старте:

  ```
  Error: Invalid environment configuration:
  JWT_ACCESS_SECRET must be at least 32 characters
  JWT_REFRESH_SECRET must be at least 32 characters
  ```

Обе переменные **заданы** (иначе ошибка была бы "must be set"), но **короче
32 символов**. Это единственная оставшаяся причина падения.

## Что нужно сделать

В панели Railway → `tutak-api` → Variables → обновить `JWT_ACCESS_SECRET` и
`JWT_REFRESH_SECRET` на значения длиной от 32 символов каждое (и разные
между собой, как и было оговорено). Дальше должно повториться то же самое,
что сработало с секретами в этот раз — точечный Deploy из карточки сервиса,
Postgres/Redis он не затронет.

После этого — снова дайте знать, я проверю журнал запуска.
