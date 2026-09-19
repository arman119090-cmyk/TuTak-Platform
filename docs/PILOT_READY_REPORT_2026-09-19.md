# TUTAK — ДОВЕСТИ ДО READY FOR LIMITED PRODUCTION PILOT: итоговый отчёт

Дата: 19.09.2026. Ветка `claude/railway-connector-check-wy0ffq` (PR #58),
база работы — `main` `369eda1`; последний коммит ветки `9b6634f`.

## Задание (пересказ)

Довести TuTak до состояния «ready for limited production pilot»: проверить
текущую точку; PR #58 — не мержить при `checkSuites=false`, использовать
как тест Wait-for-CI; backup/PITR как P0 с цепочкой BACKUP EXISTS →
RESTORE TO NEW DB → DATA VERIFIED и DR-runbook; цепочка алертов по
событиям; внешний uptime; Sentry; минимальные метрики; DEMO_MODE; факты
Android RC; решение по PR #52; device-test с PASS/FAIL и сбором данных по
клавиатуре; сверка пилотной транзакции; refund D-7; runbook по реальному
коду; честное восстановление доступа; юридическая техпроверка; сценарий
первых 100 пользователей; гигиена веток и release notes. Каждый gate —
CLOSED / BLOCKED BY ARMAN / BLOCKED BY EXTERNAL PARTY / FAILED. «Не
доказывай, что всё хорошо — попробуй сорвать пилот воспроизводимым
дефектом. Не смог — тогда READY.» Не включать деньги, не трогать
production-данные и секреты.

---

## A. PILOT VERDICT

**NOT READY — BLOCKED BY ARMAN (не FAILED).**

Кодом и документацией закрыто всё, что закрывается без человека с
доступом к Railway UI, телефонам и кассе. Воспроизводимого дефекта,
срывающего пилот, найти **не удалось**: 1472 интеграционных и 694
unit-теста зелёные на ветке, нагрузка первого дня на пуле 5 проходит без
отказов, деньги не проходят через TuTak, refund ограничен и аудируем.

Но пилот нельзя объявлять READY, пока верны три факта:
1. **production-база не имеет ни одной резервной копии** (PITR выключен,
   снимков тома нет, внешнего доступа к Postgres нет — `backup.sh` из репо
   к ней не применим);
2. **ни один critical-алерт не доходит до человека** (`ALERT_WEBHOOK_URL`
   не задан; внешний probe заработает только после merge в `main` +
   secret);
3. **Android RC ни разу не открывался на Samsung/Xiaomi**, а именно там
   был дефект клавиатуры.

Каждый из трёх — 10–30 минут действий Армана (раздел F). После них и
одной настоящей покупки с возвратом вердикт меняется на READY без
изменений кода.

## B. GATES

| # | Gate | Состояние | Основание |
|---|---|---|---|
| 1 | Backup существует | **BLOCKED BY ARMAN** | Railway Postgres: `WAL_ARCHIVE_*` нет, `tcpProxies: []`; MCP не включает PITR/снимки. Инструкция: `docs/DISASTER_RECOVERY_RUNBOOK_RU.md` §1 |
| 2 | Restore в новую БД + данные проверены | **BLOCKED BY ARMAN** | зависит от 1; SQL проверки (§4 DR-runbook) прогнаны на схеме 71 миграции: applied=71, failed=0, imbalance=0 |
| 3 | Critical-алерт дошёл до человека | **BLOCKED BY ARMAN** | код: `delivered` = 2xx получателя; readiness-алерты `c321e31`; нужен `ALERT_WEBHOOK_URL` + `alert:verify` + скриншот |
| 4 | Внешний uptime-детект | **CLOSED в коде / BLOCKED BY ARMAN в проде** | `.github/workflows/uptime.yml` (каждые 10 мин, тот же JSON, что у API); расписание GitHub работает только из `main` → нужен merge #58 и secret |
| 5 | Sentry | **BLOCKED BY ARMAN** | код на всех четырёх поверхностях (`sentry.ts`, `instrumentation-client.ts`, `ErrorBoundary`, санитайзер с parity-тестом); `SENTRY_DSN` в production отсутствует; проверка: `pnpm sentry:verify` |
| 6 | Минимальные метрики | **BLOCKED BY ARMAN** | `/metrics` выключен без `METRICS_TOKEN`; набор для пилота: `tutak_ledger_imbalance_amd`, `tutak_outbox_dead_lettered`, `tutak_outbox_pending`, `tutak_reconciliation_drift_findings`, `tutak_sweep_seconds_since_success` — uptime.yml читает первый |
| 7 | DEMO_MODE выключен | **CLOSED** | лог деплоя `f94d56eb`, фильтр «DEMO» → баннера нет ⇒ `demoMode=false` (`DEMO_MODE === 'true'` не выполняется); sandbox-PSP не смонтирован; переменную удалить в UI (косметика) |
| 8 | Деплой ждёт CI | **BLOCKED BY ARMAN** | `checkSuites: false` на tutak-api; MCP не меняет; PR #58 не мержить до тумблера — он и есть тест |
| 9 | Android RC — факты | **CLOSED** | APK #58 из `main` `369eda1`, `0.1.0`, versionCode назначает EAS (remote), API production, профиль `production-apk`, SHA-256 `364d9185…62c8b`, 127 117 398 байт, биометрии нет |
| 10 | Android RC проверен на Samsung и Xiaomi | **BLOCKED BY ARMAN** | `docs/ANDROID_DEVICE_TEST_RU.md`: 12 шагов PASS/FAIL, данные для root cause клавиатуры (модель, клавиатура и версия, Gboard-контроль, автозаполнение, logcat, видео) |
| 11 | Одна настоящая DIRECT-покупка | **BLOCKED BY ARMAN** | шаг 7 device-test; сверка `scripts/pilot-verify.sql` §1–§2 |
| 12 | Cashback/referral после неё | **BLOCKED BY ARMAN** | `pilot-verify.sql` §3–§4; ожидания описаны в шапке скрипта |
| 13 | Refund тестовой покупки | **BLOCKED BY ARMAN** | шаг 11 device-test; `pilot-verify.sql` §5; D-7: в проде только purchase-intent refund, cap `grossAmount − refundedAmount`, `assertPartnerApprover`, audit, деньги TuTak не покидают — **приемлемо для пилота** |
| 14 | Runbook соответствует коду | **CLOSED** | §5/§6/§10 переписаны: «logout everywhere» нет → Deactivate (мгновенно, `buildRequestUserClaims`) или сброс пароля (отзывает refresh); смены номера нет; retry DEAD нет; §2 уточнён: `POST /wallet/admin/adjust` (`WALLET_WRITE`) существует |
| 15 | Восстановление доступа — честно | **CLOSED** | runbook §14: таблица «можно/нельзя»; «верните по имени и покупкам» — нет, никогда |
| 16 | Юридическая техпроверка | **BLOCKED BY EXTERNAL PARTY + ARMAN** | плейсхолдеры `[CONTACT EMAIL]`×17, `[OPERATOR]`×2, `[ADDRESS]`×2 в `public/*.html`; **`public/` никем не раздаётся**; панели ссылаются на `https://tutak.am/privacy` (UNVERIFIED — sandbox не выходит наружу); в мобильном приложении заголовок «Приватность» есть, ссылки на политику нет; записей согласия нет — делать только если юрист потребует |
| 17 | Первые 100 пользователей | **CLOSED** | нагрузка: 60 покупок/10 рефералов/50 OTP без отказов на пуле 5; риск одного wifi закрыт `OTP_IP_ISSUANCE_PER_HOUR` (без деплоя); глобальный лимит 120 req/мин/IP — при мероприятии на одном адресе поднять `RATE_LIMIT_MAX_REQUESTS`; бюджет Viva SMS — `budgeted:viva` в логе, лимит задаётся переменной (значение в проде не читается MCP) |
| 18 | Гигиена веток и release notes | **CLOSED / BLOCKED BY ARMAN** | `docs/PILOT_RELEASE_NOTES_2026-09-19.md`; 43 ветки, 40 устаревших (удалять после пилота); PR #29 draft на мёртвую базу; **`main` без branch protection** и **тег RC не поставлен** — только Арман |
| — | PR #52 биометрия | **DO NOT MERGE FOR PILOT** | комментарий в PR: код зелёный после rebase, но нативный модуль + старт приложения + перехватчик запросов ни разу не запускались на устройстве; ценности для gates нет; условие для MERGE описано |
| — | iOS RC | **BLOCKED BY ARMAN** | Apple-аккаунт + `eas credentials`; CI и профили готовы (`9af3278`) |

## C. NEW DEFECTS (найдено в этой работе)

| # | Дефект | Серьёзность | Статус |
|---|---|---|---|
| D-1 | Runbook v1 (`9af3278`) обещал «Admin → logout everywhere», «ручная смена phone через Admin» и «перевод DEAD в повтор предусмотренным путём» — **ничего из этого в коде нет**. Оператор действовал бы по несуществующим кнопкам | высокая (для эксплуатации) | исправлено `0dacd9f` |
| D-2 | Production Postgres недоступен извне (нет TCP-proxy), в образе API нет `pg_dump` ⇒ `scripts/backup.sh`/`restore.sh` из репо к production **неприменимы**; единственный бэкап — Railway PITR/снимки, которые выключены | P0 | BLOCKED BY ARMAN; DR-runbook написан под реальность |
| D-3 | Потолок OTP 60 выдач/час на IP был константой ⇒ регистрация 100 человек с одного wifi за час физически невозможна без деплоя | средняя (первый день) | исправлено: env-переопределение, spec 3/3 |
| D-4 | Внешний uptime-детект отсутствовал: если API не стартует (упавшая миграция), алерт послать некому | высокая | закрыто `uptime.yml`; активируется после merge + secret |
| D-5 | `main` без branch protection; Railway деплоит до CI | высокая | BLOCKED BY ARMAN (GitHub Settings, Railway UI) |
| D-6 | Мобильное приложение не содержит ссылки на политику конфиденциальности; `public/privacy.html` не раздаётся ни одним сервисом | средняя (магазины, юрист) | BLOCKED BY EXTERNAL PARTY (юрист) + Арман (где хостить) |
| D-7 | Refund security — оценён, дефекта нет: единственный маршрут `POST /purchase-intents/:id/refund` (+ request/approve с запретом «тот же человек») | — | приемлемо для пилота |

## D. CHANGES (коммит `0dacd9f` + ранее в ветке)

| Файл | Что |
|---|---|
| `.github/workflows/uptime.yml` | новый: внешний probe `/health/ready` каждые 10 мин; страница в `ALERT_WEBHOOK_URL`; с `METRICS_TOKEN` — `tutak_ledger_imbalance_amd` |
| `apps/api/src/config/configuration.ts` | `otpIpLimits` из `OTP_IP_ISSUANCE_PER_HOUR` / `OTP_IP_VERIFICATION_PER_HOUR`; `positiveIntEnv` (мусор → default) |
| `apps/api/src/modules/auth/otp-ip-rate-limit.service.ts` | читает потолки из конфига, константы остаются default |
| `apps/api/src/modules/auth/otp-ip-rate-limit.service.spec.ts` | новый: default / override / мусор |
| `docs/DEPLOYMENT.md` | две переменные в таблице |
| `docs/DISASTER_RECOVERY_RUNBOOK_RU.md` | новый |
| `docs/RUNBOOK_INCIDENTS_RU.md` | §2, §5, §6, §10 по коду; §14 таблица восстановления доступа |
| `docs/ANDROID_DEVICE_TEST_RU.md` | 12 шагов PASS/FAIL, root-cause клавиатуры, факты RC |
| `docs/PILOT_RELEASE_NOTES_2026-09-19.md` | новый |
| `scripts/pilot-verify.sql` | новый, read-only, прогнан на схеме |
| Ранее в ветке (`c321e31`, `623d93c`, `9af3278`, `071c4e8`) | readiness-алерты, launch-load, iOS-профили/workflow, пакет юристу, PILOT_GATES |
| GitHub | PR #58 переименован и описан как тест Wait-for-CI; комментарий в PR #52 с DO NOT MERGE FOR PILOT |

Не менялось: production-переменные, флаги денег, данные, секреты.

## E. PRODUCTION STATE (19.09.2026, ~08:30 UTC)

| Что | Значение |
|---|---|
| tutak-api | деплой `f94d56eb` SUCCESS, `main` `369eda1`, restart policy ALWAYS, healthcheck `/health/ready` |
| Postgres | `postgres-ssl:18`, том 5000 MB, приватный; **PITR off, снимков нет** |
| Флаги денег | `TUTAK_PSP_ENABLED`, `PSP_REFUNDS_ENABLED`, `CUSTOMER_PREPAID_TOPUP_ENABLED`, `IDRAM_*` — **отсутствуют** ⇒ false |
| SMS | `budgeted:viva` (лог старта) |
| DEMO_MODE | переменная есть, **эффективно false** (нет баннера) |
| Наблюдаемость | `ALERT_WEBHOOK_URL`, `SENTRY_DSN`, `METRICS_TOKEN` — отсутствуют |
| Railway source | `checkSuites: false` |
| CI | `071c4e8` 10/10 зелёных; `9b6634f` (head PR #58, включает весь код): pull_request-run 35432450617 — **5/5 success** (08:44 UTC); push-run 35432448690 — 4/5 success, шард Integration 3/3 ещё выполнялся на 08:49 (те же тесты, в PR-run прошли) |
| Открытые PR | #58 (эта ветка), #52 (биометрия), #29 (draft, мёртвая база) |

## F. MANUAL ACTIONS (только то, что нельзя сделать без Армана)

1. **Railway → Postgres → Backups → Enable PITR** + daily volume backup (10 мин, короткий рестарт Postgres). Через сутки — восстановить в новый сервис и прогнать §4 DR-runbook, вписать строку в §7.
2. **Railway → tutak-api (и admin, partner) → Settings → Source → Wait for CI** = on. Затем merge PR #58 и наблюдать: деплой `WAITING` → CI зелёный → `SUCCESS`.
3. **Канал алертов**: создать webhook (Slack/Telegram-мост), задать `ALERT_WEBHOOK_URL` в tutak-api, запустить `pnpm --filter @tutak/api alert:verify` (Railway shell), прислать скриншот. Тот же URL — в GitHub → Settings → Secrets → `ALERT_WEBHOOK_URL`; при желании `METRICS_TOKEN` (и та же переменная в tutak-api).
4. **Sentry** (бесплатный план): `SENTRY_DSN` для api/admin/partner/mobile, `pnpm sentry:verify`.
5. **Два телефона**: `docs/ANDROID_DEVICE_TEST_RU.md`, таблица PASS/FAIL, видео шагов 3 и 5.
6. **Первая покупка с возвратом** у реального партнёра (раздел G).
7. GitHub → Settings → Branches → protection для `main`; тег `pilot-rc-2026-09-19` на `369eda1`; закрыть PR #29; удалить переменную `DEMO_MODE`.
8. Юристу — `docs/LEGAL_PACKAGE_FOR_LAWYER_2026-09-19.md`; решить, где хостить `privacy.html` (сейчас нигде).
9. Назначить дежурного по runbook и второго человека с `PSP_RECONCILE`/`CONTRIBUTION_RULE_APPROVE`.

## G. FIRST PILOT TRANSACTION (протокол)

1. До: записать UTC-время; `SELECT coalesce(sum(balance),0) FROM ledger_accounts` = 0.
2. Клиент (RC APK) → партнёр → сумма 1000 AMD → код; кассир в Partner-панели подтверждает.
3. Сразу: в приложении статус «Подтверждена» ≤ 10 с; кошелёк — кешбэк «ожидает».
4. Admin → Payments → id покупки → `scripts/pilot-verify.sql` с этим id: §1 CONFIRMED/DIRECT_PARTNER/refundedAmount=0; §2 одна транзакция, delta=0; §3 один лот ACCRUAL_PURCHASE = ожидаемой сумме по правилу партнёра; §4 пусто (или REWARDED, если по коду); §7 = 0.
5. Возврат 300 AMD партнёром → §5 одна строка с `ledgerTransactionId`; §2 вторая транзакция с `reversesId`; §3 лот уменьшен; §7 = 0; приложение показывает новый кешбэк.
6. Все семь цифр — в отчёт о пилоте. Любое несовпадение = STOP.

## H. STOP CONDITIONS

Ledger imbalance ≠ 0 или `reconciliation.drift`; двойное подтверждение
или двойное начисление; `/health/ready` ≠ 200 > 10 мин; любой
`outbox.dead-letter`; подтверждение без кода клиента; SMS не доходят
> 10 % за час; любой алерт `readiness.*.unreachable` без восстановления
за 10 мин. Действия — по `docs/RUNBOOK_INCIDENTS_RU.md`, деньги через
TuTak не идут, поэтому остановка = «кассиры не подтверждают покупки».

## I. AFTER PILOT

Idram (по `IDRAM_ACTIVATION_READINESS`), PSP refunds, копия БД вне
Railway (DR-runbook §6), PR #52 после device-теста, iOS через EAS, Wait
for CI как постоянная норма, удаление 40 веток, branch protection,
Sentry release health, метрики в Grafana Cloud, ротация `JWT_REFRESH_SECRET`
и Viva-ключей по графику.

---

## Что НЕ сделано и собственные ошибки

- **Не включён PITR, не проведён restore, не задан webhook, не проверен
  телефон, не проведена покупка** — всё требует UI/устройств/кассы,
  недоступных из этой сессии. Не «не дошли руки», а невозможно отсюда.
- **Ошибка в промежуточной сводке**: я считал, что маршрута ручной
  корректировки бонусов нет; он есть — `POST /wallet/admin/adjust` и
  экран Admin → Bonus. Runbook §2 исправлен, чтобы не унести ошибку в
  документ.
- **Ошибка в runbook v1** (моя же, коммит `9af3278`): три несуществующие
  возможности (D-1). Найдена при сверке с контроллерами, исправлена.
- **Неудобство в проверке**: `jest --selectProjects integration <файлы>`
  воспринял имена файлов как имена проектов и прогнал весь набор (1472
  теста, ~10 мин) вместо двух файлов. Результат полезнее, вреда нет.
- `uptime.yml` **не срабатывает до merge в `main`** — GitHub запускает
  расписание только с default-ветки; это не обходится.
- Не написан тест для `uptime.yml` (bash в CI) — проверен только YAML и
  логика чтением; первый реальный прогон = после merge (`workflow_dispatch`).
- Значения production-переменных (`DEMO_MODE`, бюджет SMS) через MCP
  не читаются — выводы сделаны по поведению (лог старта).
- Не проверял `https://tutak.am/privacy` — sandbox не выходит наружу.

## Чем доказано

| Проверка | Результат |
|---|---|
| API unit (`jest --selectProjects unit`) | 51 suites, **694/694** |
| API integration (полный набор, локальный Postgres+Redis) | 112 suites, **1472/1472**, exit 0 |
| `otp-ip-rate-limit.service.spec.ts` | 3/3; `configuration.spec.ts` 13/13 |
| `pnpm run typecheck` (build + spec) | exit 0 |
| `pnpm run lint` | 0 ошибок после правки spec (было 2 `require-await`) |
| `scripts/pilot-verify.sql`, SQL DR-runbook | `psql -v ON_ERROR_STOP=1` на `tutak_test` (71 миграция): 0 ошибок, applied=71/failed=0 |
| `uptime.yml` | YAML валиден; actionlint недоступен в sandbox |
| CI на `071c4e8` | 10/10 success |
| CI на `9b6634f` (head PR #58) | PR-run **5/5 success**: Lint/test/build, Build the container images (e2e + backup/restore rehearsal), Integration 1/3, 2/3, 3/3; push-run 4/5 + один шард ещё шёл |
| Railway | `describe-service` Postgres, `list-deployments` api, `get-logs` `f94d56eb` (фильтры DEMO, SMS transport) |

## UNVERIFIED

- Последний шард push-run на `9b6634f` (Integration 3/3) — на момент записи ещё шёл; PR-run на том же SHA полностью зелёный.
- Первый реальный прогон `uptime.yml` и приём webhook.
- RPO ≈ 60 с и время restore 5 GB на Railway — из документации, не измерены.
- Поведение restore тома Railway (заменяет ли текущий том).
- Доступность `https://tutak.am/privacy`.
- Значение `DEMO_MODE` как строки (эффект — false, доказан по логу).
- Всё, что помечено BLOCKED BY ARMAN — по определению.

## Вопросы владельцу

1. Куда слать алерты — Slack или Telegram? От этого зависит формат webhook (текущий JSON — Slack-совместимый `text`).
2. Мероприятие первого дня на одном wifi планируется? Если да — заранее `OTP_IP_ISSUANCE_PER_HOUR=300`, `RATE_LIMIT_MAX_REQUESTS` ×3.
3. Где будет жить `privacy.html` — домен `tutak.am` существует и на что указывает?
4. Согласны ли вы, что PR #52 ждёт окончания пилота?
