# TuTak Partner Commerce v2 — FINAL CLOSURE REPORT (2026-09-26)

1. **PR:** #70 — https://github.com/arman119090-cmyk/TuTak-Platform/pull/70
2. **Draft:** yes. Не merge, не deploy.
3. **Base:** `main` @ `369eda196581591366fd90efd1ae7a2f20ae5190`; `main` полностью влит в ветку, mergeable_state = `clean`.
4. **Final head SHA (код):** `cbe95662290526659eca55c9df7ee064cb588efd`. Этот отчёт добавлен поверх отдельным коммитом только с `docs/`; его SHA и CI указаны в ответе.

## 5. GitHub checks на `cbe95662`

Реальный GitHub Actions, workflow `CI`, два прогона на один и тот же head: #1131 (push) и #1132 (pull_request).

| Check | #1131 push | #1132 PR |
|---|---|---|
| Lint, test and build (lint, typecheck, sentry parity, audit, unit, история миграций + drift, mobile, demo, admin, partner, Web Checkout, build всех приложений) | ✅ | ✅ |
| Integration tests (1/3) | ✅ | ✅ |
| Integration tests (2/3) | ✅ | ✅ |
| Integration tests (3/3) | ✅ | ✅ |
| Build the container images (образы API/admin/partner, стек, e2e Playwright, мобильное приложение против стека, backup/restore) | ✅ | ✅ |

Все шаги выполнены, не пропущены; пропущены только шаги «on failure».

Остальные workflow на PR не срабатывают по своей конфигурации, и запускать их ради CI небезопасно или неприменимо:
- `android-apk`, `demo-apk`, `ios-build`, `demo-ios` — только `workflow_dispatch`; сборка мобильных бинарников на секретах EAS/подписи.
- `deploy-check`, `proxy-probe`, `map-tile-check` — только `workflow_dispatch`; обращаются к production-стенду.
- `docker-publish` — только push в `main` и теги; публикует образы.

## 6. Какие checks падали

- `1b4321b` (до слияния с main): **Build the container images → e2e**. В e2e кассир подтверждал QR-покупку без смены, а Q4 это запрещает. Дефект был ещё в v2 — предыдущий отчёт его не выявил, потому что GitHub CI тогда не проверялся.
- `b4521b9` (merge-коммит): **Integration tests 1/3 и 3/3** в обоих прогонах. Причины: флаг main `CUSTOMER_PREPAID_TOPUP_ENABLED` (по умолчанию выключен), правило «одна живая покупка», таймаут транзакции. Плюс **Build the container images → e2e** по той же причине, что выше.
- `7485423c`: прогоны отменены (`cancel-in-progress`) новым push `cbe95662`.
- `cbe95662`: падений нет.

## 7. Исправления после `3640d46`

| Коммит | Что |
|---|---|
| `1b4321b` | docs: FINAL DELTA REPORT |
| `b4521b9` | **Слияние `main`** (245 коммитов, 33 конфликта), без изменения правил ни одной из сторон:<br>• `settlePurchase` в форме main: пул по правилу вклада, чтение через транзакцию PSP. Распределение идёт через общий `CommissionDistributionService` (`planForPool`), туда перенесено исправление main «`tx` во всех `accountFor`».<br>• TuTak-деньги нельзя совмещать с `TUTAK_PSP`.<br>• Отмена QR-покупки клиентом возвращает TuTak-деньги из эскроу.<br>• Из нашей (нигде не применённой) миграции убран дубликат `purchase_intents.rejectedByUserId`.<br>• В тестовом харнессе `authGuards` (JWT) разведён с `rbacGuards`.<br>• В Web Checkout добавлен `sessionEpoch`, `next` поднят до ^16.3.5.<br>• `restaurant-journey`: перед кассовыми действиями открывается смена.<br>• `demo/` и lockfile перегенерированы штатными инструментами. |
| `7485423c` | **Реальный дефект:** взаимоблокировка до таймаута 5 с при подтверждении QR-покупки с TuTak-деньгами. Счёт `PARTNER_PAYABLE` создавался внутри транзакции, а `CommerceLedgerService` искал его вне её. Теперь все поиски счетов Partner Commerce, включая погашение удержаний Q8, идут через транзакцию. Тесты: флаг top-up включается в наборах Partner Commerce; гонка смен идёт на двух клиентах; новый тест «PSP + TuTak-деньги отклоняются, отмена возвращает деньги». |
| `cbe95662` | e2e: владелец открывает смену (`POST /shifts/start`) перед подтверждениями. |

Локально на объединённой ветке прошли: lint, typecheck, sentry-parity, unit API (704), web/mobile (partner 95, admin 105, checkout 12+3, mobile 535), `pnpm build`, миграции на чистой БД без дрейфа, 7 наборов Partner Commerce, QR и restaurant (111/111). Тесты не пропускались и не отключались.

## 8. Final CI status

**GREEN** — 10/10 checks на `cbe95662`; PR `clean`, конфликтов нет.

## 9. Внешние blockers и открытые решения

1. **IDRAM** — реальное пополнение баланса TuTak-денег требует договора и credentials. Сейчас пополнение честно отклоняется, фейкового успеха нет. Кроме того, в `main` пополнение по умолчанию выключено (`CUSTOMER_PREPAID_TOPUP_ENABLED`) как открытый юридический вопрос о приёме депозитов.
2. **Деплой** (не выполнялся): хостинг `apps/checkout`, `NEXT_PUBLIC_API_BASE_URL`, origin в `CORS_ORIGINS`, `CHECKOUT_WEB_BASE_URL`; при необходимости `FINANCIAL_POLICY_V2_EFFECTIVE_AT` и `PARTNER_ORDER_CANCELLATION_CLAIM_HOURS`.
3. **Решение за TuTak, не реализовано (новая неоднозначность после слияния):** движок расчётов `main` (`PartnerSettlementService`) выплачивает только виды проводок из allow-list. Виды Partner Commerce на `PARTNER_PAYABLE` в этот список не внесены: `partner_order.*`, `purchase_intent.money_*`, `*.shortfall_settled_at_desk`, `referral.withholding_recovered`. По правилу самого `main` такие суммы не выплачиваются, а видны как находка сверки. Кроме того, у партнёра сосуществуют `settlementPeriod` (выписки Partner Commerce) и `settlementPeriodicity` (движок `main`). Нужно решить, как выплачивать начисления Partner Commerce.

## 10.

Partner Commerce v2 development task: CLOSED
