# TuTak — Launch Readiness: FINAL CLOSURE (26.09.2026)

Закрывает только реальные разрывы между «CODE READY» и «READY FOR CONTROLLED
BONUS-ONLY PILOT». Не новый аудит, не переделка settlement, не Full
Anti-Fraud. Предыдущий отчёт — `TUTAK_LAUNCH_READINESS_FINAL_2026-09-26.md`.

## 0. Задание (пересказ)

«TUTAK — LAUNCH READINESS FINAL CLOSURE», 26.09.2026, 20 разделов:
(1) убрать ложный зелёный AI-review: различать REVIEW_COMPLETE /
BLOCKED_BY_API_KEY / PROVIDER_FAILURE / INVALID_RESPONSE, зелёный — только
реальное завершение Kimi+DeepSeek, но без required check, который заблокирует
разработку; автотесты 7 сценариев без платных API; (2) pre-deploy gate по
legacy payouts `REQUESTED` (read-only; если доступа нет — точная команда
владельцу; 0 → CLOSED, >0 → STOP); (3) pre-flight production env таблицей
`Variable | PASS / FAIL / OWNER VERIFY | Expected`; (4) Railway ownership P0 —
пошагово, «OWNERSHIP GATE: PASS»; (5) Telegram — «NOT VERIFIED» до реального
сообщения; (6) мобильный чек-лист 14 шагов → OWNER ACTION; (7) staging —
минимальная стратегия, «STAGING: OWNER ACTION»; (8) бэкапы — план «до пилота»
/ «до публичного запуска»; (9) Sentry/metrics — классификация; (10) таблица
порогов антифрода; (11) чёрный бонус — OWNER BUSINESS DECISION, можно ли
пилот без изменения политики; (12) CodeQL — зафиксировать; (13) CI на точном
HEAD; (14) закрытое не трогать; (15) новое не начинать; (16) OWNER ACTIONS
BEFORE PILOT — 8 пунктов; (17) три вердикта; (18) критерии пилота; (19)
прочие статусы; (20) STOP-список.

## A. База и SHA

| Что | SHA |
|---|---|
| Ветка / PR | `claude/tutak-launch-readiness-20260926` / Draft PR #71 (не merge, не deploy) |
| HEAD на старте задачи | `327e5661` |
| FINAL code SHA (последнее изменение `apps/`, `packages/`) | `7f53969a` — **не изменился** |
| Этот коммит закрытия AI-review (scripts + workflow + AGENTS/AI docs) | `34bda477` |
| Отчёт закрытия (этот файл) | см. коммит ниже |
| MAIN | `369eda19` (ancestor HEAD — проверено `git merge-base --is-ancestor`) |
| PRODUCTION (Railway `tutak-api`, deployment `f94d56eb`, 19.09 07:30 UTC) | `369eda19` — ничего из ветки в production нет |

`git diff --name-only 7f53969a 34bda477`: `.github/workflows/ai-review.yml`,
`AGENTS.md`, `docs/AI_BASELINE_AUDIT.md`, `docs/TUTAK_LAUNCH_READINESS_FINAL_2026-09-26.md`,
`scripts/ai-review.mjs`, `scripts/ai-review.test.mjs`, `scripts/backup.sh`.
Файлов в `apps/`/`packages/` — 0. То есть код приложения после `7f53969a` не
менялся; CI при этом прогнан полностью на `34bda477` (§C).

## B. Что сделано

### B1. AI review — ложный зелёный убран (§1)

Было: `scripts/ai-review.mjs` всегда `exit 0`; job «Kimi + DeepSeek review»
на PR #71 без ключей показывался **зелёным** (run 36266929394). Это и есть
«ложный зелёный» из задания.

Стало (`34bda477`):

- Каждый прогон модели заканчивается ровно одним статусом из закрытого списка
  `REVIEW_COMPLETE | BLOCKED_BY_API_KEY | PROVIDER_FAILURE | INVALID_RESPONSE |
  NOTHING_TO_REVIEW | NOT_RUN`. Статус виден в GitHub четырьмя способами:
  step summary job'а, step output `status` (попадает в имя шага Verdict:
  «…(Kimi=BLOCKED_BY_API_KEY, DeepSeek=BLOCKED_BY_API_KEY)»), файл
  `ai-review-out/<provider>-<mode>.status.json` в артефакте, sticky-комментарий
  PR. `INVALID_RESPONSE` — новый: раньше ответ не в JSON-форме отображался,
  но статуса не имел; массив не-объектов («Issues: [1, 2]») раньше считался
  «0 замечаний» — теперь INVALID_RESPONSE.
- Шаг модели сам никогда не падает (вторая модель должна успеть отработать);
  финальный шаг **Verdict** (`node scripts/ai-review.mjs --verdict
  ai-review-out kimi,deepseek`, `if: always()`) выходит с кодом 1, если не
  все модели `REVIEW_COMPLETE`. Исключение: обе `NOTHING_TO_REVIEW` (diff без
  кода — docs-only PR) → GREEN с явной подписью «модель не вызывалась».
  Итог: **job GREEN ⇔ обе модели реально отревьюили.**
- Не deadlock: job **не входит** в required checks ruleset «Protect main»
  (id 23702809 — 5 обязательных проверок: Lint/test/build, Integration 1–3,
  Build images; проверено через API 26.09). Заголовок workflow прямо
  запрещает добавлять его туда, пока ключей нет. Красный advisory-check не
  блокирует merge.
- Тесты `scripts/ai-review.test.mjs` (`node --test`, `fetch` подменён,
  платные API не вызываются): (1) нет ключа Kimi; (2) нет ключа DeepSeek;
  (3) нет обоих; (4a) таймаут провайдера через реальный `AbortController`
  и (4b) HTTP 500→503 с повтором / 401 без повтора; (5) невалидный JSON;
  (6) Kimi success + DeepSeek failure; (7) обе success (+ проверка
  sticky-комментариев: 3 POST); плюс пустой diff, отсутствующий status-файл,
  нормализация findings. **12 тестов, 12 pass** локально; в workflow — первый
  шаг «Self-test».
- Weekly-audit job получил те же шаги Verdict/Self-test.
- Документация: `AGENTS.md` §4, `docs/AI_BASELINE_AUDIT.md`.

Первый прогон на `34bda477` (run 36268154201, job 108476779648): Self-test
✅, Kimi ✅(BLOCKED_BY_API_KEY), DeepSeek ✅(BLOCKED_BY_API_KEY), артефакт ✅,
Verdict ❌ → job **failure** — ровно то, что требовалось: без ключей ревью не
зелёное. Три sticky-комментария в PR #71 (Kimi, DeepSeek, verdict). Статус
AI-review сегодня: **AI REVIEW: BLOCKED_BY_API_KEY (честно красный,
не блокирует).**

### B2. Legacy payouts — pre-deploy gate (§2)

Read-only доступа к production БД из этой среды нет (`DATABASE_URL` скрыт,
сеть к Railway закрыта). Команда владельцу (таблица в Prisma замаплена на
`payouts`, enum `PayoutStatus = REQUESTED | PAID | FAILED`):

```bash
# вариант A — Railway CLI (ничего не меняет, только читает)
railway link            # проект TuTak → environment production → сервис Postgres
railway connect Postgres
# в psql:
SELECT count(*) FROM payouts WHERE status = 'REQUESTED';
SELECT status, count(*) FROM payouts GROUP BY status;      -- для полноты картины
\q
```

Вариант B — Railway dashboard → сервис `Postgres` → вкладка **Data** →
**Query** → тот же `SELECT`.

Интерпретация: `0` → **LEGACY REQUESTED PAYOUTS: CLOSED** (запись count и
даты в отчёт владельца — и всё). `> 0` → **STOP — DATA RECONCILIATION
REQUIRED**: ничего не править руками, не выплачивать, не reverse'ить; план
сверки — §B2.1. Пока владелец не прислал число:
**LEGACY REQUESTED PAYOUTS: OWNER ACTION (UNVERIFIED).**

Почему это gate: после `0e633188` write-путь legacy `PayoutEngine` удалён
(нет `POST /payouts`, `/confirm`, `/fail`). Строка `REQUESTED` в production
после деплоя останется без кода, который умеет её завершить, а её ledger-хвост
(`payout.requested`) уже учтён `TRANSFER_LEDGER_KINDS` как перевод — то есть
партнёру эта сумма второй раз через settlement **не** уйдёт, но и первый раз
не уйдёт никогда, пока запись висит.

#### B2.1 План сверки на случай `> 0` (не выполнять без решения владельца)

1. Выгрузить строки: `SELECT id, "partnerId", amount, status, "createdAt",
   "bankTransferReference" FROM payouts WHERE status='REQUESTED';` и их
   ledger-записи `kind='payout.requested'` по `relatedPayoutId`.
2. По каждой — факт от владельца: банковский перевод **был** или **нет**.
3. Был → data-migration (одна миграция, идемпотентная, с проверкой count до/после):
   `status='PAID'`, `paidAt`, референс; ledger не трогать (перевод уже учтён).
4. Не был → `status='FAILED'` + компенсирующая ledger-запись reversal
   (через существующий `LedgerService`, не SQL), чтобы сумма вернулась в
   `availableBalance` партнёра и ушла обычным settlement.
5. Тест миграции на копии (restore из дампа) до production; отчёт с числами.

### B3. Production env pre-flight (§3)

Источник: имена переменных `tutak-api` через Railway MCP 26.09 (значения
скрыты — `valuesRedacted: true`). Значения **не угадываю**: всё, что задано,
но не читается — OWNER VERIFY с ожидаемым состоянием. Что отсутствует и по
коду даёт безопасное значение по умолчанию — PASS (по факту отсутствия).

| Variable | PASS / FAIL / OWNER VERIFY | Expected state |
|---|---|---|
| `DEMO_MODE` | OWNER VERIFY (задана) | `false` |
| `APP_ENV` | OWNER VERIFY (задана) | `production` (`app-environment.ts`: один из development/test/staging/production) |
| `NODE_ENV` | OWNER VERIFY (задана) | `production` |
| `CLIENT_IP_STRATEGY` | OWNER VERIFY (задана) | `xff-depth` (Railway за прокси; `socket` даст один IP на всех → лимиты OTP по IP бьют по всем) |
| `CLIENT_IP_TRUSTED_HOPS` | OWNER VERIFY (задана) | целое = число прокси перед api (обычно `1`); измерить по `RAILWAY_PRODUCTION_RUNBOOK_RU.md` §9 |
| `CORS_ORIGINS` | OWNER VERIFY (задана) | ровно production-origin'ы admin и partner: `https://tutak-admin-production.up.railway.app,https://tutak-partner-production.up.railway.app` (без `*`, без localhost) |
| `SMS_GLOBAL_MAX_PER_HOUR` | OWNER VERIFY (задана) | пилот 1–2 точки: `100` (default 500) |
| `SMS_GLOBAL_MAX_PER_DAY` | OWNER VERIFY (задана) | пилот: `500` (default 5000) |
| `SMS_DRIVER`, `VIVA_*`, `SMS_VIVA_*` | OWNER VERIFY (заданы) | `viva`; проверяется шагом 2 мобильного чек-листа (реальная SMS) |
| `PUSH_ENABLED` | OWNER VERIFY (задана) | `true` только если `PUSH_ENDPOINT` рабочий; иначе `false` |
| `PUSH_ENDPOINT` | OWNER VERIFY (задана) | https-URL Expo push relay |
| `EMERGENCY_FREEZE` | **PASS** (отсутствует → `false`) | отсутствует или `false` |
| `FRAUD_*` (9 переменных) | **PASS по умолчанию** (отсутствуют → 10/8/300/150/60/300000/24/5/72) | значения по решению владельца — §B10; выставить **до** деплоя, если решение принято |
| `TUTAK_PSP_ENABLED` | **PASS** (отсутствует → `false`) | отсутствует |
| `PSP_REFUNDS_ENABLED` | **PASS** (отсутствует → `false`) | отсутствует |
| `CUSTOMER_PREPAID_TOPUP_ENABLED` | **PASS** (отсутствует → `false`) | отсутствует |
| `CARD_PAYMENTS_ENABLED` | **PASS** (отсутствует → `false`) | отсутствует |
| `PAYOUT_DUAL_CONTROL` | **PASS** (отсутствует → `true`) | отсутствует |
| `ALERT_TELEGRAM_BOT_TOKEN`, `ALERT_TELEGRAM_CHAT_ID` | OWNER VERIFY (заданы) | пара задана; доказательство — только §B5 |
| `ALERT_WEBHOOK_URL` | PASS (отсутствует; Telegram — канал) | отсутствует |
| `SENTRY_DSN` | **FAIL для public launch / не блокер пилота** (отсутствует) | задать до публичного запуска (§B9) |
| `METRICS_TOKEN` | не блокер (отсутствует) | §B9 |
| `SEED_BASELINE` | OWNER VERIFY (задана) | `true` допустимо (сид идемпотентен); выключить после стабилизации ролей |
| `SEED_ADMIN_PASSWORD` | OWNER VERIFY (задана) | сменён с момента первого сида (10.09 C3) — только владелец знает |
| `DATABASE_CONNECTION_LIMIT` | OWNER DECISION (отсутствует → пул по умолчанию) | рассчитать по `DEPLOYMENT.md` §Database connections; не блокер 1–2 точек |
| `MEDIA_STORAGE_DRIVER`, `MEDIA_STORAGE_S3_*` (6), `MEDIA_PUBLIC_BASE_URL` | OWNER VERIFY (заданы) | `s3`, бакет `tutak-media`; проверяется шагом 5 мобильного чек-листа (логотип) |
| Production URLs | PASS (Railway MCP): api `tutak-api-production.up.railway.app` (порт 4000, healthcheck `/health/ready`), admin `tutak-admin-production…`, partner `tutak-partner-production…` | admin/partner: `NEXT_PUBLIC_API_BASE_URL` → api URL (OWNER VERIFY — переменные фронтов не читались в этой задаче) |

Как владельцу проверить за 5 минут: Railway → `tutak-api` → Variables →
сверить столбец «Expected» построчно → прислать таблицу «имя = PASS/FAIL»
(без значений секретов). Итоговый статус до этого:
**PRODUCTION ENV PRE-FLIGHT: OWNER VERIFY (22 переменных), PASS по умолчанию — 7.**

### B4. Railway ownership — OWNERSHIP GATE (§4)

Факт: проект TuTak (`901cf202…`) в workspace разработчика `styop0909`
(stepan.grig.2009@gmail.com); все деплои — от него. Claude ничего не
переносит. Минимум до пилота — пошагово:

1. **Владелец**: завести аккаунт Railway на своей почте (railway.com → Login
   → Email). Прислать разработчику этот email.
2. **Разработчик**: Railway → workspace «styop0909's Projects» → Settings →
   **Members** → Invite → email владельца → роль **Admin** → Send.
3. **Владелец**: принять приглашение из письма; открыть проект **TuTak**.
4. **Владелец** проверяет и делает три скриншота:
   - Workspace → Settings → Members: владелец в списке с ролью **Admin**;
   - Workspace → Settings → **Billing / Usage**: страница открывается,
     видно, чья карта и текущее потребление (можно ли сменить способ оплаты);
   - Проект TuTak → сервис **Postgres** → вкладки **Volume / Backups**
     открываются (видны том и расписание снапшотов — заодно закрывает §B8.1);
     на любом сервисе виден пункт **Redeploy / Remove** (не нажимать).
5. **Владелец** отправляет: три скриншота + строку
   «OWNERSHIP GATE: PASS, дата, email аккаунта».

**OWNERSHIP GATE: PASS** ⇔ все три скриншота есть и роль = Admin. Иначе
**OWNERSHIP GATE: FAIL** — пилот не начинать.

Предпочтительно (не обязательно до пилота): полный перенос проекта — порядок
в `INFRASTRUCTURE_OWNERSHIP.md` §3 (там же риск смены доменов и план Б).
Сегодня: **OWNERSHIP GATE: FAIL (P0 OWNER).**

### B5. Telegram — production alert delivery (§5)

Переменные `ALERT_TELEGRAM_*` заданы на `tutak-api` (имена видны), но код,
который их читает (`TelegramAlertChannel`, `06d97e6a`), в production **не
задеплоен** (production = `369eda19`). Присутствие env ≠ доказательство.
После merge/deploy, одобренных владельцем отдельно:

```bash
# внутри production-контейнера (WORKDIR /repo/apps/api, dist собран образом)
railway ssh --project TuTak --environment production --service tutak-api
node dist/scripts/alert-verify.js
```

Ожидание: в логе `channel: telegram`, `delivered: true`, и в Telegram-чате
появляется сообщение с явной пометкой TEST. Владелец присылает скриншот
сообщения из чата. До этого:
**PRODUCTION ALERT DELIVERY: NOT VERIFIED.**

Альтернатива с ноутбука (`pnpm --filter @tutak/api alert:verify`) требует
production `REDIS_URL`, который приватный (`*.railway.internal`) — поэтому
`railway ssh`.

### B6. Мобильная физическая приёмка (§6)

Один человек, один Android-телефон с SIM, APK сборки с FINAL code SHA
(шаг «О приложении» показывает commit). Полный сценарий — `PHONE_CHECKLIST_RU.md`;
короткий обязательный чек-лист для пилота:

| # | Шаг | Ожидается | ✓/✗ |
|---|---|---|---|
| 1 | Открыть приложение | стартовый экран < 3 с, без белого экрана | |
| 2 | Войти через OTP на настоящий номер | SMS приходит, код принят | |
| 3 | Один тап в поле телефона | клавиатура открылась с первого тапа | |
| 4 | Набрать номер полностью | все цифры попали в поле, курсор не прыгал | |
| 5 | Во время набора | клавиатура не закрылась сама | |
| 6 | Перейти в следующее поле | фокус не перескочил назад/в другое поле | |
| 7 | Поле пароля / реферального кода | ввод работает, символы не теряются | |
| 8 | Сканировать QR партнёра | камера открылась, QR распознан | |
| 9 | Подтвердить тестовую bonus-only покупку (кассир на втором устройстве) | экран сам сменился на «подтверждено» | |
| 10 | Проверить баланс | начисление видно; сумма совпадает с ожидаемой | |
| 11 | Полностью закрыть приложение (свайп из недавних) | — | |
| 12 | Открыть снова | сессия жива, баланс тот же, без повторного OTP | |
| 13 | Выключить интернет → открыть экран → включить | видна понятная ошибка/индикатор offline, без краша | |
| 14 | После включения интернета | приложение само восстановилось, данные обновились | |

Результат: все 14 ✓ → **MOBILE DEVICE ACCEPTANCE: PASS**; любой ✗ →
**FAIL** и отдельная задача на отладку (только тогда). Сейчас:
**MOBILE DEVICE ACCEPTANCE: OWNER ACTION.**

### B7. Staging (§7)

STAGING READY не пишу. Render `tutak-staging-*` — не staging (другая ветка,
БД истекает 29.09). Минимальная стратегия на Railway (платно — не создаю):

1. Проект TuTak → **New Environment** `staging` (Railway клонирует состав
   сервисов; переменные задаются отдельно) — или отдельный проект
   `TuTak-staging`, если нужен отдельный биллинг.
2. Сервисы: `tutak-api`, `tutak-admin`, `tutak-partner`, `tutak-checkout`
   (`apps/checkout`, Dockerfile/Next), свой **Postgres** и **Redis**
   (минимальные тома). Source: ветка PR (сейчас
   `claude/tutak-launch-readiness-20260926`), `checkSuites: true`.
3. Переменные — копия production **по именам**, значения свои:
   `APP_ENV=staging`, `DEMO_MODE=true` допустимо, `SMS_DRIVER=console`,
   `SEED_BASELINE=true`, отдельный Telegram-чат, `EMERGENCY_FREEZE=false`,
   деньги OFF (`TUTAK_PSP_ENABLED` и три флага отсутствуют), `CORS_ORIGINS` =
   staging-адреса admin/partner.
4. Данные: только `seed-baseline` + `seed-demo`; production-дамп — никогда.
5. Кандидатные миграции: деплой ветки в staging применяет их `prisma migrate
   deploy` при старте — это и есть репетиция миграции. Проверка: `/health/ready`
   = 200, `scripts/smoke-test.sh API_URL=<staging>/v1`, e2e Playwright с
   `API/ADMIN/PARTNER` на staging-адреса.
6. Отдельные URL: `tutak-*-staging.up.railway.app` (generate-domain).
7. Render staging после этого — удалить (OWNER).

Является ли staging обязательным gate пилота — **owner decision**. Мой
минимум для bonus-only на 1–2 точках: CI-стек («Build the container images»
собирает образы, применяет миграции, гоняет E2E и backup/restore rehearsal
на каждом push) + PITR + откат Redeploy — это **usable safe path**, но не
замена staging перед публичным запуском.
Статус: **STAGING: OWNER ACTION.**

### B8. Бэкапы — план (§8)

| Пункт | Статус 26.09 | Когда обязателен | Действие |
|---|---|---|---|
| WAL-архив в бакет `Postgres-PITR` + учение 19.09 | ✅ проверено 19.09 | — | до деплоя: владелец смотрит, что в бакете есть свежие WAL-файлы за сегодня (Railway → bucket → объекты, дата) |
| Расписание снапшотов тома Postgres | **NOT VERIFIED** | **до пилота** | Railway → Postgres → Volume → Backups → включить Daily (7 дней) — 1 клик, шаг 4 §B4 |
| Один внешний логический дамп перед деплоем | нет | **до пилота** (перед первым деплоем ветки) | `railway connect Postgres` недоступно для `pg_dump` напрямую → `railway run --service Postgres -- env` не отдаёт URL наружу безопасно; вариант: включить TCP proxy на Postgres на время дампа, `DATABASE_URL=… scripts/backup.sh`, затем proxy выключить; дамп — в личное зашифрованное хранилище владельца |
| Копия `tutak-media` | **NOT VERIFIED / gap** | до публичного запуска | `aws s3 sync s3://tutak-media <внешний бакет>` раз в сутки (cron у владельца) |
| Ежедневный автоматический внешний дамп вне Railway | нет | до публичного запуска | cron `scripts/backup.sh` + `scripts/restore.sh --verify` еженедельно |
| Повтор PITR-учения после смены владельца/региона | — | до публичного запуска | `DISASTER_RECOVERY_RUNBOOK.md` §3 |

Ничего разрушительного не выполнялось; artefacts учения
(`Postgres-restored-20260919-1733`, staged delete `verify-restore-20260919`)
не трогал (STOP). Enterprise-контроли обязательными для пилота не делаю.
**BACKUP MINIMUM FOR PILOT: 2 owner-действия (снапшоты + один внешний дамп).**

### B9. Sentry / metrics (§9)

- **SENTRY: REQUIRED BEFORE PUBLIC LAUNCH.** Не блокер пилота при условии:
  Telegram critical alerts реально доставляются (§B5), Railway logs доступны
  владельцу (§B4), health checks `/health/ready` включены (факт), runbook
  есть (`PRODUCTION_RUNBOOK.md`).
- **METRICS: RECOMMENDED / REQUIRED BEFORE SCALE.** `METRICS_TOKEN` отсутствует
  — эндпоинт закрыт; пилот на 1–2 точках наблюдается через Railway metrics
  сервиса + логи.

### B10. Пороги антифрода пилота (§10)

Ничего не менял. Текущие значения — код `configuration.ts:779–797` и
`FraudDetectionService`. Действие всех правил «пилота» — **HOLD** награды
клиента (PENDING на `FRAUD_REWARD_HOLD_HOURS`) + `FraudSignal`, продажа не
блокируется; customer velocity на QR/EV — блокирующая (существующая).

| Rule | Current / default | Recommended pilot setting | Why | Owner decision needed |
|---|---|---|---|---|
| Customer velocity (QR/EV, блокирует) `FRAUD_VELOCITY_WINDOW_MINUTES` / `FRAUD_VELOCITY_MAX_TRANSACTIONS` | 10 мин / 8 | 10 мин / **5** | живой клиент не делает > 5 покупок за 10 минут; 8 оставляет место скрипту | **да** (бизнес-порог; риск ложных блоков у семей с одним телефоном) |
| Partner velocity (hold) `FRAUD_PARTNER_VELOCITY_MAX` | 300 за окно | **60** | 1–2 точки: 6 подтверждений/мин — предел кассы; 300 ловит только бота | **да** |
| Branch velocity (hold) `FRAUD_BRANCH_VELOCITY_MAX` | 150 | **40** | одна касса ≈ 1–2 чека/мин | **да** |
| Employee velocity (hold) `FRAUD_EMPLOYEE_VELOCITY_MAX` | 60 | **20** | кассир, «прогоняющий» свою карту, виден на 20/10 мин | **да** |
| High-value (hold, сигнал HIGH) `FRAUD_HIGH_VALUE_AMOUNT` | 300 000 AMD | **100 000 AMD** | средний чек кафе 3–10 тыс.; ≥100 тыс. — исключение, проверить руками (hold, не отказ) | **да** (зависит от типа пилотных точек) |
| New account burst (hold) `FRAUD_NEW_ACCOUNT_HOURS` / `FRAUD_NEW_ACCOUNT_MAX_PURCHASES` | 24 ч / 5 | 24 ч / **3** | новый аккаунт с 3+ покупками в первые сутки — типичный self-referral | **да** |
| Hold duration `FRAUD_REWARD_HOLD_HOURS` | 72 ч | **72 ч (оставить)** | ежедневный чек-лист runbook §3 успевает разобрать сигналы; `resolve` снимает hold раньше | нет (операционный) |

Правила-«0» (выключение) не рекомендую ни для одного. Значения выставляются
переменными `tutak-api` до деплоя, перезапуск — автоматически.
**FRAUD THRESHOLDS: OWNER DECISION (6 значений).**

### B11. Чёрный бонус — конфликт (§11)

Не чиню. **OWNER BUSINESS DECISION.**

| | Документ `REFERRAL_COMMISSION_MODEL_RU.md` §6 | Код (`DEFERRED_BONUS_WINDOW_MONTHS=3`, `DEFERRED_BONUS_REQUIRED_TURNOVER=54000`) |
|---|---|---|
| Окно | 6 месяцев | 3 месяца |
| Условие | ≥ 15 000 AMD **каждый** месяц (пропуск = не выполнено) | накопленный оборот ≥ 54 000 AMD за окно, без помесячной проверки |
| Следствие для клиента | строже: 6 подряд активных месяцев | мягче: можно один раз купить на 54 000 |
| Следствие для экономики | меньше открытых чёрных балансов, дольше замороженные обязательства | больше и раньше открытий → выше расход бонусов |
| Что менять при выборе | код: новая помесячная проверка активности (таблица активности, тест) + миграция параметров | документ §6 |

**Можно ли пилот без изменения политики сейчас — да, с дедлайном.** Лот
чёрного бонуса фиксирует `deadline` и `requiredTurnover` **в момент
создания** (`deferred-bonus-lot.service.ts:186–193`); первый лот пилота
может открыться не раньше, чем через 3 месяца после первой покупки. Пока
решение не принято, ни один лот не откроется ни по одному правилу. Дедлайн
решения: **до истечения 3 месяцев с первой пилотной покупки минус 2 недели**
на миграцию параметров; если решение — «6 месяцев», уже созданные лоты
потребуют одноразовой data-миграции (deadline/requiredTurnover), что дешевле
при малом пилоте. Клиенты в пилоте видят в приложении условия из кода —
владельцу это надо знать, если позиция «по документу» будет объявлена.
**BLACK BONUS POLICY: OWNER DECISION, пилот не блокирует.**

### B12–13. CodeQL и CI (§12–13)

**Собственная ошибка предыдущего отчёта.** В нём написано «CodeQL GREEN» —
это был статус **job'а** «Analyze (javascript-typescript)» (success), а не
результат code scanning. Check-run **«CodeQL»** приложения
`github-advanced-security` на PR #71: **failure** — «1 new alert including
1 high severity security vulnerability» на `7f53969a` (run 108470668374) и
на `327e5661` (run 108473597950). Аннотация:
`apps/api/src/modules/partners/partner-api-key.service.ts:93` — «Use of
password hash with insufficient computational effort»
(`js/insufficient-password-hash`): `createHash('sha256')` над секретом
из заголовка `x-api-key`.

На `34bda477` тот же check снова failure с тем же единственным алертом
(run 108477156642) — код не менялся, ожидаемо.

Оценка (прочитан код): секрет — `randomBytes(32).toString('hex')` (256 бит
энтропии), сравнение `timingSafeEqual`, ключ ищется по `keyId`. Правило
CodeQL про **пароли** (низкая энтропия → нужен bcrypt/argon2); для
случайного 256-битного API-ключа SHA-256 — стандартная практика, брутфорс
хэша невозможен независимо от стоимости хэширования. Код появился в
`6bc710df` (Partner Commerce, уже в `main`), не в этой ветке; CodeQL просто
впервые запущен здесь. **Вердикт: FALSE POSITIVE, кода не меняю** — смена
хэша потребовала бы перевыпуска всех выданных ключей (хранится только хэш).
Список алертов через API недоступен (403), список открытых алертов на `main`
— UNVERIFIED (workflow на `main` ещё не запускался).

Что делать владельцу: GitHub → Security → Code scanning → alert → **Dismiss
→ False positive** с комментарием «random 256-bit API key, not a password».
После dismiss check «CodeQL» на следующем push станет зелёным. Если владелец
хочет нулевой список без dismiss — отдельная задача: HMAC-SHA256 с серверным
pepper и версионированный префикс хэша с миграцией ключей (не сейчас).

Статус: **CODEQL: ANALYZE SUCCESS / CODE SCANNING: 1 HIGH — FALSE POSITIVE
(owner dismiss).** Любой новый code SHA — CodeQL заново (автоматически на PR).

CI (§13) — числа в §C. Docs-only коммиты доказываются
`git diff --stat <sha>^ <sha>`.

### B14–15. Не тронуто / не начато

Settlement, dispute-after-approve, payout retirement, 20/30/30/20,
ledger/referral/refund, emergency freeze, Telegram-реализация, история
миграций — не менялись (`git diff --name-only 7f53969a HEAD` не содержит
`apps/`). Full AI Risk Engine, скоринг транзакций, fuel, PSP/Idram, Global
Search — не начинались.

## C. Чем доказано

| Проверка | Результат |
|---|---|
| `node --test scripts/ai-review.test.mjs` локально | 12/12 pass, 268 мс |
| `eslint` + `prettier --check` на двух новых файлах | 0 ошибок |
| Локальная симуляция workflow без ключей (`AI_REVIEW_API_KEY=` для обеих моделей → `--verdict`) | статусы BLOCKED_BY_API_KEY ×2, verdict exit **1**; пустой diff → NOTHING_TO_REVIEW ×2, exit **0** |
| CI на `34bda477` — job «Kimi + DeepSeek review» (run 36268154201) | Self-test ✅, Kimi ✅, DeepSeek ✅, artifact ✅, **Verdict ❌ → job failure** (ожидаемо); 3 sticky-комментария в PR #71 |
| CI на `34bda477` — обязательные проверки | **10/10 GREEN** (push 36268151767 5/5, PR 36268154266 5/5); CodeQL Analyze success — таблица ниже |
| Ruleset «Protect main» (API) | 5 required checks; AI review и CodeQL **не** в списке |
| Railway MCP: имена переменных `tutak-api` | 52 имени, `valuesRedacted: true`; отсутствуют: PSP-флаги ×4, `EMERGENCY_FREEZE`, `FRAUD_*`, `SENTRY_DSN`, `METRICS_TOKEN`, `ALERT_WEBHOOK_URL`, `PAYOUT_DUAL_CONTROL` |
| Railway MCP: production deployment | `f94d56eb` SUCCESS, `369eda19`, 19.09 07:30 UTC — без изменений |
| Диф кода после FINAL code SHA | `git diff --stat 7f53969a 34bda477 -- apps/ packages/` → 0 файлов |

### CI на `34bda477` (все workflow-прогоны на этом SHA, завершены 20:20 UTC)

| Run | Workflow / event | Jobs | Итог |
|---|---|---|---|
| 36268151767 | CI / push | Lint, test and build ✅ · Integration 1/3 ✅ · 2/3 ✅ · 3/3 ✅ · Build the container images (E2E, mobile против стека, backup/restore rehearsal) ✅ | **5/5 success** |
| 36268154266 | CI / pull_request (PR #71) | те же пять | **5/5 success** |
| 36268154208 | CodeQL (static security analysis) / pull_request | Analyze (javascript-typescript) ✅ | success |
| — (check-run 108477156642) | code scanning «CodeQL» (github-advanced-security) | 1 high alert — тот же false positive §B12 | failure (owner dismiss) |
| 36268154201 | AI review (advisory) / pull_request | Self-test ✅, Kimi ✅ BLOCKED_BY_API_KEY, DeepSeek ✅ BLOCKED_BY_API_KEY, artifact ✅, **Verdict ❌** | **failure — намеренно**, не required |

Итого обязательных проверок ruleset: **10/10 GREEN** (5 push + 5 PR).
Все запуски — на точном HEAD `34bda477`; отчёт (этот файл) — следующий,
docs-only коммит (доказательство — `git diff --stat HEAD^ HEAD`: один файл в `docs/`).

## D. Что НЕ сделано / собственные ошибки

- **Ошибка предыдущего отчёта:** «CodeQL GREEN» — смотрел на job Analyze, а
  не на check «CodeQL» от code scanning, который был **failure** уже на
  `7f53969a`. Исправлено здесь (§B12), код не менял — false positive.
- **Ошибка предыдущего дизайна AI-review:** сам заложил «никогда не валит
  CI» и получил ложный зелёный; исправлено `34bda477`.
- Не выполнено мной (нет доступа/права): чтение значений production env;
  `SELECT count(*)` в production БД; `alert:verify` в production; проверка на
  устройстве; расписание снапшотов; создание staging; dismiss CodeQL-алерта
  (API 403); список алертов code scanning на `main`.
- Не делал намеренно (STOP/§14–15): merge, deploy, перенос Railway, удаление
  restored DB/Render, ротация секретов, изменение black policy и порогов,
  включение PSP, Full Anti-Fraud, скоринг транзакций.
- Job «Kimi + DeepSeek review» теперь **красный на каждом PR**, пока
  владелец не добавит ключи. Это по заданию, но выглядит тревожно; merge не
  блокирует. Если владелец захочет «серый» вместо красного — нужен
  Checks API с `conclusion: neutral` (отдельная небольшая задача).

## E. UNVERIFIED (прямым списком)

1. Значения 22 production-переменных (§B3).
2. `count(*) FROM payouts WHERE status='REQUESTED'` в production.
3. Доставка Telegram-алертов в production (код не задеплоен).
4. Поведение приложения на устройстве (14 шагов).
5. Расписание снапшотов тома Postgres; наличие свежих WAL в бакете сегодня.
6. Копия `tutak-media`.
7. Доступ владельца к Railway (роль, биллинг).
8. Открытые алерты CodeQL на `main`; полный список алертов PR (API 403).
9. Реальная работа Kimi/DeepSeek (ключей нет; проверены только сценарии с
   подменённым fetch и живой BLOCKED-путь в CI).
10. Переменные фронтов admin/partner (`NEXT_PUBLIC_API_BASE_URL`) — не читал в этой задаче.

## F. OWNER ACTIONS BEFORE PILOT (8 пунктов)

1. **Railway ownership.** Открыть: railway.com → аккаунт на своей почте →
   прислать email разработчику → принять приглашение Admin. Нажать:
   Workspace Settings → Members; Billing/Usage; Postgres → Backups.
   Прислать: 3 скриншота + «OWNERSHIP GATE: PASS/FAIL» (§B4).
2. **Production environment.** Открыть Railway → `tutak-api` → Variables;
   сверить с таблицей §B3 по столбцу Expected; прислать список
   «имя = PASS/FAIL» без значений. Заодно включить Postgres Volume Backups
   Daily (§B8).
3. **Legacy payouts.** `railway connect Postgres` →
   `SELECT count(*) FROM payouts WHERE status = 'REQUESTED';` → прислать
   число. 0 = CLOSED; >0 = STOP, сверка по §B2.1.
4. **Merge / deploy.** Только после отдельного разрешения владельца и после
   пунктов 1–3 (и одного внешнего дампа §B8). Порядок —
   `PRE_DEPLOY_CHECKLIST.md`. Не раньше.
5. **Telegram alert.** После деплоя: `railway ssh … --service tutak-api` →
   `node dist/scripts/alert-verify.js` → скриншот TEST-сообщения из чата (§B5).
6. **Mobile.** Пройти 14 шагов §B6 на телефоне с SIM; прислать таблицу
   ✓/✗. Любой ✗ → сообщить, будет отдельная задача.
7. **Staging.** Решить: обязателен ли перед пилотом. Если да — создать
   environment `staging` по §B7 (платно) и прислать URL; если нет — записать
   «STAGING: DEFERRED TO PUBLIC LAUNCH».
8. **Fraud thresholds.** Выбрать 6 значений из §B10 (или оставить default) и
   сказать «ставим до деплоя: …». Отдельно (не срочно, дедлайн 3 мес − 2 нед
   от первой пилотной покупки): решение по чёрному бонусу §B11.

## G. Критерии пилота (§18) — статус

| Критерий | Статус |
|---|---|
| CODE READY | ✅ (`7f53969a`, CI §C) |
| P0 технических = 0 | ✅ |
| P1 технических = 0 | ✅ (P1 «ложный зелёный AI-review» закрыт `34bda477`; CodeQL high — false positive) |
| Владелец контролирует Railway | ⛔ OWNER (F.1) |
| Legacy REQUESTED payouts проверены | ⛔ OWNER (F.3) |
| Production env проверен | 🟡 OWNER VERIFY (F.2) |
| Флаги денег/PSP OFF | ✅ (по отсутствию переменных) |
| Telegram critical alerts реально доставляются | ⛔ NOT VERIFIED (после деплоя, F.5) |
| Mobile physical acceptance PASS | ⛔ OWNER (F.6) |
| Usable safe staging path | 🟡 CI-стек + PITR + Redeploy; отдельный staging — OWNER (F.7) |
| Backup/recovery минимум | 🟡 WAL ✅; снапшоты + внешний дамп — OWNER (F.2/F.4) |
| Пороги антифрода согласованы | ⛔ OWNER (F.8) |
| Emergency freeze работает | ✅ (тест `emergency-freeze.int-spec.ts`, runbook §5) |
| Runbook есть | ✅ (`PRODUCTION_RUNBOOK.md`, `DISASTER_RECOVERY_RUNBOOK.md`, `PRE_DEPLOY_CHECKLIST.md`) |

## H. Три вердикта (§17)

**CODE READY: YES.** Код `7f53969a`; после него менялись только scripts /
workflow / docs (0 файлов в `apps/`); CI на `34bda477` — §C.

**DEPLOYMENT READY: YES — условно, при трёх read-only gate'ах владельца
до нажатия Deploy:** legacy REQUESTED payouts = 0 (F.3), env pre-flight без
FAIL по флагам денег/DEMO_MODE/EMERGENCY_FREEZE (F.2), один внешний дамп
(§B8). Если payouts > 0 → **NO** до сверки. Сам merge/deploy — только по
отдельному разрешению владельца (STOP).

**CONTROLLED BONUS-ONLY PILOT READY: NO.** Открыты не-кодовые gate'ы: Railway
ownership (P0), alert delivery NOT VERIFIED, mobile acceptance, legacy
payouts count, пороги антифрода. Все восемь — в §F; кодовых блокеров нет.
После их закрытия формула «TUTAK: READY FOR CONTROLLED BONUS-ONLY PILOT»
может быть написана без нового кода.

## I. Прочие статусы (§19)

**REAL MONEY: BLOCKED_EXTERNAL** (Idram; флаги OFF).
**PUBLIC LAUNCH: NOT READY** (Sentry, домен, юридика, ruleset strict, регион,
внешний дамп, копия медиа).
**FULL FUEL NETWORK: NOT READY.**
**AI REVIEW: BLOCKED_BY_API_KEY** (честно красный, не блокирует).
**PRODUCTION ALERT DELIVERY: NOT VERIFIED.** **OWNERSHIP GATE: FAIL.**
**MOBILE DEVICE ACCEPTANCE: OWNER ACTION.** **STAGING: OWNER ACTION.**
**LEGACY REQUESTED PAYOUTS: OWNER ACTION.**

## J. Вопросы владельцу

1. Ключи `KIMI_API_KEY` / `DEEPSEEK_API_KEY` будут добавлены (платно)? Если
   нет — оставить job красным или переделать на «серый» neutral-check?
2. CodeQL-алерт `partner-api-key.service.ts:93`: dismiss как false positive
   или отдельная задача на HMAC+pepper с перевыпуском ключей?
3. Staging — обязательный gate пилота или отложить до публичного запуска?
4. Пороги антифрода: 6 значений §B10 — принять рекомендации, оставить
   default или свои?
5. Чёрный бонус: 6 мес/15 000 ежемесячно (документ) или 3 мес/54 000
   суммарно (код)?
