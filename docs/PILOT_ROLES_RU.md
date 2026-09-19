# Роли на время пилота — кто что делает

Дата: 19.09.2026. Имена вписывает Арман; одна и та же персона может занимать
две роли, кроме пар «maker/checker» (заявитель ≠ утверждающий) — это
проверяет код, не договорённость.

| Роль | Кто (вписать) | Доступы, которые нужны | Получает | Делает |
|---|---|---|---|---|
| **Primary on-call** | ____________ | Railway (проект TuTak: логи, Backups, Variables, Deployments); Admin-панель (ADMIN); канал алертов (webhook/Telegram-группа); телефон с Partner-панелью; `docs/RUNBOOK_INCIDENTS_RU.md` | все алерты (`readiness.*`, `uptime.probe`, `backup.volume`, `outbox.dead-letter`, `sweep.failed`, `storage.unreachable`) | первый ответ по runbook; Deactivate/Reactivate пользователей; rollback деплоя; restart Postgres/Redis; фиксирует время и симптом; эскалирует |
| **Secondary approver** | ____________ | Admin-панель с правами `CONTRIBUTION_RULE_APPROVE`, `PARTNER_SETTLEMENT_*` approve, `PSP_RECONCILE` (на будущее); Partner-панель как owner/manager пилотного партнёра | запросы на утверждение (правило партнёра, расчёт, refund request, в будущем PSP reconciliation) | второй человек во всех maker/checker действиях; никогда не тот же, кто предложил |
| **Technical escalation** | ____________ | GitHub (репо), Railway shell, доступ к БД (Railway Data), Sentry (когда включат) | `reconciliation.drift` / `tutak_ledger_imbalance_amd ≠ 0`; `readiness.database.unreachable` дольше 10 мин; неуспешный rollback; повторный dead-letter; любой FAIL из `scripts/pilot-verify.sql` или `scripts/verify-restored-db.sh` | root cause в коде/данных; PITR restore и переключение `DATABASE_URL`; миграции; повтор DEAD-строк кодом |
| **Владелец пилота** (Арман) | Арман | всё выше + GitHub Settings + Railway Settings | всё, что эскалировано; еженедельная сводка | решения: STOP пилота, перенос баллов, изменение правил партнёра, юридические тексты |

## Минимум для старта

Primary on-call и Technical escalation могут быть одним человеком на
первую неделю; Secondary approver — **обязательно другой** человек (иначе
refund request и правила партнёра нельзя утвердить: код отказывает тому же
пользователю).

## Канал

Один канал для всех алертов (`ALERT_WEBHOOK_URL` или Telegram-группа с
ботом: `ALERT_TELEGRAM_BOT_TOKEN` + `ALERT_TELEGRAM_CHAT_ID`), в нём все
три роли. Проверка канала: `pnpm --filter @tutak/api alert:verify` →
сообщение видно в канале → скриншот в `docs/PILOT_GATES_2026-09-19.md`.
