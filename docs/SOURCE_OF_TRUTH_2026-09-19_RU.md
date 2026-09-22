# Какие документы — источник истины (19.09.2026)

В `docs/` больше ста файлов; большинство — датированные отчёты о
конкретной задаче. Они полезны как история, но описывают состояние на свой
день. Ниже — документы, по которым надо действовать **сейчас**. Если
датированный отчёт противоречит документу из этого списка, прав документ
из списка.

| Тема | Источник истины | Примечание |
|---|---|---|
| Деплой production (Railway) | `docs/RAILWAY_PRODUCTION_CONTEXT*.md`, `docs/WAIT_FOR_CI_EXPERIMENT_RU.md` | три сервиса из `main`, Wait for CI ещё не включён |
| Готовность к пилоту, gates | `docs/PILOT_GATES.md`, `docs/PILOT_READY_REPORT*.md` (PR #58) + раздел «Manual gates» в `docs/FINAL_INTEGRATION_2026-09-19_RU.md` | |
| Восстановление после сбоя | `docs/DISASTER_RECOVERY_RUNBOOK_RU.md`, `scripts/verify-restored-db.sh` | restore ещё не отрепетирован |
| Инциденты | `docs/RUNBOOK_INCIDENTS_RU.md` | |
| SMS / Viva | `docs/SMS_VIVA_RU.md` (архитектура), `docs/VIVA_TUNNEL_RUNBOOK_RU.md` (туннель), `docs/SMS_STATUS_CHECK_2026-09-19.md` (**актуальный статус: туннель down**) | |
| iOS | `docs/IOS_RELEASE_PREP_2026-09-19.md`, `docs/APPLE_DEVELOPER_ACCOUNT_RU.md`, `docs/IOS_BOOTSTRAP_REPORT_2026-09-19_RU.md` | |
| Android-сборки | `.github/workflows/android-apk.yml` (шапка), `docs/ANDROID_DEVICE_TEST_RU.md` | |
| Визуальная система мобильного | `docs/TUTAK_PREMIUM_VISUAL_SYSTEM.md` | PASS 1–3 — текущее направление; PASS 4 не планируется |
| Idram / деньги | `docs/IDRAM_*`, флаги в `apps/api/.env.example` | все денежные флаги в production выключены |
| Регион Railway | `docs/RAILWAY_REGION_MIGRATION_RU.md` | SAFE TO MOVE AFTER PILOT |
| Переменные окружения API | `apps/api/.env.example` | полный список, что читает `configuration.ts` |
| Проверка устройства владельцем | `docs/OWNER_DEVICE_TEST_RU.md` | короткий список |

## Исторические снимки (не инструкция)

Отчёты с датой в имени (`*_2026-09-1x*.md`, `PREMIUM_VISUAL_REFINEMENT_*`,
`RAILWAY_SMS_DELIVERED_2026-09-10.md`, `PROJECT_AUDIT_2026-09-19_RU.md`,
`PREMIUM_FINAL_POLISH_2026-09-19.md` и подобные) — состояние на свой день.
В частности:

- `RAILWAY_SMS_DELIVERED_2026-09-10.md` — СМС **доставлялась** 10.09; это
  не значит, что доставляется сейчас (см. статус выше).
- Отчёты pass 1–3 и финальной доводки ссылаются на ветку
  `claude/premium-visual-refinement`; после интеграции актуальна ветка
  `claude/final-integration-20260919` и её PR.
- `PROJECT_AUDIT_2026-09-19_RU.md` перечисляет находки на `main` того
  дня; часть закрыта интеграцией (см. `FINAL_INTEGRATION_2026-09-19_RU.md`).
