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
DONE — PR с исправлениями границ сессии открыт в базовую ветку. Merge и deploy
не выполнялись (прямо запрещено постановкой задачи).

### PR
`#30` — https://github.com/arman119090-cmyk/TuTak-Platform/pull/30
`claude/session-security-fixes-20260907` → `claude/tutak-loyalty-mvp-e485jm`

### BASE
- base branch: `claude/tutak-loyalty-mvp-e485jm`
- base SHA: `f63b34fbaa687b571eb24dc394f2192929cb64fb`
- ветка-источник: `claude/project-context-session-history-9fj7pp`, SHA
  `306b92c97d99e7292d885808e92772521d9ba879`

### WORKING BRANCH
- branch: `claude/session-security-fixes-20260907`
- result SHA: `bac52361f9be79135227d862f68f7257ed7aa353`

### CONFIRMED
- В базовой ветке отсутствовали **все** четыре исправления. Проверено по дереву
  базовой ветки, а не по памяти: нет `sessionEpoch`, нет `device.updateMany`
  в `logout()`, нет `sessionLocale.ts`, `queryClient.ts`, `sessionCache.ts`.
- Базовая ветка является предком ветки-источника, поэтому пять cherry-pick
  (`-x`, исходные SHA сохранены в сообщениях) применились **без единого
  конфликта**. Ручных разрешений не было.
- Security-контроли после объединения на месте: `sessionEpoch` во всех трёх
  сторах и в общем веб-клиенте; обнуление `pushToken` в `logout()` для пары
  `(userId, deviceId)`; модули очистки кэша и языка сессии.
- CI на этом SHA (`bac52361`, run #432, событие push): **success**.
- Локальные 4 падения в `production-boot.int-spec.ts` — артефакт стенда, а не
  регрессия: воспроизводятся идентично на чистом дереве и зелёные на CI.

### CHANGES
Cherry-pick пяти коммитов, изменений поверх них не вносилось:
- `b24e6ed` — `sessionEpoch` в мобильном/admin/partner сторах, охраняемый
  `setTokens`, эпоха-помеченный refresh, очистка кэша при смене сессии.
- `1600a43` — отчёт по этим исправлениям.
- `d034e17` — аудит границы сессия/устройство (находки A-1, A-2).
- `ee40202` — обнуление push-токена в `logout()`; язык следует за аккаунтом
  через существующий `PATCH /users/me`; маршрут в mock-адаптере демо.
- `3e9889e` — отчёт по этим исправлениям.

Намеренно **не включены** как не относящиеся к теме PR: `cdb1af7` (чеклист
первого деплоя Railway) и `306b92c` (оценка готовности к запуску).

### TESTS
| Проверка | Результат |
|---|---|
| API unit | PASS — 505/505, 34 сюиты |
| API integration | 1078 PASS, 4 FAIL (только `production-boot`, см. CONFIRMED) |
| `push-logout.int-spec.ts` | PASS — 7/7 |
| mobile jest (полный) | PASS — 346/346, 42 сюиты |
| admin jest (полный) | PASS — 72/72, 11 сюит |
| partner jest (полный) | PASS — 65/65, 10 сюит |
| Поведенческие сюиты (сессия/кэш/язык) | PASS — mobile 16/16, admin 12/12, partner 3/3 |
| `pnpm typecheck` | PASS — exit 0 |
| `pnpm lint` | PASS — exit 0, 0 замечаний |
| `pnpm build` (api + admin + partner) | PASS — exit 0, 3/3, `dist/main.js` и маршруты обоих кабинетов |
| `scripts/build-demo-app.sh` + drift | PASS — `git diff -- demo` пуст |
| CI на ветке (run #432) | PASS — success |

### COMMIT
- SHA: `bac52361f9be79135227d862f68f7257ed7aa353`

### ASSUMPTIONS
- Отбор коммитов «только необходимое» интерпретирован как: код исправлений +
  два отчёта, документирующих именно их, + аудит, на который эти отчёты
  ссылаются. Если требуется более узкий PR — сообщите, пересоберу.

### NOT VERIFIED
- Поведение на реальном развёртывании: PR никуда не деплоился.
- Ручная проверка на физическом устройстве не проводилась; всё доказательство —
  автоматические тесты.
- Прогон CI, запущенный событием `pull_request` (run #433), на момент записи
  ещё шёл; подтверждён только прогон на том же SHA от события `push`.
- Состояние Railway из среды Claude по-прежнему недостижимо (сетевая политика).

### NEXT ACTION
- Ревью и решение по PR #30. Merge и deploy агентом не выполняются.
- Отдельно, вне этой задачи: Simon ответил раундом 2 в **отдельном файле**
  `docs/AI_DISCUSSION_SIMON_ROUND_2.md`, а не в конце `AI_DISCUSSION.md` —
  журнал совета фрагментирован, стоит свести в один файл. Ответ Claude на его
  вопрос о security-процедуре ещё не написан.

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
