# TUTAK — FINAL GATE EXECUTION → LIMITED PILOT: отчёт о проверке состояния

Дата: 19.09.2026, ~10:30 UTC. Ветка `claude/railway-connector-check-wy0ffq`
(PR #58), head `e60c34c`; `main` `369eda1`.

## Задание (пересказ)

Без новых аудитов: проверить, что сделал Арман (PITR/backup, `checkSuites`,
канал алертов, branch protection, secrets); при `checkSuites=true` ×3 —
merge PR #58 по протоколу Wait for CI, production verify, живой backup +
restore, `alert:verify` в production, live uptime, новый APK из merge-SHA,
device-test, первая DIRECT-покупка и refund, тег RC; итог READY / NOT READY.
Если действие Армана не сделано — не повторять большой отчёт, дать точное
недостающее действие.

## Что проверено (факты, 10:30 UTC)

| Gate | Факт | Источник |
|---|---|---|
| PITR | **выключен** — у Postgres нет переменных `WAL_ARCHIVE_*`; последний деплой Postgres 01.09 (после включения PITR был бы редеплой) | `describe-service` Postgres |
| Backup schedule / snapshot | не видно без токена; считать **нет** | — |
| `checkSuites` tutak-api / admin / partner | **false / false / false** | `get-service-config` ×3 |
| Restart policy | api `ALWAYS`; admin/partner `restartPolicyMaxRetries 3` | там же |
| Канал алертов на tutak-api | **нет** ни `ALERT_WEBHOOK_URL`, ни `ALERT_TELEGRAM_BOT_TOKEN`/`ALERT_TELEGRAM_CHAT_ID` (по именам переменных, значения не читались) | `get-service-config` api |
| Branch protection `main` | **нет** (`protected: false`) | `list_branches` |
| Secrets `RAILWAY_PROJECT_TOKEN` / `ALERT_WEBHOOK_URL` в GitHub | MCP не показывает имена secrets; workflows Backup/Uptime **отсутствуют в списке** (они ещё не в `main`) | `list_workflows` |
| PR #58 | head `e60c34c`, `mergeable_state: clean`, CI на `e60c34c`: push-run 35437097170 **5/5**, PR-run 35437098429 **5/5** | GitHub |
| Production | все три сервиса на `369eda1`, SUCCESS 07:30 UTC | `list-deployments` |

**Итог проверки: ни одно из действий Армана ещё не выполнено.** Ничего из
разделов 2–12 задания выполнить нельзя: merge заблокирован намеренно
(`checkSuites=false` — merge должен стать доказательством Wait for CI),
backup/restore/alert-verify/uptime требуют токена, канала и merge, APK —
merge-SHA, device-test и покупка — телефонов и кассы.

Ничего в production не менялось; деньги выключены.

## Точные недостающие действия (в этом порядке)

1. **Railway → tutak-api, tutak-admin, tutak-partner → Settings → Source → «Wait for CI» = on** (3 тумблера). После этого я мержу PR #58 и веду протокол `docs/WAIT_FOR_CI_EXPERIMENT_RU.md`.
2. **Railway → Postgres → Backups → «Enable PITR»** (подтвердить; короткий рестарт БД) и там же **Backup schedules → Daily**.
3. **Railway → проект TuTak → Settings → Tokens → New token** (environment: production) → **GitHub → Settings → Secrets and variables → Actions → New secret `RAILWAY_PROJECT_TOKEN`**; **Variables → `BACKUP_ENSURE_SCHEDULE` = `DAILY,WEEKLY`**. После merge я запускаю Backup вручную — это BACKUP EXISTS по живому API.
4. **Канал алертов**: Telegram — создать бота в @BotFather, добавить в группу, получить chat id (переслать сообщение боту @userinfobot или `getUpdates`) → **Railway → tutak-api → Variables → `ALERT_TELEGRAM_BOT_TOKEN`, `ALERT_TELEGRAM_CHAT_ID`** (или Slack/Discord webhook → `ALERT_WEBHOOK_URL`). Тот же HTTP-webhook (если есть) → GitHub secret `ALERT_WEBHOOK_URL` для Uptime/Backup. Затем `railway ssh -s tutak-api -e production -- node dist/scripts/alert-verify.js` и скриншот сообщения мне.
5. **GitHub → Settings → Branches → Add rule `main`**: require PR; required checks `Lint, test and build`, `Integration tests (1/3)`, `(2/3)`, `(3/3)`, `Build the container images`.

Телефоны (Samsung, Xiaomi) и кассир пилотного партнёра — после нового APK
из merge-SHA (собираю сам после п. 1).

## A–K (по форме задания)

- **A. PILOT VERDICT: NOT READY.**
- **B.** PR #58 не мержился (Wait for CI off); head `e60c34c`, CI 10/10; causal evidence — нет (эксперимент не начат).
- **C.** Production `369eda1` ×3, health по Railway healthcheck OK; миграции 71; флаги денег отсутствуют; DEMO_MODE effective false.
- **D.** BACKUP: **NOT VERIFIED** (PITR off, токена нет). RESTORE: **NOT VERIFIED**.
- **E.** Alert accepted / human received: **NO** (канала нет). Uptime live probe: **не запускался** (workflow не в `main`).
- **F.** Final APK: **не собран** (нет merge-SHA). APK #58 — только исторический.
- **G.** Device test: Samsung —, Xiaomi —; keyboard bug — не проверялся.
- **H.** First purchase: —. **I.** Refund: —.
- **J. Remaining blockers:** пять действий выше; затем device-test и первая покупка+refund.
- **K. NOT READY — Wait for CI (3 тумблера), PITR + backup token, alert channel + alert:verify, branch protection; после них: merge, backup/restore evidence, new APK, device test, first purchase + refund.**

## Что НЕ сделано

Всё из разделов 2–12 — заблокировано отсутствием действий 1–5. Собственных
ошибок в этом проходе нет; кода не менялось.

## Чем доказано

Только чтение состояния: Railway `describe-service`/`get-service-config`
×3/`list-deployments`, GitHub `list_branches`/`list_workflows`/PR #58
check-runs. Числа — в таблице выше.

## UNVERIFIED

Наличие backup schedule/снимков (не читается без токена); имена GitHub
secrets (MCP не отдаёт).
