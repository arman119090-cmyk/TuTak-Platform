# AI Handoff

Этот файл используется для передачи состояния работы между ChatGPT, Claude/Astra и другими агентами.

## Правила заполнения

После каждой существенной задачи агент должен обновить этот файл и указать только фактическое состояние.

Обязательно разделять:
- CONFIRMED
- ASSUMPTIONS
- NOT VERIFIED

Не помещать сюда секреты, токены, пароли, PSK, private keys, client secrets, DSN и другие чувствительные значения.

## Последний handoff

### STATUS
DONE — раунд 2 технического совета (ответ Claude на первый вопрос Simon).

### BASE
- base branch: `docs/railway-production-context`
- base SHA: `97f53e4`

### WORKING BRANCH
- branch: `docs/railway-production-context` (тот же; изменены только документы)

### CONFIRMED
- Прочитаны полностью: `AI_SHARED_CONTEXT.md`, `AI_TASK.md`, `AI_DISCUSSION.md`,
  `AI_HANDOFF.md`, `RAILWAY_PRODUCTION_CONTEXT.md` (478 строк, `e30175a`).
- Противоречие по `10064`: `RAILWAY_PRODUCTION_CONTEXT.md` §10 против
  `CHTO_OSTALOS_2026-09-02.md:47-49` (Partner ID, не API client_id).
- Противоречие по туннелю Viva: `RAILWAY_PRODUCTION_CONTEXT.md` §8 против
  `VIVA_GATEWAY_STATUS_RU.md:148,150` (оба GO/NO-GO — NO-GO).
- Прямой доступ к API Railway из среды Claude закрыт сетевой политикой:
  `403` на CONNECT к `backboard.railway.app` (GitHub из той же среды — `200`).
- `tutak-staging-db` (Render): план free, `expiresAt: 2026-09-29` — прочитано
  через Render API.
- Ветка совета основана на дереве **без** коммитов `b24e6ed` и `ee40202`
  (два исправления безопасности), которые лежат в
  `claude/project-context-session-history-9fj7pp`.

### CHANGES
- `docs/AI_DISCUSSION.md`: добавлен раздел «2026-09-07 — Claude» (семь
  пробелов протокола и поправки к ним). Старые записи не изменялись.
- `docs/AI_HANDOFF.md`: этот handoff.

### TESTS
- не запускались: код проекта в этом раунде не менялся (по условию задачи).

### COMMIT
- SHA: см. коммит с этим handoff в ветке `docs/railway-production-context`.

### ASSUMPTIONS
- Ни одно из двух противоречащих утверждений о Viva не считается верным до
  первичного подтверждения.

### NOT VERIFIED
- Фактическое состояние Railway (проект, сервисы, переменные, деплоенный SHA)
  — из среды Claude недостижимо, требуется коннектор Railway или доступ
  владельца к дашборду.
- Верность §8 и `10064` в `RAILWAY_PRODUCTION_CONTEXT.md`.

### NEXT ACTION
- Simon отвечает на три вопроса в конце раздела «2026-09-07 — Claude»
  в `docs/AI_DISCUSSION.md`. Поправки 1–7 остаются
  `PROPOSED — OWNER APPROVAL REQUIRED` до решения Армана.

## Шаблон следующего handoff

### STATUS
DONE / PARTIAL / BLOCKED / NOT VERIFIED

### BASE
- base branch:
- base SHA:

### WORKING BRANCH
- branch:

### CONFIRMED
- ...

### CHANGES
- file: причина изменения

### TESTS
- command: PASS/FAIL/NOT RUN

### COMMIT
- SHA:

### ASSUMPTIONS
- ...

### NOT VERIFIED
- ...

### NEXT ACTION
- один конкретный следующий шаг
