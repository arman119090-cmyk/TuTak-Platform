# AI Shared Context — TuTak

Этот файл — общая точка контекста для ChatGPT, Claude/Astra и других агентов, работающих с репозиторием TuTak.

## Правила

- Перед существенной работой читать этот файл и релевантные документы из `docs/`.
- Не считать старые предположения актуальными без проверки репозитория/инфраструктуры.
- Не повторять уже доказательно закрытые расследования.
- Разделять CONFIRMED / ASSUMPTION / NEEDS VERIFICATION.
- Не раскрывать и не коммитить секреты, токены, пароли, PSK, private keys, client secrets, DSN.
- Не делать destructive production changes без явного разрешения пользователя.
- Не смешивать unrelated изменения в одном коммите.
- После изменений запускать релевантные тесты и фиксировать результаты.

## Текущие ключевые источники истины

- Репозиторий: `arman119090-cmyk/TuTak-Platform`
- Базовая рабочая ветка для текущих задач: `claude/tutak-loyalty-mvp-e485jm`
- Android RCA: `docs/ANDROID_INPUT_RCA_2026-09-03.md`
- Railway context: `docs/RAILWAY_PRODUCTION_CONTEXT.md` (если доступен в рабочей ветке)
- Текущая задача: `docs/AI_TASK.md`
- Передача результата между агентами: `docs/AI_HANDOFF.md`

## Общая архитектура

- `apps/api` — NestJS backend
- `apps/mobile` — Expo / React Native
- `apps/admin` — Next.js
- `apps/partner` — Next.js
- `packages/design`, `packages/i18n`, `packages/shared-types`
- PostgreSQL + Prisma
- Redis / BullMQ
- Railway — основная production-платформа
- Contabo VPS — network gateway для Viva IPsec
- Viva Business Hub — transactional SMS

## Git-процесс

Для существенной задачи:
1. Создать отдельную рабочую ветку от согласованной base branch.
2. Зафиксировать base SHA и clean/dirty state.
3. Выполнить только scope задачи.
4. Прогнать релевантные тесты.
5. Обновить `docs/AI_HANDOFF.md`.
6. В handoff указать commit SHA, изменённые файлы, тесты, доказанные факты, незакрытые пункты и точный следующий шаг.

## Взаимодействие агентов

Пользователь не должен переносить большие тексты вручную.

Агент, который получает задачу:
- сначала читает `docs/AI_SHARED_CONTEXT.md`;
- затем `docs/AI_TASK.md`;
- затем все файлы, явно указанные в `AI_TASK.md`;
- после работы обновляет `docs/AI_HANDOFF.md`.

Следующий агент:
- читает `AI_SHARED_CONTEXT.md`;
- читает `AI_HANDOFF.md`;
- проверяет фактическое состояние репозитория;
- не доверяет handoff слепо, если его можно проверить кодом/tests.
