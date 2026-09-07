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

Структура AI collaboration создана. Активная техническая задача ещё не записана.

### Branch
`docs/railway-production-context`

### Shared files
- `docs/AI_SHARED_CONTEXT.md`
- `docs/AI_TASK.md`
- `docs/AI_HANDOFF.md`
- `docs/RAILWAY_PRODUCTION_CONTEXT.md`

### Что должен сделать следующий агент
1. Прочитать `docs/AI_SHARED_CONTEXT.md`.
2. Прочитать `docs/AI_TASK.md`.
3. Проверить фактический HEAD/branch и состояние репозитория.
4. Выполнить задачу только в указанном scope.
5. Обновить этот handoff после завершения.

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
