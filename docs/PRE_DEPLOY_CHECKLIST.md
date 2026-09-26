# TuTak — Pre-deploy checklist (Railway production)

Проходить перед каждым merge в `main` (Railway деплоит `main` автоматически
после зелёного CI). Отмечает владелец или дежурный; агент готовит пункты 1–6.

## Перед merge

1. [ ] CI на head PR зелёный: Lint/test/build, Integration 1–3, Build images (E2E + backup rehearsal).
2. [ ] Diff прочитан целиком: нет `.only`/`.skip` в тестах, нет `console.log` в `apps/api/src` (кроме scripts), нет TODO/FIXME по деньгам.
3. [ ] Миграции: только additive/expand; для каждой новой — отвечено «что случится, если откатить код, а миграция останется» (код n должен работать со схемой n+1).
4. [ ] Новые переменные окружения задокументированы в `docs/PRODUCTION_RUNBOOK.md` §2 и `.env.example`; **заданы в Railway до merge**, если без них boot падает (`env.validation.ts`).
5. [ ] Флаги денег не тронуты: `TUTAK_PSP_ENABLED`, `PSP_REFUNDS_ENABLED`, `CARD_PAYMENTS_ENABLED`, `CUSTOMER_PREPAID_TOPUP_ENABLED` отсутствуют/false; `DEMO_MODE=false`.
6. [ ] Нет демо-учёток и тестовых секретов в production переменных (`DEMO_PASSWORD`, `DEMO_SEED`, `TUTAK_DEMO` — не заданы).
7. [ ] Известен deployed SHA до релиза (Railway → Deployments → commitHash) — для отката.

## Сразу после деплоя (5 минут)

8. [ ] Все три сервиса `SUCCESS`; `/health/ready` = 200.
9. [ ] Лог api: «Nest application successfully started», «Alerts will be delivered by Telegram», нет `ERROR` при старте, нет `Request rate limiting is STOOD DOWN`.
10. [ ] Миграции применились (лог entrypoint `prisma migrate deploy` без ошибок).
11. [ ] Admin и Partner открываются, логин работает; `NEXT_PUBLIC_API_BASE_URL` указывает на api (CSP `connect-src`).
12. [ ] Одна покупка bonus-only на пилотном партнёре (тест-клиент) прошла; ledger sum = 0 (`/admin/ledger/accounts`).

## Откат

13. Railway → tutak-api → Deployments → предыдущий SUCCESS → Redeploy (то же для admin/partner при необходимости). Миграции не откатывать. Записать в `docs/PRODUCTION_RUNBOOK.md` §6, что случилось.
