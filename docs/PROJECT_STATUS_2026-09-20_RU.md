# Статус проекта TuTak: сколько осталось до запуска

Дата: 20.09.2026, 09:35 UTC. Все факты ниже перепроверены в этот час
(GitHub REST, Railway MCP, deploy-check), а не взяты из старых отчётов.

## 1. Задание

Владелец: «проверь всё, что возможно, и скажи, на каком этапе, сколько
процентов работы осталось для полного запуска проекта; что осталось с твоей
стороны и что с моей».

## 2. Что проверено сейчас (факты)

| Что | Факт | Источник |
| --- | --- | --- |
| `main` | `369eda1`, деплой в production 19.09 07:30 | GitHub, Railway |
| Production API | `/health` 200, `/health/ready` 200: database ok, redis ok, storage ok (S3); `demoMode: false` | deploy-check run 35501410728, 09:07 |
| Admin / Partner панели | 200 | тот же run |
| PR #60 (интеграция) | открыт, HEAD `2eac071`, mergeable clean, CI зелёный | GitHub |
| Ветка `claude/app-lock` (блокировка + карта) | `d47da59`, CI 5/5 зелёный, APK `apk-preview-62` | GitHub |
| GitHub ruleset на `main` | закрыт (PR обязателен, 5 required checks) | проверка №2 |
| Railway Wait for CI | `checkSuites: true` на tutak-api (admin/partner — проверка №3) | describe-service |
| PITR + restore | включён, RESTORE PASS 19.09 | `docs/RESTORE_VERIFY_2026-09-19_RU.md` |
| Viva SMS | tunnel up 08:46; реальный OTP получен владельцем 20.09 | deploy-check run 35500464102 |
| Human alerts | `ALERT_TELEGRAM_BOT_TOKEN` стоит, `ALERT_TELEGRAM_CHAT_ID` **нет**, тестовый alert не отправлен | list-variables |
| Uptime-probe и backup workflow | **ни одного запуска**: файлы есть только в PR #60, на `main` их нет, расписание не работает | actions/workflows: 0 runs; `git cat-file origin/main` |
| Данные production | users 11, partners 1 (PENDING_APPROVAL, `isActive=false`), partner_branches 0, purchases 0 | Railway-функция 08:23; restore verify |
| Seed-переменные | `SEED_BASELINE`, `SEED_ADMIN_PASSWORD` всё ещё на tutak-api | list-variables |
| `DEMO_MODE` | переменная есть, по поведению false | health |
| Sentry / metrics / OTel | не заданы (не блокер пилота) | list-variables |
| Юридические страницы | `/legal/*` выключены (`LEGAL_PAGES_ENABLED` не задан); тексты с плейсхолдерами `[OPERATOR]`, `[ADDRESS]`, `[CONTACT EMAIL]`; юрист не подключён | `docs/LEGAL_PAGES_HOSTING_RU.md` |
| iOS | только simulator-сборка; нет Apple Developer аккаунта → нет сборки на iPhone, TestFlight, APNs | `docs/IOS_BOOTSTRAP_REPORT_2026-09-19_RU.md` |
| Магазины | ни Google Play, ни App Store аккаунтов; инструкция готова (`docs/STORE_SUBMISSION.md`) | docs |
| Railway лишние сервисы | `Postgres-restored-20260919-1733` (том 50 ГБ) и `verify-restore-20260919` живы; удаление через API — таймаут ×4 | delete-service |
| Cash Out | отдельный продукт в этом же репозитории, ветка `claude/new-project-5wwjph`, в `main`/production не попадает | compare main...branch |
| Device review Samsung/Xiaomi | результатов нет ни по одной сборке | — |

## 3. Оценка в процентах

Два разных финиша, потому что «полный запуск» — это не одно событие.

### 3.1. Ограниченный пилот (прямые покупки + лояльность, без Idram/PSP/EV)

**Сделано ≈ 85 %.** Код, CI, сборки, инфраструктурные gates (ветка,
CI-ожидание, бэкап, SMS) — закрыты. Осталось ≈ 15 %, и почти всё это
действия, которые может сделать только владелец: проверить на телефонах,
дать Telegram chat id, завести первого партнёра, провести одну настоящую
покупку и возврат, назначить дежурного.

| Направление | Готово | Осталось |
| --- | --- | --- |
| Код и тесты (API, панели, мобильное) | 100 % | — |
| CI / сборки / релизы | 95 % | merge PR #60 и PR блокировки; production-APK из merge-SHA |
| Инфраструктура и безопасность | 80 % | chat id + тестовый alert; uptime/backup заработают после merge; убрать seed-переменные; удалить лишние сервисы |
| Данные и бизнес-процесс | 10 % | 0 активных партнёров, 0 филиалов, 0 покупок; нет дежурного |
| Проверка на устройствах | 0 % | Samsung + Xiaomi по чек-листам |

### 3.2. Публичный запуск (магазины, iOS, юридика)

**Сделано ≈ 55 %.** Продукт готов, дистрибуция и юридика — нет.

| Направление | Готово | Осталось |
| --- | --- | --- |
| Юридические документы | 20 % | юрист, реквизиты оператора, включить `/legal/*` |
| Google Play | 30 % | аккаунт ($25), листинг, data safety, privacy URL, ревью |
| App Store / iOS | 15 % | Apple Developer ($99), `eas credentials`, сборка на iPhone, TestFlight, APNs, ревью |
| Push на iOS | 0 % | после APNs |
| Платежи внутри TuTak (Idram) | выключено по решению владельца | не входит в запуск |
| Мониторинг (Sentry, uptime на `main`) | 50 % | Sentry DSN — по желанию; uptime — после merge |

## 4. Что осталось с моей стороны

Всё ниже либо ждёт ваших действий, либо занимает часы, а не дни:

1. **Merge PR #60** — только после закрытия ваших gates (chat id + тестовый
   alert подтверждён, device review). Затем post-merge проверка, production
   APK и iOS simulator RC из merge-SHA — по брифу FINAL GATES EXECUTION.
2. **PR блокировки + карты** (`claude/app-lock`) в `main` — после merge #60
   (rebase, CI, merge). Закрыть PR #52, #58, #59 как superseded.
3. **Тестовый alert в Telegram** — сразу, как появится `ALERT_TELEGRAM_CHAT_ID`
   (отправлю из Railway-функции, вы подтвердите получение).
4. **Убрать `SEED_BASELINE`/`SEED_ADMIN_PASSWORD`** — после того как вы
   смените пароль админа (иначе потеряем доступ).
5. **Удалить `Postgres-restored` и `verify-restore`** — через API не проходит
   (таймаут); если не получится у вас в дашборде, попробую ещё раз через
   staged-патч, который вы примените одной кнопкой.
6. Если device review найдёт дефекты — исправить. Реакция на находки — часы.
7. Держать watch-цикл (перепроверка gates раз в час) до merge.

## 5. Что осталось с вашей стороны

Для пилота (без этого merge и запуск невозможны):

1. **Telegram**: написать боту @SBLoyaltyBot любое сообщение и прислать мне
   chat id (или дать `ALERT_TELEGRAM_CHAT_ID` в Railway → tutak-api). Затем
   подтвердить, что тестовое сообщение пришло. Те же два значения — в
   GitHub Secrets (`ALERT_TELEGRAM_BOT_TOKEN`, `ALERT_TELEGRAM_CHAT_ID`)
   для uptime/backup.
2. **Проверка на Samsung и Xiaomi** `apk-preview-62`: блокировка
   (`docs/MOBILE_APP_LOCK_RU.md`, 10 шагов), карта (pinch, двойной тап,
   перетаскивание), общий чек-лист `docs/OWNER_DEVICE_TEST_RU.md`.
   Ответ «всё ок» или список дефектов.
3. **Первый партнёр**: одобрить «Artash / Aura» в админке
   (Partner applications → Approve) и добавить филиал с координатами в
   партнёрской панели (Locations). Без этого карта пуста у всех.
4. **Одна настоящая покупка + cashback + возврат** на production (кассир в
   партнёрской панели + клиент в приложении), по
   `docs/RUNBOOK_INCIDENTS_RU.md` §4 для возврата.
5. **Дежурный**: назначить человека на инциденты и второго с правами
   подтверждения (`PSP_RECONCILE` / `CONTRIBUTION_RULE_APPROVE`).
6. **Пароль админа** сменить, после чего я уберу seed-переменные.
7. **Railway**: применить удаление `verify-restore-20260919` (2FA) и удалить
   `Postgres-restored-20260919-1733` с томом 50 ГБ, если через API снова
   не пройдёт.
8. Решить, выносить ли Cash Out в отдельный репозиторий (рекомендую).

Для публичного запуска (можно параллельно, не блокирует пилот):

9. **Юрист + реквизиты оператора** (`docs/LEGAL_PACKAGE_FOR_LAWYER_2026-09-19.md`:
   8 документов, 12 вопросов).
10. **Google Play Console** (аккаунт $25) и **Apple Developer Program**
    ($99/год); для iOS — одноразовый `eas credentials` с ноутбука
    (`docs/IOS_RELEASE_PREP_2026-09-19.md`, `docs/APPLE_DEVELOPER_ACCOUNT_RU.md`).
11. Sentry DSN — по желанию.

## 6. Что НЕ сделано в этой проверке и ограничения оценки

- Значения переменных Railway вижу только по именам; `DEMO_MODE=false` и
  `PUSH_ENABLED` — по поведению, не по значению.
- Список GitHub Secrets прочитать не могу (нет прав) — судить о них можно
  только по тому, что uptime/backup ещё не запускались (их нет на `main`).
- Проценты — экспертная оценка объёма работы, а не измерение; цифры по
  «данным и бизнес-процессу» низкие потому, что там ноль реальных операций,
  а не потому, что это много работы.
- Ничего в production не менял.

## 7. UNVERIFIED

- Всё на реальных телефонах (Samsung, Xiaomi, iPhone).
- Доставка Telegram-алерта человеку.
- Поведение uptime/backup workflow на `main` (ещё не запускались).

## 8. Вопросы владельцу

1. Пилот запускаем с одним партнёром (Aura) или ждём ещё нескольких?
2. Кто дежурный и кто второй подтверждающий?
3. Юрист есть или искать?
