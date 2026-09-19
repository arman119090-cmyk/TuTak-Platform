# Owner gates + готовность PR #60 к мержу — статус на 19.09.2026 15:31 UTC

## Задание

Проверить по факту manual gates перед мержем PR #60 и довести PR до
состояния «остаётся только безопасный merge». Не мержить, пока gates не
доказаны. Никаких новых аудитов и visual pass.

## База

PR #60, ветка `claude/final-integration-20260919`, HEAD `0b193cc`;
`main` `369eda1` = Railway production (api/admin/partner).

## A. OWNER GATES (по факту, не по отчёту)

| Gate | Статус | Факт |
|---|---|---|
| Wait for CI | **NO** | `checkSuites: false` у tutak-api, tutak-admin, tutak-partner (Railway config, 15:30 UTC) |
| Branch protection | **NO** | default branch `claude/tutak-loyalty-mvp-e485jm`; `main.protected = false` |
| Backup | **NO** | Postgres volume `postgres-volume` (5 GB, sfo) live; никаких сведений о backup/PITR через доступный API; `backup.yml` только в ветке PR #60, secret `RAILWAY_API_TOKEN` не проверяем; UI-evidence владелец не предоставлял |
| Restore | **NO** | не выполнялся (нечего восстанавливать без backup) |
| Human alerts | **NO** | в переменных tutak-api нет `ALERT_WEBHOOK_URL`, `ALERT_TELEGRAM_BOT_TOKEN`, `ALERT_TELEGRAM_CHAT_ID`; Sentry DSN нет ни у одного сервиса |
| Viva | **BLOCKED** | 15:30 UTC, run 35452019648: `https://217.76.49.94/health` → `{"status":"ok","tunnel":"down"}`; OTP-попыток после 16.09 нет (логи API до 15:30) |
| Samsung | не получено | владелец не сообщал результат |
| Xiaomi | не получено | владелец не сообщал результат |

Keyboard focus bug: нет данных. Armenian wallet tab: нет данных. Partner
Spotlight на устройстве: нет данных.

## B. PR #60

| | |
|---|---|
| HEAD | `0b193cc608f2992c2fb075d587e9eef56f011bcf` |
| CI на этом HEAD | success — push run 35450920092 и pull_request run 35450922802, 10/10 check runs (lint/test/build, integration 1–3/3, container images) |
| Mergeability | `mergeable_state: clean`, 0 позади `main`, `merge-tree` без конфликтов |
| Diff vs main | 44 коммита, 361 файл, +13 731 / −2 295 |
| Migrations | 3 новых (`…promo_artwork`, `…partner_promos`, `…partner_promo_translations`), 74 всего |
| Merge result | **НЕ мержился** — ни один из обязательных gates не закрыт |

## C. PRODUCTION (без изменений)

API/Admin/Partner на `369eda1`; все 5 сервисов online, 0 сбоев за 24 ч
(`environment-status`); деньги: `TUTAK_PSP_ENABLED`, `PSP_REFUNDS_ENABLED`,
`CUSTOMER_PREPAID_TOPUP_ENABLED` отсутствуют → выключены; `DEMO_MODE`
задан (значение не читается), `/health` отдаёт `demoMode:false`.

## D. FINAL ANDROID RC

Не собирался: production APK строится с SHA мержа в `main`, мержа не было.
Текущий RC — демо-APK `demo-latest` с `cf87f72`
(SHA-256 `5bfaa13a…06555`), не production.

## E. iOS SIM RC

Не пересобирался по той же причине. Текущий — `preview-ios-simulator` с
`cf87f72`, run 35450065455, SHA-256 `2ed5796c…bd03c`.

## F. REMAINING BLOCKERS (только реальные)

1. Railway → Settings → Source → Wait for CI на трёх сервисах.
2. GitHub → default branch `main`; protection: PR required, required checks
   по текущим именам job'ов: «Lint, test and build», «Integration tests
   (1/3)», «Integration tests (2/3)», «Integration tests (3/3)», «Build the
   container images».
3. Backup Postgres (Railway volume backups / PITR) → restore в **новый**
   сервис → `scripts/verify-restored-db.sh` PASS.
4. Alert-канал (`ALERT_WEBHOOK_URL` или Telegram) → `alert:verify` →
   человек увидел сообщение.
5. VPS 217.76.49.94: `sudo swanctl --initiate --child viva && sudo swanctl
   --list-sas` → `/health` `tunnel: up` → один реальный OTP.
6. Device review демо-APK (Samsung + Xiaomi) по `docs/OWNER_DEVICE_TEST_RU.md`.

Всё шесть — действия владельца/техника вне репозитория. Со стороны кода и
CI PR #60 готов; после закрытия gates: merge → замер T_merge/T_ci/
T_railway → post-merge verify → production APK и iOS sim с SHA `main`.

## FINAL

**NOT READY — Wait for CI, branch protection, backup, restore, human
alerts, Viva tunnel (down), device review.**

## Что НЕ сделано / UNVERIFIED

- Merge, post-merge verify, production APK, iOS sim с `main` — не
  выполнялись: gates не закрыты.
- Backup state через Railway API — недоступен через имеющиеся инструменты;
  нужен `RAILWAY_API_TOKEN` или UI-evidence.
- Тестовая OTP не отправлялась: туннель down, отправка заведомо упадёт.
