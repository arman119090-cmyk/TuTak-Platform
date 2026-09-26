# Staging — фактическое состояние и предложение (26.09.2026)

## Факт

- Render «Arman's workspace»: `tutak-staging-api/admin/partner/web`, ветка
  `claude/tutak-loyalty-mvp-e485jm` (последний коммит 19.09), autoDeploy
  включён у трёх сервисов, БД `tutak-staging-db` free-plan **истекает
  2026-09-29**. Дрейф от launch candidate — все коммиты Partner Commerce и
  settlement (~230 файлов); дрейф от production — production на `main@369eda19`,
  staging — на другой ветке. Как staging это непригодно.
- Production — Railway. Staging на другом провайдере с другой моделью
  переменных не отражает production.

## Предложение (OWNER DECISION, стоимость — Railway Hobby/Pro по числу сервисов)

Railway → проект TuTak → **новый environment `staging`** (Railway
environments клонируют состав сервисов, переменные задаются отдельно):

1. Сервисы: `tutak-api`, `tutak-admin`, `tutak-partner` с source branch
   `claude/tutak-launch-readiness-20260926` (или любой PR-ветки),
   `checkSuites: true`; свой Postgres и Redis (маленькие тома).
2. Переменные: копия production по именам, значения свои: `APP_ENV=staging`,
   `DEMO_MODE=true` допустимо, `SMS_DRIVER=console` или Viva с тестовым
   sender, `SEED_BASELINE=true`, `TUTAK_DEMO=1` для `seed-demo`, отдельный
   Telegram-чат, `EMERGENCY_FREEZE=false`, деньги выключены.
3. Данные: никогда не копия production (телефоны, хэши). Только
   `seed-baseline` + `seed-demo`. Для проверки миграций на «реалистичной»
   БД — восстановление production-дампа **в изолированный сервис с
   маскированием телефонов** (`UPDATE users SET phone = '+3740' || lpad(id::text…)`),
   отдельная процедура, не staging.
4. Smoke: `scripts/smoke-test.sh` с `API_URL=<staging api>/v1`; e2e Playwright
   (`tests/e2e`) с `API`/`ADMIN`/`PARTNER` на staging-адреса.
5. Render staging после этого — удалить (5 сервисов + БД) — OWNER.

До решения: локальный docker-compose стек (`scripts/demo-up.sh`) и CI-стек
(«Build the container images» поднимает всё и гоняет E2E) — единственный
staging-эквивалент, и он проверяется на каждом push.
