# Исправления по аудиту 20.09.2026

## Задание

Владелец: «То, что ты нашёл во время аудита и можешь исправлять, исправь,
пожалуйста, все». Источник — `docs/SYSTEM_AUDIT_2026-09-20_RU.md`.
Исправлялось только то, что не требует действий владельца и не трогает
production.

## База

| | |
| --- | --- |
| Ветка | `claude/audit-fixes-20260920` от `main` `369eda1` |
| Почему от `main`, а не от RC | правки касаются API, CI и документов и нужны независимо от PR #60; при merge #60 первым конфликт возможен только в `.env.example` (обе ветки дописывают его в конец) |

## Что сделано

### H3.1. Фоновые задачи больше не «падают навсегда после 0 попыток»

- `apps/api/src/modules/sweeps/sweeps.scheduler.ts`: каждый sweep
  регистрируется с `SWEEP_JOB_OPTS` — 5 попыток, экспоненциальный backoff
  от 5 с (5 + 10 + 20 + 40 с ≈ 75 с ожидания, больше 70-секундного обрыва
  19.09), `removeOnComplete: 20`, `removeOnFail: 50`. Раньше опций не было,
  действовал default BullMQ `attempts: 0`: первый бросок был финальным.
- `sweeps.processor.ts`: `max = Math.max(attempts ?? 1, 1)`, чтобы в логе
  и алерте не было «after 0 attempt(s)».
- Новый тест `sweeps.scheduler.spec.ts` (3): каждая задача получает
  attempts и backoff; суммарное ожидание > 70 с; чужие расписания
  удаляются. Sweeps идемпотентны по конструкции (distributed lock,
  перечитывание состояния), повтор безопасен.

### M2. `.env.example` API

Дописаны 49 переменных с дефолтами из кода и пояснениями (Telegram-алерты,
ротация JWT, демо, legal-флаг, пул покупки в bps, отложенный бонус,
реферальный челлендж, таймаут intent, grace удаления аккаунта, лимиты OTP
по IP, retention, Viva SMS, медиа-хранилище, prepaid, Idram). 11
переменных нагрузочных скриптов перечислены комментарием. Было 65,
стало 114 описанных из 120 читаемых (остальные 6 — только скрипты).

### M9. Покрытие в CI

`.github/workflows/ci.yml`: шаги «Unit tests» (API) и «Mobile tests»
запускаются с `--coverage`, сводка печатается в лог, `lcov.info`
выкладывается артефактом на 14 дней. Порог не ставится: сначала
измерить. Панели admin/partner не тронуты (их скрипт `test` — это
`jest && node --test`, флаг ушёл бы не туда).

### H1 (частично). Личные данные в документах

Из `docs/RAILWAY_STATUS_2026-09-09.md` убран e-mail владельца аккаунта
Railway. IP VPS (`217.76.49.94`) оставлен: он — идентичность IPsec-туннеля
в `infra/viva-gateway/*`, и без него runbook неисполним; закрывается
только приватностью репозитория (действие владельца).

### M7. Гигиена GitHub

- Закрыты PR #58 и #59 (входят в #60) и PR #52 (отклонён владельцем
  19.09), с комментариями.
- Закрыты issues #1–#27 (заголовки плана от 06.08, без движения) как
  «not planned», объяснение в комментарии к #2. #28 оставлена.
- `docs/README.md`: добавлены аудит и отчёт по сцене с Жако.

## Что НЕ сделано

- **Удаление 22 веток, уже влитых в `main`**: `git push --delete` из этой
  среды обрывается прокси (`unexpected disconnect`), инструмента удаления
  веток в GitHub MCP нет. Список с SHA для ручного удаления
  (Settings → Branches или `git push origin --delete <name>`):

  ```
  audit/pilot-pr1-qr-purchaseintent-20260912 45a4937
  audit/pilot-pr3-infra-observability-20260912 5685506
  claude/android-keyboard-diagnostics-20260908 826211e
  claude/dashboard-noindex-20260907 429fc7a
  claude/map-pan-fix 98c26b6
  claude/money-audit 4c97555
  claude/session-security-fixes-20260907 371dfce
  claude/tutak-staging-flow-check-hl97qh 8686c97
  demo/new-design-mobile 6faee35
  deploy/railway-api-df1fd99 df1fd99
  feat/map-real-location bfdad2a
  feat/map-tile-provider 6dbfc7e
  feat/purchase-intent-confirmation-code 5596854
  feat/purchase-intent-customer-cancel f7f90a5
  feat/refund-dual-control ee06a50
  feat/refund-queue-ui 1aa2edf
  feat/registration-set-password 6cf7c9a
  feat/staff-identity-audit 3618342
  fix/media-and-attempt-races 882b259
  fix/mobile-api-base-url-railway 363e592
  fix/refund-decision-races 98f0bde
  fix/viva-gateway-path-signing 3060a53
  ```

  `recovery/*` и `release/rc-1` тоже влиты, но оставлены намеренно.
- **Overrides уязвимых зависимостей** (qs, xmldom, js-yaml) не
  дублировал: они уже в PR #60; второй lockfile с теми же правками дал бы
  конфликт. `image-size` без патча, `decode-uri-component` — обновление до
  0.5 ломает контракт `query-string`.
- **H3.2, причина деплоя Postgres 19.09 17:31**: Railway отдаёт для него
  `diagnosis: null`, `failedReason: null` — это штатный успешный деплой
  без указания инициатора. Ответ только в панели Railway у владельца.
- **NestJS 12, minor-обновления** — после пилота, отдельным PR с полным
  прогоном.
- Всё, что требует владельца: приватность репозитория, chat id, удаление
  двух сервисов Railway, seed-переменные, Sentry DSN, юрист, регион.
- Uptime и backup workflow-ы придут с merge PR #60; дублировать их сюда
  не стал.

### Собственные ошибки по ходу

- Первая версия теста упала на типах (`ConfigService` без generics,
  `SWEEPS[0]` possibly undefined) — исправлено.
- `pnpm typecheck` API сначала упал на `PROMO_ARTWORK`: Prisma-клиент в
  `node_modules` был сгенерирован по схеме ветки Jako. Перегенерировал по
  схеме `main`.
- Пытался закрыть PR инструментом для issues — GitHub их различает;
  закрыл через инструмент PR.

## Чем доказано

| Проверка | Результат |
| --- | --- |
| `pnpm typecheck` (API, build + spec) | exit 0 |
| `eslint` на изменённых файлах | 0 |
| `jest --selectProjects unit sweeps.scheduler.spec` | 3/3 |
| CI на ветке | см. PR (запускается пушем) |

## UNVERIFIED

- Поведение повторов на реальном Redis/BullMQ под обрывом БД: проверено
  только контрактом (опции на расписании). Интеграционный `sweeps.int-spec`
  прогонит CI.
- Полный unit-прогон API локально не делал (в прошлый раз упёрся в лимит
  времени сессии), полагаюсь на CI.

## Вопросы владельцу

1. Удалить 22 ветки из списка выше (или дать добро, и я повторю, когда
   прокси позволит).
2. Оставить ли PR #29 (draft дизайн-handoff от 30.08) открытым?
