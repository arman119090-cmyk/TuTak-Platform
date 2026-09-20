# TUTAK — FINAL INFRASTRUCTURE REHEARSAL BEFORE LIMITED PILOT: отчёт

Дата: 19.09.2026. Ветка `claude/railway-connector-check-wy0ffq` (PR #58),
база `main` `369eda1`; head после этой работы — `2c433a8`.

## Задание (пересказ)

Не проводя общий аудит, закрыть или максимально доказать последние
инфраструктурные предположения: backup workflow (не по предположению, а по
схеме API), restore verification (adversarial, невозможность записи),
uptime workflow (особенно состояние между запусками), Telegram/webhook
delivery adversarially и семантика composite, alert:verify без копирования
секретов, Wait-for-CI как causal ordering и fail-path, branch protection vs
Wait for CI с фактическими именами checks, PR #58 integrity, финальное
решение по APK. Деньги/prod-данные не трогать.

## Актуальное состояние (перепроверено в начале)

| Что | Факт |
|---|---|
| `main` | `369eda1` |
| PR #58 head в начале / сейчас | `5735d75` → `2c433a8` |
| CI на `5735d75` | push-run 35434714675 **5/5**, PR-run 35434717177 **5/5** |
| Mergeability | `clean` |
| Railway production SHA | `369eda1` на api, admin, partner (деплои `f94d56eb`, `8fea69ba`, `ab7fe4a4`, все SUCCESS 07:30 UTC) |
| `checkSuites` | `false` на всех трёх |
| Restart policy | api `ALWAYS`; admin/partner `restartPolicyMaxRetries: 3` (тип не задан = ON_FAILURE) |
| PITR / снимки | нет `WAL_ARCHIVE_*`; расписание снимков через API не читается без токена — считать выключенным |
| Alert-переменные на api | `ALERT_WEBHOOK_URL`, `ALERT_TELEGRAM_*` — **отсутствуют** |
| GitHub secrets | MCP не даёт список имён secrets; `RAILWAY_*`/`ALERT_WEBHOOK_URL`/`METRICS_TOKEN` считаются **не заданными** |
| Открытые PR | #58 (этот), #52 (не для пилота), #29 (draft) |

---

## 1. NEW FINDINGS (не было в предыдущих отчётах)

1. **Схема Railway получена и сверена** (`railwayapp/cli` `src/gql/schema.json`, 830 КБ): `volumeInstanceBackupCreate(volumeInstanceId!, name): WorkflowId { workflowId }` — возвращает **workflow, не результат**; завершение надо опрашивать `workflowStatus(workflowId) { status: Complete|Error|NotFound|Running, error }`. Предыдущая версия workflow ждала `sleep 60` и не проверяла завершение — исправлено.
2. **Project token использует другой заголовок** — `Project-Access-Token`, не `Authorization: Bearer` (документация Public API). Предыдущая версия работала бы только с account/workspace token. Теперь поддержаны оба; project token (scope = один environment) — рекомендуемый.
3. **Расписание снимков можно поставить через API**: `volumeInstanceBackupScheduleUpdate(volumeInstanceId!, kinds: [DAILY|WEEKLY|MONTHLY]!)`. Скрипт ставит его, только если расписаний нет вовсе (никогда не перезаписывает).
4. **`Volume.volumeInstances` — connection** (`edges { node { id environmentId state currentSizeMB … } }`); `VolumeInstance.state` имеет `READY|RESTORING|MIGRATING|…` — скрипт отказывается снимать бэкап не-READY тома.
5. **Railway API**: HTTP 200 с `errors[]` — штатный способ сообщить об отказе (включая «Not Authorized»); 429 с `Retry-After`; лимит 1000 RPH (Hobby). Скрипт проверяет `errors` на каждом ответе и падает на не-JSON теле.
6. **Uptime «transition»-логика**: состояние между запусками — это история runs GitHub (`gh api …/workflows/uptime.yml/runs?status=completed&per_page=1`), т.е. сохраняется; но **recovery-уведомления не было** — добавлено (`uptime.probe.recovered`, только в transition-режиме и только с webhook).
7. **`verify-restored-db.sh` мог быть запущен на production URL** и не имел гарантии read-only — теперь read-only сессия (`PGOPTIONS=-c default_transaction_read_only=on`, проверяется попыткой создать temp-таблицу), отказ от `postgres.railway.internal`, от одинаковых URL, от пустой базы; добавлены duplicate/unfinished migrations, missing tables, orphan postings, «restored больше source».
8. **Негативный кошелёк невозможен на уровне схемы** (`wallets_balances_non_negative`) — проверка в скрипте остаётся как belt-and-braces; self-test доказывает сам constraint.
9. **Внешней копии БД не существует** — при потере проекта/аккаунта Railway база невосстановима. Подготовлен (не включён) `infra/offsite-backup`.
10. **Мобильный runtime после merge отличается от APK #58** (см. §8).

## 2. BACKUP WORKFLOW — **FIXED, контракт VALIDATED против схемы; end-to-end STILL UNVERIFIED**

- Что проверено: имена mutation/query, имена аргументов, формы ответов, заголовок auth (оба вида), volume vs volumeInstance, поиск инстанса по environment, форма списка, формат `DateTime` (RFC 3339 UTC), состояния workflow, коды ошибок и 429 — по схеме и документации; логика — `scripts/railway-backup.test.sh` **29/29** против mock, говорящего теми же формами (в CI).
- Fail loudly: нет токена (запрос не делается) · token чужого environment · volume не найден (200+errors) · нет инстанса в environment · том не READY · create вернул null workflowId · create вернул errors · workflow Error/NotFound/не завершился · бэкап не появился в списке · список пуст · новейший старше 26 ч · список не массив · 502/HTML · 429 · недоступный API · неверный ENSURE_SCHEDULE. Токен не печатается.
- Почему всё ещё UNVERIFIED: ни одного вызова к настоящему `backboard.railway.com` (нет токена; sandbox до хоста не достаёт). Первый `workflow_dispatch` после добавления `RAILWAY_PROJECT_TOKEN` — единственное доказательство. Pagination `volumeInstances` не нужна (один инстанс на environment); `volumeInstanceBackupList` — plain list.

## 3. RESTORE — что будет проверено после PITR restore

`scripts/verify-restored-db.sh "$RESTORED_URL" --expect-migrations 71 --compare "$SOURCE_URL"` (self-test 19/19): подключение и read-only гарантия; `_prisma_migrations` есть, applied = 71, failed = 0, duplicates = 0; 11 таблиц на месте; счётчики 11 таблиц + CONFIRMED против источника (restored > source = FAIL); imbalance = 0; balance каждого счёта = сумма проводок; каждая транзакция = 0; кошельки ≥ 0; лоты; refund ≤ gross; orphan postings = 0; точка восстановления по данным. Вердикт одной строкой PASS/FAIL.

## 4. UPTIME

- **PROBE LOGIC**: `scripts/uptime-probe.sh`, self-test **21/21**: healthy/503/200-без-JSON/storage error/imbalance/нет токена/нет webhook/webhook 500 (exit 2)/transition/reminder/recovery/секреты не печатаются. curl без `-L`: редирект = проблема (правильно — редирект на чужой хост не «здоров»); DNS/TLS/timeout → rc≠0 → проблема.
- **STATE BETWEEN RUNS**: хранится в GitHub (conclusion последнего завершённого run того же workflow, `permissions: actions: read`). Первый запуск: prev=unknown → пейджит (безопасно). `gh api` недоступен → unknown → пейджит. Дубли: concurrency-group `uptime`, `cancel-in-progress: false`. Шторм: пейдж при переходе + напоминание раз в час (первый прогон часа) + recovery.
- **ALERT DELIVERY**: тот же JSON, что у `WebhookAlertChannel`; 2xx = принято, иначе exit 2 и `::error::`.
- **RESIDUAL RISK**: GitHub задерживает schedule (типично 3–15 мин — «поздняя проверка всё равно проверка»); GitHub Actions down → наблюдатель слеп (статус GitHub — единственный сигнал); Actions отключены в репо / secret удалён / workflow сломан новым коммитом → CI-контракт-тест ловит поломку скрипта, но не удалённый secret — тогда run падает с `::warning::` каждые 10 минут, что само по себе заметно в Actions. **GOOD ENOUGH FOR LIMITED PILOT**: да, при заданном `ALERT_WEBHOOK_URL`. **RECOMMENDED FOR PUBLIC PRODUCTION**: внешний класс решения — hosted uptime monitor с несколькими регионами и своим on-call (SMS/звонок), независимый от GitHub; GitHub-probe оставить как второй наблюдатель.

## 5. TELEGRAM / WEBHOOK — точная семантика

- Telegram: delivered ⇔ HTTP 2xx **и** `ok:true` в JSON. 200+ok:false, 400/401/403/429(+retry_after), не-JSON, timeout, DNS/сеть — не delivered, без throw, без retry (честный отказ важнее); `description` попадает в detail **после** scrub; токен вычищается из detail, из Logger, из сообщений исключений; текст обрезается до 4000, `parse_mode` не задаётся (спецсимволы — как есть); неверный chat id = ok:false. Тесты: 6 + 9 adversarial.
- Composite (оба канала заданы): отправка **параллельно в оба**; `delivered = true`, если **хотя бы один** принял; `detail` перечисляет каждый; при частичном отказе — `warn` в лог с именем и причиной отказавшего; оба отказали → `delivered=false`; бросивший канал не роняет второй. Один канал задан → он используется напрямую (без composite).
- `alert:verify` → `sent` только при `delivered`; текст ошибок канал-нейтральный.

## 6. WAIT FOR CI — эксперимент готов: **YES**

`docs/WAIT_FOR_CI_EXPERIMENT_RU.md`: шесть отметок (`T_merge`, `T_ci_start`, `T_ci_finish`, `T_deploy_created`, `T_build_start`, `T_success`); PASS = `T_build_start ≥ T_ci_finish` и статус до этого `WAITING`; появление объекта deployment раньше CI — допустимо. Fail-path по документации: failed → skipped немедленно, production на прежнем SUCCESS, ручной cancel не нужен; cancelled блокирует только без другого успешного workflow; > 2 ч → skipped; следующий зелёный коммит — свой deployment. Помечено UNVERIFIED до первого красного CI на `main` (намеренно не ломали). Branch protection vs Wait for CI — таблица с фактическими именами job: `Lint, test and build`, `Integration tests (1/3)`…`(3/3)`, `Build the container images`.

## 7. PR #58 — **SAFE TO MERGE AFTER ARMAN ACTIONS: YES**

На `2c433a8`: 73 файла vs `main` (+4192 −53); **миграций нет, lockfile/package.json не менялись**; секретов в diff нет (grep); денежные флаги не включаются; runtime API: alerts (Telegram/composite), legal pages (404 по умолчанию), readiness-alerts, OTP-override; runtime панелей: только Sentry release; runtime mobile: строка Settings (скрыта без `LEGAL_BASE_URL`) + i18n; workflow permissions: `contents: read` (+ `actions: read` у uptime); документация. CI на `2c433a8`: push-run 35436663914 **5/5 success**, PR-run 35436667306 **5/5 success** (в «Lint, test and build» входят оба новых контракт-теста). Условие merge не меняется: сначала Wait for CI.

## 8. FINAL APK DECISION — **REBUILD AFTER MERGE REQUIRED**

Не по впечатлению: `git diff 369eda1..HEAD -- apps/mobile/src apps/mobile/app.config.js packages/i18n/src` — 4 файла (SettingsScreen.tsx, app.config.js `extra.legalBaseUrl`, три locale). Даже со скрытой строкой код и i18n-ключ **входят в JS-bundle** → бинарник после merge отличается от APK #58. Функционально эквивалентен (строка не рендерится без `LEGAL_BASE_URL`), но правило «RC = коммит, который реально в production» дешевле соблюсти: после merge и SUCCESS-деплоя — Actions → Build Android APK из `main` (merge-SHA), профиль `production-apk`, зафиксировать SHA-256/размер/versionCode, тег `pilot-rc-<дата>` на тот же SHA. До этого APK #58 годится только для device-test клавиатуры, не как финальный RC.

## 9. ARMAN ACTIONS (максимум 5, по порядку)

1. **Railway → Postgres → Backups → Enable PITR** (+ снимки daily) **и** project token (Settings → Tokens, environment production) → GitHub Secrets `RAILWAY_PROJECT_TOKEN`, Variables `BACKUP_ENSURE_SCHEDULE=DAILY,WEEKLY`.
2. **Канал алертов**: Telegram-бот в группу → `ALERT_TELEGRAM_BOT_TOKEN` + `ALERT_TELEGRAM_CHAT_ID` на tutak-api (или `ALERT_WEBHOOK_URL`); тот же webhook в GitHub Secrets `ALERT_WEBHOOK_URL` (для Uptime/Backup — им нужен именно HTTP-webhook; Telegram-мост можно сделать позже). Затем с ноутбука: `railway ssh -s tutak-api -e production -- node dist/scripts/alert-verify.js` → скриншот.
3. **Wait for CI = on** на api/admin/partner → сказать мне: merge PR #58 по протоколу, первый `workflow_dispatch` Uptime и Backup (это и есть BACKUP EXISTS), затем restore в новый сервис → `verify-restored-db.sh` (RESTORE EVIDENCE), затем новый APK из merge-SHA + тег.
4. **GitHub → Branches → protection для `main`** с пятью checks из §6.
5. **Два телефона + первая покупка с возвратом** — после нового APK (п. 3).

## 10. FINAL STATUS

**NOT READY — CODE/INFRA PREPARATION COMPLETE, WAITING FOR PHYSICAL EVIDENCE**
(backup, restore evidence, human alert delivery, Wait for CI, device test, first DIRECT purchase + refund).

---

## Что НЕ сделано / ошибки

- Ни один вызов Railway GraphQL не сделан по-настоящему (нет токена, sandbox блокирует `backboard.railway.com`): контракт проверен по схеме и mock, не по живому API.
- Fail-path Wait for CI — из документации; `main` не ломали.
- Внешняя копия БД подготовлена, но не включена (нужен bucket + `age`-ключ владельца).
- GitHub secrets по именам не читаются через MCP — считаю незаданными.
- Ошибки по ходу: (1) первая версия backup-workflow ждала `sleep 60` вместо `workflowStatus` и не знала про `Project-Access-Token`; (2) контракт-тест дважды «висел» из-за `POLL_SECONDS=0` (патч не применился: моя же `pkill -f` убила собственную оболочку); (3) mock держал состояние между кейсами → 3 ложных FAIL, исправлено `reset`; (4) self-test restore: seed с балансами без проводок сам ронял проверку, «негативный кошелёк» невозможен по схеме — переписано; (5) `verify-restored-db.test.sh` v1 загрязнял копию между кейсами — теперь свежая копия на кейс.

## Чем доказано

| Проверка | Результат |
|---|---|
| `scripts/railway-backup.test.sh` (mock по схеме) | **29/29** |
| `scripts/uptime-probe.test.sh` | **21/21** |
| `scripts/verify-restored-db.test.sh` (локальный Postgres, копии template) | **19/19** |
| API unit (alerts adversarial + composite + alert-verify + legal + config) | 53 suites, **716/716** |
| API lint / typecheck (spec) | 0 / 0 |
| YAML uptime/backup/ci, `bash -n` четырёх скриптов | ok |
| CI на `5735d75` | 10/10 |
| CI на `2c433a8` | push-run **5/5**, PR-run **5/5** (10:16 UTC) |

## UNVERIFIED

live Railway API; Wait for CI fail-path; `infra/offsite-backup` (никогда не собирался); всё BLOCKED BY ARMAN.
