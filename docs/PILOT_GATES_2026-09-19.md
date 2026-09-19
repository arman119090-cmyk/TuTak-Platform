# Закрытие launch blockers → готовность к ограниченному пилоту

Дата: 19.09.2026
Задание: последовательно закрыть каждый реально оставшийся launch blocker
после полного аудита и довести TuTak до состояния, когда можно провести
ограниченный production pilot DIRECT + loyalty/referrals без Idram и без
live EV; по фактическому состоянию main/GitHub/Railway; новые дефекты —
исправлять с regression-тестами; реальные деньги не включать.

База: `main` = `369eda1` (не менялся за задачу). Рабочая ветка
`claude/railway-connector-check-wy0ffq` → PR #58 (head `9af3278`).
Ветка PR #52 перенесена на main (`1c2fc90`).

Статусы: CLOSED / BLOCKED BY ARMAN / BLOCKED BY EXTERNAL PARTY / FAILED.

---

## 1. Состояние после аудита (перепроверено, не из отчёта)

| Что | Факт |
|---|---|
| `main` | `369eda1`; CI #791 зелёный (5/5 job) |
| APK build из `main` | run #58 SUCCESS → релиз `apk-production-apk-58`: commit `369eda1`, API `https://tutak-api-production.up.railway.app/v1`, профиль `production-apk`, SHA-256 `364d9185…62c8b`, 127 117 398 байт |
| PR #58 (launch-load + отчёт аудита) | открыт; на head `2152ec1` все 10 check-runs зелёные; после новых коммитов (`c321e31`, `9af3278`) CI перезапущен |
| Railway API/Admin/Partner | все SUCCESS на `369eda1`, online, 0 issues |
| Restart policy API | `ALWAYS` (подтверждено `get-service-config`) |
| `checkSuites` | `false` на tutak-api (и на admin/partner) |
| `DEMO_MODE` | переменная существует; **значение по поведению = false**: в логе старта деплоя `f94d56eb` нет баннера «DEMO MODE», который `main.ts` печатает при `true`; `PaymentsModule` не смонтирован (`CARD_PAYMENTS_ENABLED` отсутствует); `/auth/demo-session` отвечает 404 при `demoMode=false` |
| `ALERT_WEBHOOK_URL` | отсутствует |
| `SENTRY_DSN` | отсутствует |
| Production Postgres backup | ни PITR, ни расписания volume-backups не видно через API; переменных `WAL_ARCHIVE_*` на сервисе Postgres нет → PITR **выключен** |

## 2. Таблица gates

| Gate | До | Что сделал | Доказательство | После |
|---|---|---|---|---|
| 1. Production backup существует | Нет автоматического backup; скрипты только ручные | Исследовал Railway: PITR (pgBackRest → Railway Bucket, полный раз в неделю + дифф. ежедневно, WAL непрерывно, ретенция ~4 недели, восстановление в **новый** сервис, исходный не трогается) и volume-backups по расписанию. Через доступный MCP включить нельзя (нет операции PITR/backup schedule); образ `postgres-ssl:18` — major-тег, требование PITR выполнено. Написана инструкция на 3 клика (§4, A-1) | `describe-service` Postgres: переменных `WAL_ARCHIVE_*` нет; docs Railway «Enabling PITR»: кнопка на вкладке Backups | **BLOCKED BY ARMAN** (3 клика в UI) |
| 2. Restore проверен | Никогда | План: Backups → «Restore to this moment» → сервис `Postgres-restored-…` → `SELECT count(*)` по `users`, `purchase_intents`, `ledger_postings` и сверка с исходным → удалить fork. Не разрушает production по конструкции Railway | docs Railway: «The source service is never touched» | **BLOCKED BY ARMAN** (после gate 1; первый base backup делается автоматически после включения) |
| 3. Critical alert реально дошёл человеку | Канал = console; `alert:verify` лгал (исправлено в #57) | Код после #57: `delivered` = 2xx получателя. Проверил цепочку по событиям (§3). Нашёл и закрыл слепое пятно: недоступные Postgres/Redis выводили экземпляр из ротации **без алерта** — теперь `readiness.database.unreachable` / `readiness.redis.unreachable` (critical), при мёртвом Redis отправка идёт в обход подавления | `health.int-spec.ts`: 2 новых кейса, 6/6; коммит `c321e31` | **BLOCKED BY ARMAN** (задать `ALERT_WEBHOOK_URL`, один прогон `alert:verify`, скриншот сообщения) |
| 4. Deployment ждёт CI | `checkSuites: false` | Проверил по docs Railway: коммит в `main` деплоится **сразу**, CI не ждёт → плохой merge попадает в production раньше, чем CI его увидит. Требования «Wait for CI» выполнены (ci.yml имеет `on: push: branches: [main]`). MCP не меняет source-настройки; инструкция на 4 действия (A-2). Доказательство после включения: merge PR #58 → деплой в `WAITING` до зелёного CI | `get-service-config`; docs «Enabling wait for CI» | **BLOCKED BY ARMAN** (тумблер в UI ×3 сервиса) |
| 5. Demo mode выключен | Переменная есть, значение неизвестно | Доказал состоянием приложения: нет баннера DEMO MODE в логе старта; sandbox-PSP не смонтирован; demo-login → 404. Удалить переменную через MCP нельзя (только set) | лог деплоя `f94d56eb`, фильтр «DEMO MODE» → 0 строк; `main.ts:248` | **CLOSED** по поведению; рекомендация удалить переменную (A-4) |
| 6. Production health зелёный | Зелёный | Перепроверил: 5/5 сервисов online, replicas 1/1, 0 failures за 3 ч; readiness `/health/ready` — healthcheck Railway пройден на каждом деплое | `environment-status` | **CLOSED** |
| 7. Android RC проверен на Samsung и Xiaomi | Ни одной сборки из `main` | Собрал APK из `main` (#58, `369eda1`, production API, SHA-256 совпадает с релизом). Написал device-test из 10 шагов с явной проверкой старого дефекта фокуса (`docs/ANDROID_DEVICE_TEST_RU.md`) | релиз `apk-production-apk-58` | **BLOCKED BY ARMAN** (два телефона) |
| 8. Одна настоящая DIRECT-покупка end-to-end | Не было | Шаг 7 device-test (клиент + кассир в Partner-панели на production) | — | **BLOCKED BY ARMAN** |
| 9. Cashback/referral после неё правильные | — | Шаги 7–8 device-test + проверка в Admin → Bonus; ожидаемые суммы по правилу партнёра | — | **BLOCKED BY ARMAN** |
| 10. Refund тестовой покупки | — | Runbook §4: request кассиром → approve владельцем партнёра (не тем же человеком) → баллы и партнёрская доля откатываются | `docs/RUNBOOK_INCIDENTS_RU.md` §4 | **BLOCKED BY ARMAN** |
| 11. Юридические документы пригодны для масштаба пилота | Плейсхолдеры, нет юриста | Собрал один пакет: 8 документов, где используются, 4 вида плейсхолдеров с точными местами, 12 вопросов юристу с привязкой к экранам, что блокирует магазины и запуск отдельно (`docs/LEGAL_PACKAGE_FOR_LAWYER_2026-09-19.md`) | файл | **BLOCKED BY EXTERNAL PARTY** (юрист) + реквизиты от Армана |
| 12. Человек/runbook для production incident | Нет | `docs/RUNBOOK_INCIDENTS_RU.md`: 13 сценариев (спорная покупка, cashback, referral, возврат, потерянный телефон, смена номера, спор по расчёту, зависший PSP, ledger imbalance, dead-letter, API/Postgres/Redis недоступны) — симптом → проверить → нельзя → действие → эскалация | файл | Runbook **CLOSED**; человек — **BLOCKED BY ARMAN** (назначить дежурного и второго с `PSP_RECONCILE`/`CONTRIBUTION_RULE_APPROVE`) |
| iOS RC (не gate пилота) | Нет сборки, нет причины в одном месте | Профили `preview-ios`/`production-ios` в `eas.json`, workflow `Build iOS` (EAS cloud, без Mac, отказывается без `EXPO_TOKEN`), `docs/IOS_RELEASE_PREP_2026-09-19.md` с точной причиной и 4 шагами | коммит `9af3278` | **BLOCKED BY ARMAN** (Apple аккаунт + одноразовый `eas credentials`) |
| PR #52 биометрия (не gate пилота) | Конфликтует с main | Разобрал: 3 коммита, 39 файлов; в main ничего из этого не попало другим путём; конфликты только механические (i18n: main добавил `unitOfMeasure` рядом с `biometric`); смысловых нет. Перенёс merge-коммитом без переписывания истории; lockfile и demo перегенерированы | mobile 552/67, api unit 691/50, admin/partner зелёные, typecheck/lint чисто; push `a686d67..1c2fc90`; комментарий в PR #52 | **CLOSED** как «актуален и проверен»; merge — решение владельца после зелёного CI |

## 3. Observability: какие события реально доходят до человека (при заданном webhook)

| Событие | ERROR DETECTED | ALERT CREATED | ALERT SENT / RECEIVER ACCEPTED | HUMAN RECEIVED |
|---|---|---|---|---|
| PSP dead-letter (10 неудач) | да | `psp.callback-dead-letter:<id>` critical | webhook, `delivered` только при 2xx | нужен webhook |
| Failed sweep | да (`sweeps.processor`) | `sweep.failed` | да | нужен webhook |
| Reconciliation drift | да | `reconciliation.drift` critical + блок выплат | да | нужен webhook |
| Postgres unavailable | да (readiness 503) | **было: нет** → теперь `readiness.database.unreachable` critical | да (Redis жив → подавление 15 мин) | нужен webhook |
| Redis unavailable | да (readiness 503) | **было: нет** → теперь `readiness.redis.unreachable` critical | да, в обход подавления (Redis мёртв) | нужен webhook |
| Storage unavailable | да | `storage.unreachable:<driver>` warning | да | нужен webhook |
| Зависшая PSP-попытка | да (ageing) | `psp.attempt-unresolved` | да | нужен webhook |
| Процесс мёртв целиком | Railway healthcheck | **никто** (нет внешнего uptime-монитора) | — | — |

Остающееся слепое пятно: если API не запускается вовсе (например, Postgres
недоступен на старте → `migrate deploy` падает), процесс не живёт и
алерт послать некому; restart policy ALWAYS вернёт его, когда зависимость
вернётся, но человек об этом не узнает. Закрывается внешним
uptime-монитором на `/health/ready` (UptimeRobot/BetterStack, бесплатный
план) — A-3.

## 4. NEW DEFECTS FOUND

| # | Severity | Модуль | Сценарий | Root cause | Исправлено | Regression |
|---|---|---|---|---|---|---|
| N-1 | P1 (ops) | `health.controller.ts` | Postgres или Redis недоступны → экземпляр вне ротации, ни одного алерта: все остальные алерты рождаются в sweeps, которым нужны оба | readiness только логировал и отвечал 503 | да, `c321e31` | `health.int-spec.ts` (+2) |
| N-2 | P2 (repo) | PR #52 | `pnpm-lock.yaml` при merge с main сливался «удачно» git'ом, но ломался для pnpm («badly resolved merge conflict») | автослияние lockfile | да, перегенерирован (`1c2fc90`) | `pnpm install --frozen-lockfile` в CI |
| N-3 | P2 (ops) | Railway Postgres | PITR/бэкапы выключены; образ `postgres-ssl:18` совместим с PITR | не включали | нет (UI) | — |

Собственные ошибки по ходу: первая автоматическая развязка i18n-конфликта
сделала невалидный JSON (закрывающая скобка блока была в общем хвосте
файла) и была закоммичена до проверки — переделал с валидацией
`json.loads` и `--amend` до push; первый прогон проверок worktree упал
на typecheck/lint из-за несгенерированного Prisma-клиента, а не из-за кода.

## 5. CHANGES MADE

| Где | Что | Зачем |
|---|---|---|
| `c321e31` (PR #58) | `health.controller.ts`, `health.int-spec.ts` | алерт при недоступности Postgres/Redis |
| `9af3278` (PR #58) | `apps/mobile/eas.json`, `.github/workflows/ios-build.yml` | iOS-сборка в облаке EAS без Mac |
| `9af3278` (PR #58) | `docs/IOS_RELEASE_PREP_2026-09-19.md`, `docs/ANDROID_DEVICE_TEST_RU.md`, `docs/LEGAL_PACKAGE_FOR_LAWYER_2026-09-19.md`, `docs/RUNBOOK_INCIDENTS_RU.md` | gates 7, 11, 12, iOS |
| `53f8f0f`, `1c2fc90` (ветка PR #52) | merge main, lockfile, demo | актуализация биометрии |
| GitHub | комментарий в PR #52 с результатом переноса | — |
| GitHub Actions | APK #58 из `main` → релиз `apk-production-apk-58` | gate 7 |
| Этот файл | отчёт | — |

## 6. MANUAL ACTIONS FOR ARMAN

**A-1. Backup (gate 1–2), 10 минут.**
1. Railway → проект TuTak → сервис **Postgres** → вкладка **Backups**.
2. Нажать **Enable PITR** → подтвердить (Railway создаст bucket `Postgres-PITR`, поставит переменные, передеплоит Postgres — это единственный момент простоя, секунды).
3. Там же включить расписание volume-backups: **Daily** (и Weekly).
4. Через ~10 минут на вкладке появится «PITR restore range» и первый backup. Нажать **Restore to this moment** (последняя точка) → появится сервис `Postgres-restored-…`.
5. В этом новом сервисе → Data/Query: `SELECT count(*) FROM users; SELECT count(*) FROM purchase_intents; SELECT count(*) FROM ledger_postings;` и те же три запроса в исходном Postgres.
6. Прислать: скриншот вкладки Backups с включённым PITR и расписанием; 6 чисел. Затем удалить `Postgres-restored-…`.

**A-2. Wait for CI (gate 4), 2 минуты.**
1. Railway → tutak-api → Settings → раздел Source/GitHub.
2. Включить тумблер **Wait for CI** (Check Suites).
3. Повторить для tutak-admin и tutak-partner.
4. Прислать скриншот любого из трёх. После этого я мержу PR #58 и покажу деплой в статусе WAITING → CI зелёный → деплой.

**A-3. Алерты (gate 3), 10 минут.**
1. Создать Incoming Webhook (Slack/Mattermost/Discord) в канал, который читают.
2. Railway → tutak-api → Variables → `ALERT_WEBHOOK_URL` = URL.
3. Локально: `ALERT_WEBHOOK_URL=<url> REDIS_URL=<redis> pnpm --filter @tutak/api alert:verify` (после merge PR #58 — код с честной проверкой доставки уже в main с #57).
4. Прислать скриншот сообщения «TuTak alert channel test» в канале.
5. Дополнительно (uptime): зарегистрировать бесплатный монитор на `https://tutak-api-production.up.railway.app/health/ready` с уведомлением в тот же канал.

**A-4. DEMO_MODE.** Railway → tutak-api → Variables → удалить `DEMO_MODE` → после рестарта открыть `https://tutak-api-production.up.railway.app/health` → прислать ответ (`"demoMode": false`).

**A-5. Android device-test (gate 7–10).** Установить APK из релиза `apk-production-apk-58` на Samsung и Xiaomi, пройти `docs/ANDROID_DEVICE_TEST_RU.md` (10 шагов) с настоящим партнёром и кассиром; затем возврат тестовой покупки по runbook §4. Прислать видео шагов 3 и 5, скриншоты 7 и возврата.

**A-6. Юрист (gate 11).** Передать `docs/LEGAL_PACKAGE_FOR_LAWYER_2026-09-19.md` + реквизиты (`[OPERATOR]`, `[ADDRESS]`, `[CONTACT EMAIL]`). Прислать ответы на Q1–Q12 и реквизиты — вставлю за один коммит.

**A-7. Дежурный (gate 12).** Назвать человека с доступом в Railway+Admin, читающего канал алертов, и второго с ролью для двухчеловечных действий. Прислать два имени.

**A-8. PR #58 и PR #52.** Смержить #58 после зелёного CI (и после A-2, чтобы увидеть WAITING). PR #52 — смержить, если биометрия нужна в пилоте; CI на нём запущен.

## 7. PILOT READINESS

**DIRECT + LOYALTY PILOT: NOT READY.**

Незакрытые gates (все — вне кода):
1. Backup включён и restore проверен (A-1).
2. Алерт дошёл человеку (A-3).
3. Deployment ждёт CI (A-2).
7–10. Android на Samsung и Xiaomi, одна настоящая покупка, cashback/referral, refund (A-5).
11. Юридическая пригодность для масштаба пилота (A-6).
12. Назначенный дежурный (A-7).

Закрыто: demo mode (по поведению), production health, runbook, код
наблюдаемости, Android-сборка из main, iOS-подготовка, PR #52 актуален.

## 8. FULL PUBLIC LAUNCH — что ещё требуется после пилота

- **Android public release:** Google Play аккаунт ($25), Data safety form по
  инвентаризации данных, privacy/deletion URL на подтверждённом домене,
  `production` профиль (app-bundle) вместо APK, версии/`versionCode` через
  EAS remote, подпись Play App Signing.
- **iOS:** Apple Developer ($99/год), одноразовый `eas credentials`,
  `preview-ios` на реальном iPhone, `production-ios` → TestFlight → review;
  тот же device-test.
- **Idram:** ответы на `docs/IDRAM_PROVIDER_CONFIRMATION.md`, sandbox-план
  из 20 шагов, `ALERT_WEBHOOK_URL` (обязателен boot-guard'ом), два человека
  с `PSP_RECONCILE`, затем `TUTAK_PSP_ENABLED` на одном партнёре.
- **EV:** договор с реальным CPO, `OCPI_BASE_URL`/`OCPI_TOKEN`, реальная
  сессия start → stop → CDR → сверка; до этого EV остаётся выключенным
  (Noop-адаптер).
- **App Store / Google Play:** юридические тексты без плейсхолдеров, support
  email, аккаунты, соответствие Q7–Q10 пакета юристу.
