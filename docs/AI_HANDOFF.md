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
DONE — доработка PR #30 по четырём нарушениям границ сессии, найденным
независимой проверкой head `bac52361`. PR не слит и никуда не задеплоен.

### PR
`#30` — https://github.com/arman119090-cmyk/TuTak-Platform/pull/30
`claude/session-security-fixes-20260907` → `claude/tutak-loyalty-mvp-e485jm`

### BASE
- base branch: `claude/tutak-loyalty-mvp-e485jm`, SHA `f63b34fb`
- предыдущий head PR: `bac52361f9be79135227d862f68f7257ed7aa353`

### WORKING BRANCH
- branch: `claude/session-security-fixes-20260907`
- result SHA: `d8ef8e7f002db9842a544e33f777295b4027eb04`

### CONFIRMED
Все четыре замечания проверяющего подтверждены чтением кода и воспроизведены
падающими тестами **до** написания правки:

1. **Поздний исходный 401.** Эпоха читалась в момент прихода ответа, а не
   отправки запроса: 401 по запросу A, пришедший после входа B, приводил к
   refresh сессии B и повтору запроса A с токеном B. Оба клиента теперь
   ставят штамп сессии на запрос при отправке и при несовпадении отклоняют
   без refresh и без replay.
2. **Поздний `restoreSession`.** Результат записывался безусловно и мог
   переписать сессию, вошедшую во время восстановления, вместе с личностью.
   Защищены обе ветки записи, включая tokens-only.
3. **Позднее сохранение профиля.** Ответ сливался в захваченный объект
   пользователя, из-за чего профиль A попадал в стор с токеном B. `setUser`
   заменён на `patchUser(patch, expectedEpoch)`; тот же дефект был в загрузке
   и удалении аватара и в обоих переключателях согласия — переведены тоже.
4. **Гонка компенсационной записи** (внесена в `ee40202`): repair
   восстанавливал storage из памяти, которая сама могла быть уже разлогинена.
   Компенсация удалена; записи в ключи сессии сериализованы одной очередью и
   перепроверяют эпоху в момент выполнения.

Доказательство, что тесты описывают дефекты, а не подогнаны: при откате
исходников к `bac52361` с сохранёнными новыми тестами падают mobile 5/14,
admin 4/14, partner 1/4.

Побочно: подписка `sessionLocale` была завязана на эпоху и сломалась от
нового порядка внутри `setSession` (эпоха занимается раньше, чем появляется
пользователь). Регрессию поймали существующие тесты; подписка переписана на
идентичность пользователя. Ни один тест не отключён.

### CHANGES
- `apps/mobile/src/data/stores/authStore.ts` — очередь записей, проверка эпохи
  при выполнении, `patchUser` вместо `setUser`, без компенсации.
- `apps/mobile/src/data/api/httpClient.ts` — штамп сессии на запросе.
- `packages/design/src/web/httpClient.ts` — то же для обоих кабинетов +
  защита `restoreSession`.
- `apps/mobile/src/app/i18n/sessionLocale.ts` — подписка по пользователю.
- `apps/mobile/src/presentation/components/AvatarControl.tsx`,
  `.../screens/settings/SettingsScreen.tsx` — переход на `patchUser` с
  эпохой, снятой до отправки запроса.
- Тесты: `authStore.race.test.ts` (новый), `httpClient.session.test.ts`
  (mobile), `httpClient.session.test.ts` и `restoreSession.test.ts` (admin),
  `session.test.ts` (partner).
- `demo/**` перегенерирован. `apps/api` не изменялся (0 файлов).

### TESTS
| Проверка | Результат |
|---|---|
| mobile jest (полный) | PASS — 353/353, 43 сюиты |
| admin jest (полный) | PASS — 76/76, 11 сюит |
| partner jest (полный) | PASS — 65/65, 10 сюит |
| API unit (санити, код не менялся) | PASS — 505/505 |
| mobile typecheck / lint | PASS — exit 0 / exit 0 |
| монорепо typecheck / lint | PASS — exit 0 / exit 0 |
| `scripts/build-demo-app.sh` + drift | PASS — `git diff -- demo` пуст |
| CI на `d8ef8e7`, run #435 (push) | PASS — success |
| CI на `d8ef8e7`, run #436 (pull_request) | PASS — success |

### COMMIT
- SHA: `d8ef8e7f002db9842a544e33f777295b4027eb04`

### ASSUMPTIONS
- Замечание 3 расширено с языка на аватар и оба переключателя согласия: там
  тот же дефект того же класса. Расширение сделано осознанно и названо здесь.

### NOT VERIFIED
- Гарантии упорядочивания `expo-secure-store` на реальном устройстве не
  проверялись — устройства нет. Исправление от них больше не зависит:
  сериализация и проверка эпохи при выполнении дают один результат при любом
  чередовании. Воспроизведение — на асинхронном storage adapter, как у
  проверяющего.
- Ручная проверка на физическом устройстве не проводилась.
- Поведение на реальном развёртывании: PR никуда не деплоился.
- Полный интеграционный набор API локально в этом раунде не гонялся
  (`apps/api` не изменялся); он входит в зелёный прогон CI.

### NEXT ACTION
- Ревью и решение по PR #30. Merge и deploy агентом не выполняются.
- Не закрыто с прошлого раунда: журнал совета фрагментирован
  (`AI_DISCUSSION_SIMON_ROUND_2.md` отдельным файлом), и ответ Claude на
  вопрос Simon о security-процедуре не написан.

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
