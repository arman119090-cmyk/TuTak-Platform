# TUTAK — ЗАКРЫТЬ ПОСЛЕДНИЕ БЛОКЕРЫ LIMITED PILOT: итоговый отчёт

Дата: 19.09.2026. Ветка `claude/railway-connector-check-wy0ffq` (PR #58),
база `main` `369eda1`; head после этой работы — `3b0c42d`.

## Задание (пересказ)

От текущего состояния (main `369eda1`, PR #58, PR #52 не мержить, деньги
выключены) закрыть всё, что закрывается без телефона и UI-действий
владельца: финальный review PR #58; протокол эксперимента Wait for CI;
branch protection; ещё раз все варианты backup и одна команда проверки
восстановленной БД; упростить канал алертов (Telegram, если компактно и
безопасно); перепроверить uptime workflow с self-test; Sentry без скрытых
дефектов; технический hosting privacy/account-deletion с одинаковыми
ссылками; `pilot-verify.sql` как операторский инструмент с PASS/FAIL;
последний adversarial-проход по refund; OTP env overrides (0/negative/
garbage/слишком большое); решить, остаётся ли APK #58 RC; PR #52; матрица
ролей; классификация 40 веток; тег RC только после merge+CI+deploy. В
конце — минимальный список действий Армана и вердикт READY / NOT READY.

---

## 1. PILOT STATUS

**NOT READY — remaining blockers: backup (нужен один секрет или два клика),
alert channel (одна переменная), Wait for CI (тумблер), Android device-test
(два телефона), первая покупка с возвратом (касса).** Ничего из этого не
код. Кодом закрыто всё остальное; воспроизводимого дефекта, срывающего
пилот, в этот проход не найдено (refund выдержал ещё 4 adversarial-кейса).

## 2. WHAT CLAUDE CLOSED NOW (только новое, коммит `3b0c42d`)

| # | Что | Доказательство |
|---|---|---|
| 1 | **Telegram-канал алертов** (`ALERT_TELEGRAM_BOT_TOKEN` + `ALERT_TELEGRAM_CHAT_ID`), composite с webhook; delivered = 2xx **и** `ok:true`; токен вычищается из любого detail/лога; PSP-guard принимает любой из каналов | `telegram-alert.channel.spec.ts` 6/6, `env.validation.spec.ts` +1 |
| 2 | **Юридические страницы** отдаются API: `/legal/privacy`, `/legal/account-deletion`, узкий CSP, выключатель `LEGAL_PAGES_ENABLED` (по умолчанию 404); мобильная строка «Политика конфиденциальности» (скрыта без `LEGAL_BASE_URL`); канонические адреса для панелей/магазина в `docs/LEGAL_PAGES_HOSTING_RU.md` | `legal.controller.spec.ts` 3/3; mobile 530/530; demo перегенерирован |
| 3 | **Sentry release у панелей был `unknown` на Railway** (у tutak-admin/partner нет `GIT_COMMIT_SHA`, а Dockerfile не объявлял `RAILWAY_GIT_COMMIT_SHA`) — исправлено в Dockerfile + next.config | `list-variables` admin/partner; диффы Dockerfile |
| 4 | **Backup через API**: Railway Public GraphQL умеет `volumeInstanceBackupCreate` / `volumeInstanceBackupList` (MCP/агент — нет). `.github/workflows/backup.yml`: ежедневный снимок тома + проверка «новейший < 26 ч» + страница в канал. Нужен secret `RAILWAY_API_TOKEN` | docs Railway «Manage Volumes with the Public API»; YAML валиден; **не запускался** (нет токена, sandbox не достаёт backboard) |
| 5 | **`scripts/verify-restored-db.sh`** — одна команда: миграции, объёмы 11 таблиц, imbalance, счета = проводки, транзакции сбалансированы, кошельки ≥ 0, лоты, refund ≤ gross, точка восстановления; PASS/FAIL, `--compare` с источником | прогнан на локальной схеме: PASS, 71/0 |
| 6 | **`scripts/pilot-verify.sql`** — READ ONLY транзакция (проверено: UPDATE внутри отказывает), один id в одной строке, итоговая таблица 12 проверок + VERDICT | прогнан: PASS 12/12 на реальной покупке; на несуществующем id — FAIL с подсказкой |
| 7 | **Uptime**: логика вынесена в `scripts/uptime-probe.sh`, self-test 15 кейсов (здоровый/503/200-без-JSON/storage error/imbalance/нет токена/нет webhook/webhook 500/transition/reminder) — в CI; пейджит по переходу и раз в час, отсутствие `METRICS_TOKEN` не влияет на health-проверку | `uptime-probe.test.sh` 15/15 локально |
| 8 | **Refund adversarial** +4 теста: full+partial параллельно с разными ключами (никогда > gross, колонка = сумме строк, ledger 0); возврат после того, как начисление партнёра уже забрано расчётом; чужой owner/manager (request, reject, direct); permission без partner scope | `purchase-intent-refund` + `refund-dual-control`: 48/48 |
| 9 | **OTP override** ограничен 10× default (600/1200): 0/negative/garbage → default; 999999 → 600 | spec 4/4 |
| 10 | Wait-for-CI протокол, матрица ролей, классификация 43 веток (A merged 24 / B superseded 12 / C keep 5 / D unknown 2), hosting юр. страниц | `docs/WAIT_FOR_CI_EXPERIMENT_RU.md`, `PILOT_ROLES_RU.md`, `BRANCHES_2026-09-19.md`, `LEGAL_PAGES_HOSTING_RU.md` |

## 3. WHAT ARMAN MUST DO NOW (в этом порядке)

1. **Railway → Postgres → Backups → Enable PITR** (+ daily volume backup) — 5 минут, короткий рестарт БД. *Альтернатива/дополнение без UI*: Railway → Account → Tokens → создать token → GitHub → Settings → Secrets → `RAILWAY_API_TOKEN`; после merge PR #58 запустить Actions → Backup → Run — это и есть «BACKUP EXISTS».
2. **Канал алертов**: либо Telegram — создать бота (@BotFather), добавить в группу, узнать chat id — и задать `ALERT_TELEGRAM_BOT_TOKEN` + `ALERT_TELEGRAM_CHAT_ID` на tutak-api; либо Slack/Discord webhook → `ALERT_WEBHOOK_URL`. Затем `pnpm --filter @tutak/api alert:verify` в Railway shell → сообщение видно → скриншот. Тот же webhook/`ALERT_WEBHOOK_URL` в GitHub Secrets (для Uptime и Backup).
3. **Railway → tutak-api, tutak-admin, tutak-partner → Settings → Source → Wait for CI** = on. Сказать мне — я выполню `docs/WAIT_FOR_CI_EXPERIMENT_RU.md`: merge PR #58, доказательство WAITING → CI → SUCCESS, первый прогон Uptime вручную, тег RC.
4. **GitHub → Settings → Branches → Add rule для `main`**: Require a pull request before merging; Require status checks («Lint, test and build», «Integration tests (1/3)…(3/3)», «Build the container images»); Do not allow bypassing (или allow для себя одного). «Require branches to be up to date» — можно, но каждый PR придётся обновлять кнопкой; для одного разработчика лучше не включать. MCP этого не делает (нет endpoint).
5. **Два телефона** (Samsung, Xiaomi): `docs/ANDROID_DEVICE_TEST_RU.md`, APK run #58, таблица PASS/FAIL, видео шагов 3 и 5.
6. **Первая покупка с возвратом** у пилотного партнёра (раздел 7) и результат `scripts/pilot-verify.sql`.
7. (после юриста) заменить плейсхолдеры в двух HTML, `LEGAL_PAGES_ENABLED=true`, `NEXT_PUBLIC_PRIVACY_URL`, следующая сборка APK с `LEGAL_BASE_URL`.

Sentry: только `SENTRY_DSN` (api) и `NEXT_PUBLIC_SENTRY_DSN` (admin/partner), `SENTRY_DSN` при сборке mobile — когда захочется; для пилота не блокер.

## 4. PR #58

- HEAD: `3b0c42d` (9 коммитов после `main` `369eda1`).
- Diff vs main: 20 файлов на `7670201` + этот коммит; посторонних изменений нет; секретов нет (grep по diff); денежные флаги не включаются; destructive-действий нет (только чтение production через MCP).
- CI: `7670201` — PR-run 5/5 success (push-run 4/5 + один медленный шард). `3b0c42d` — см. UNVERIFIED (запущен при записи).
- Mergeability: `clean` на `7670201`; на `3b0c42d` — после CI.
- **Merge-ready: YES по коду, NO по процессу** — не мержу, пока `checkSuites=false`: merge — доказательство Wait for CI (протокол в `docs/WAIT_FOR_CI_EXPERIMENT_RU.md`).

## 5. PRODUCTION SAFETY

| Область | Состояние | Что нужно |
|---|---|---|
| Backup | **нет** (PITR off, снимков нет) | UI: Enable PITR + daily; или `RAILWAY_API_TOKEN` → workflow Backup |
| Restore | не проводился | после backup: restore → `scripts/verify-restored-db.sh "$RESTORED_URL" --expect-migrations 71 --compare "$SOURCE_URL"` → PASS |
| Wait for CI | `checkSuites=false` | тумблер ×3 → эксперимент |
| Branch protection | `main` не защищён | GitHub Settings (п. 4 выше) |
| Alerts | код готов (webhook и/или Telegram), канала нет | 2 переменные |
| Uptime | workflow + tested script; инертен до `main` | merge + secret |
| Sentry | код на 4 поверхностях, release у панелей исправлен, санитайзер allowlist (request/user/extra/contexts/message/breadcrumb data — отбрасываются целиком) | DSN |
| Metrics | `/metrics` выключен без `METRICS_TOKEN` | по желанию |
| Demo mode | effective false (нет баннера) | удалить переменную (косметика) |
| Legal pages | готовы, 404 до `LEGAL_PAGES_ENABLED` | юрист → включить |

## 6. FINAL PILOT APK

**Остаётся APK из Actions run #58**: `main` `369eda1`, `0.1.0`, versionCode от EAS (remote), API `https://tutak-api-production.up.railway.app/v1`, профиль `production-apk`, SHA-256 `364d9185472ec161452827ade0fe417769e295e73603a45f8cf609e0c1c62c8b`, 127 117 398 байт, без биометрии.
Основание: diff PR #58 по `apps/mobile` — только `eas.json` (профили сборки) и, в `3b0c42d`, строка «Политика конфиденциальности», которая **не рендерится** без `LEGAL_BASE_URL` (в #58 не задан) — runtime на телефоне идентичен. Новый APK нужен только после юриста (с `LEGAL_BASE_URL`) — тогда тег RC переставить.

## 7. FIRST TRANSACTION

1. До: `SELECT coalesce(sum(balance),0) FROM ledger_accounts;` → 0; записать UTC.
2. Клиент (APK #58) → партнёр → 1000 AMD → код; кассир подтверждает в Partner-панели. Ожидание: статус «Подтверждена» в приложении ≤ 10 с; кешбэк «ожидает».
3. Admin → Payments → id покупки → `scripts/pilot-verify.sql` (вписать id в `SET LOCAL tutak.pid`) → таблица: **12 PASS / VERDICT PASS**. «CHECK» в п. 8 — сверить с правилом партнёра, не ошибка.
4. Партнёр → возврат 300 AMD (owner/manager) → снова `pilot-verify.sql`: п. 10 «1 refund, refunded 300 of 1000», п. 6 две транзакции (вторая с `reversesId`), п. 12 = 0; в приложении кешбэк уменьшился.
5. Любой FAIL — STOP, скриншот таблицы мне.

## 8. STOP CONDITIONS

`tutak_ledger_imbalance_amd ≠ 0` / `reconciliation.drift`; любой FAIL `pilot-verify.sql`; двойное подтверждение или двойное начисление; `/health/ready` ≠ 200 > 10 мин; `outbox.dead-letter`; подтверждение без кода клиента; SMS не доходят > 10 % за час.

## 9. OWNER INPUTS

| Вопрос | Ответ сам / нужен владелец |
|---|---|
| Webhook или Telegram? | **Сам**: оба поддержаны; Telegram — 10 минут с телефона, рекомендую его для пилота; webhook — если есть Slack |
| Backup через UI или через API-токен? | **Сам**: UI-PITR обязателен (restore в новый сервис); workflow Backup — дополнительная линия и единственный способ *видеть* бэкапы снаружи. Сделать оба |
| Branch protection «up to date»? | **Сам**: не включать (один разработчик, merge-очередь не нужна) |
| Где хостить privacy? | **Сам**: API `/legal/*`, домен потом |
| Тег RC | после merge+CI+deploy, командой из `docs/BRANCHES_2026-09-19.md` — **владелец** (нет прав на теги из сессии) |
| PR #29 (draft, 55 коммитов дизайна) — закрыть или перенацелить? | **владелец** (бизнес-решение о дизайн-ассетах) |
| Имена в `docs/PILOT_ROLES_RU.md` | **владелец** |

## 10. FINAL SENTENCE

**NOT READY — remaining blockers: backup (PITR или `RAILWAY_API_TOKEN`), alert channel (две переменные + `alert:verify`), Wait for CI (тумблер ×3 → merge PR #58 как доказательство), Android device-test на Samsung/Xiaomi, первая покупка с возвратом. Всё пять — действия Армана; кода не требуют.**

---

## Что НЕ сделано и собственные ошибки

- Backup workflow **не запускался** — нет токена; GraphQL-схема (`volume.volumeInstances`) взята из документации, не проверена вызовом (sandbox до backboard.railway.com не достаёт). Первый прогон вручную покажет.
- Wait-for-CI эксперимент **не проведён** — нужен тумблер.
- Branch protection **не включена** — у GitHub MCP нет endpoint; описано в п. 3.4.
- Panels release fix (`RAILWAY_GIT_COMMIT_SHA` как build ARG) — по документации Railway; подтвердится первым деплоем панелей после merge (Sentry покажет release ≠ unknown) — до тех пор UNVERIFIED.
- Полный локальный integration-прогон после последних правок шёл при записи (см. UNVERIFIED); целевые спеки (refund 48/48, legal, alerts, config, otp) зелёные, CI на `3b0c42d` — в процессе.
- Ошибка: первая версия `pilot-verify.sql` использовала TEMP TABLE в READ ONLY-транзакции и сравнение text = uuid — обе упали на прогоне, исправлено до коммита; проверка 11 давала ложный FAIL из-за NULL от GROUP BY/HAVING — исправлено.
- Ошибка: тест «refund после PAID-расчёта» упёрся в check-constraint `partner_settlements_approved_has_actor`; переписан на DRAFT-claim (PAID-случай уже покрыт `refund-partner-debit`).
- sed по докам заменил `public/privacy.html` → новый путь и в исторических отчётах (LAUNCH_AUDIT, OTCHET_*): содержательно верно, но это правка старых документов.
- PR #29 не закрывал, ветки не удалял — классификация есть, решение владельца.

## Чем доказано

| Проверка | Результат |
|---|---|
| API unit | 53 suites, **705/705** |
| API integration (целевые): refund + dual-control | **48/48** |
| API integration (полный набор) | см. UNVERIFIED |
| Admin / Partner | tsc 0; **105/105**, **92/92** (+4/4 node) |
| Mobile | tsc 0, eslint 0; **530/530**; demo regen без расхождений |
| `uptime-probe.test.sh` | **15/15** |
| `verify-restored-db.sh` на tutak_test | PASS, миграций 71/0 |
| `pilot-verify.sql` | 12/12 PASS на реальной покупке; READ ONLY подтверждён |
| typecheck / lint API | exit 0 |
| CI на `7670201` | PR-run 5/5 success |
| CI на `3b0c42d` | UNVERIFIED (запущен) |

## UNVERIFIED

CI `3b0c42d`; полный локальный integration после `3b0c42d`; `backup.yml` end-to-end; панельный Sentry release на Railway; Wait for CI; всё, что BLOCKED BY ARMAN.
