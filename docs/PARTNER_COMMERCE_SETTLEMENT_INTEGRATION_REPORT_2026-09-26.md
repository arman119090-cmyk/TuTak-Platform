# TuTak — Partner Commerce Settlement Integration: отчёт (2026-09-26)

## 0. Задание (пересказ)

«TUTAK — PARTNER COMMERCE SETTLEMENT INTEGRATION». Работа в ветке
`claude/tutak-staging-flow-check-hl97qh`, Draft PR #70. Не merge, не deploy,
не трогать Anti-Fraud, Global Search, IDRAM, staging/production, секреты.

1. `PartnerSettlementService` из `main` — единственный движок расчётов и
   выплат. `PartnerSettlementEntry.ledgerPostingId` остаётся уникальным.
2. `PartnerSettlementStatement` — только отчёт, не второй источник правды;
   миграция без разрушения данных.
3. Одна периодичность: `Partner.settlementPeriodicity` (DAILY / WEEKLY /
   BIWEEKLY / MONTHLY; DAILY добавить) + `settlementAnchorDay` (для DAILY не
   используется). Значения молча не перезаписывать. Если у существующего
   партнёра `settlementPeriod` и `settlementPeriodicity` расходятся — STOP и
   показать расхождение. `settlementPeriod` убрать из бизнес-логики.
4. Классифицировать все точные kinds Partner Commerce на `PARTNER_PAYABLE`
   (без wildcard): kind | источник | CREDIT/DEBIT | смысл |
   SETTLEABLE / TRANSFER / NOT SETTLEABLE. В `SETTLEABLE_LEDGER_KINDS` —
   только подтверждённые. Сохранить fail-safe `unrecognisedKinds()`, не
   переходить на deny-list.
5. Финансовые правила: выплачивается электронная часть, удерживается
   комиссия, внешний кэш не выплачивается дважды, возвраты/реверсы, Q8/Q9,
   HOLD по спору, долг, стоимость отмены, корректировки; `PARTNER_PAYABLE`
   всегда объяснима.
6. Споры: HOLD никогда не попадает в выплату; проверить гонку
   «открытие спора × расчёт».
7. Интеграционные тесты на реальном PostgreSQL по 16 сценариям.
8. Безопасность миграции: пустая БД, БД текущего `main`, БД Partner Commerce
   v2, существующие расчёты/выписки и заклеймленные проводки; нет двойного
   клейма, replayBalance, сумма леджера 0, нет дрейфа. PAID-расчёты не
   переписывать.
9. Push в PR #70, дождаться GitHub CI, все checks GREEN.
10. Короткий итоговый отчёт из 11 пунктов, финальная строка
    «Partner Commerce financial settlement: CLOSED / NOT CLOSED — причина».

## 1. Предыдущий head

`c8392061` (docs: Partner Commerce v2 final closure report), ветка
`claude/tutak-staging-flow-check-hl97qh`.

## 2. Новый head

- Код: `4d31a062` — feat(settlement): Partner Commerce settles through the one
  PartnerSettlementService (запушен в PR #70).
- Отчёт: `6e71f4e8` (только `docs/`) — на нём GitHub CI 10/10 GREEN.

## 3. Два найденных механизма расчётов

1. **`PartnerSettlementService` (`main`, `modules/partner-settlements`)** —
   черновик (DRAFT) клеймит неоплаченные проводки `PARTNER_PAYABLE` из
   allow-list в `PartnerSettlementEntry` (уникальный `ledgerPostingId`), затем
   READY → APPROVED (maker/checker, активный банковский счёт) → PAID
   (проводка `partner.settlement.paid`). Настоящий движок выплат.
2. **`PartnerSettlementStatementService` (Partner Commerce v2,
   `modules/payouts`)** — по `Partner.settlementPeriod` sweep генерировал
   `PartnerSettlementStatement` + строки, по сути вторую «ведомость к
   выплате» со своей периодичностью, без связи с клеймом проводок.

Кроме того, в `main` отдельно живёт старый `PayoutEngineService` — это
собственный дизайн `main`, я его не трогал (см. «Что не сделано»).

## 4. Что теперь authoritative

`PartnerSettlementService` — единственное, что платит партнёру.
Statement стал read-only отчётом: для периода по каденции партнёра он
показывает каждую проводку `PARTNER_PAYABLE` / `PARTNER_DISPUTE_HOLD`, какой
расчёт её заклеймил (и его статус) или её класс (не заклеймлена / TRANSFER /
NOT SETTLEABLE), открывающий и закрывающий долг перед партнёром и
`unrecognisedKinds`. Ничего не хранит и не клеймит. Таблицы старых выписок
оставлены как история (не пишутся), sweep `partner-settlement.statements`
удалён.

## 5. settlementPeriod / settlementPeriodicity

- `settlementPeriodicity` + `settlementAnchorDay` — единственная каденция.
  В enum `SettlementPeriodicity` добавлено `DAILY`.
- Границы периода — `settlement-period.ts` (полночи Asia/Yerevan; BIWEEKLY
  считается от первого дня якоря начиная с 2024-01-01; MONTHLY якорь 1–28).
- Новые методы движка: `closedPeriodFor`, `createDraftForClosedPeriod`
  (черновик за последний закрытый период), `setPeriodicity` (аудит
  `PARTNER_SETTLEMENT_PERIOD_CHANGED` {from, to}).
- `settlementPeriod` удалён из схемы и из кода. Колонку удаляет миграция
  `20260926200100`, но **только после guard**: если у партнёра значение
  выставлено явно (есть аудит `PARTNER_SETTLEMENT_PERIOD_CHANGED`) и
  отличается от `settlementPeriodicity`, миграция падает с сообщением
  «Settlement cadence conflict, nothing changed», перечисляя партнёров и оба
  значения. Ничего молча не перезаписывается.
- API: `POST settlement/partners/:id/period` принимает
  `{periodicity, anchorDay?}` (PARTNER_MANAGE + platform admin) и вызывает
  `engine.setPeriodicity`. Админка и кабинет партнёра переведены на новую
  модель.
- `PartnerSettlementCheckService` возвращён к версии `main` (фиксированные
  14 дней) — это отдельная проверка `main`, не каденция.

## 6. Все kinds Partner Commerce на PARTNER_PAYABLE

Получено статически (поиск всех `kind:` в Partner Commerce) и подтверждено
эмпирически: все наборы Partner Commerce (108 тестов) прогнаны с
логированием kinds проводок `PARTNER_PAYABLE` / `HOLD`. Множество совпало со
статическим списком.

| kind | источник | на PARTNER_PAYABLE | смысл | класс |
|---|---|---|---|---|
| `partner_order.completion` | PartnerOrder | CREDIT | электронная часть (TuTak-деньги + скидка) полученного заказа, освобождённая из обоих эскроу | SETTLEABLE (добавлен) |
| `partner.contribution` | PartnerOrder / PurchaseIntent | DEBIT (CREDIT для партнёра-реферера) | комиссия (пул) на полную сумму, включая внешний кэш | SETTLEABLE (уже был) |
| `partner.contribution_refund` | PartnerOrderReturn / PurchaseIntentRefund | CREDIT (DEBIT для реферера) | возврат комиссии при возврате, минус удержанная доля Q8 | SETTLEABLE (уже был) |
| `partner.bonus_redemption_compensation` / `_refund` | PurchaseIntent(Refund) | CREDIT / DEBIT | компенсация скидки QR | SETTLEABLE (уже был) |
| `partner_order.return_money` | PartnerOrderReturn | DEBIT | TuTak-деньги, возвращённые клиенту (за вычетом недостачи Q9) | SETTLEABLE (добавлен) |
| `partner_order.return_discount` | PartnerOrderReturn | DEBIT | скидка, восстановленная клиенту | SETTLEABLE (добавлен) |
| `partner_order.shortfall_settled_at_desk` | PartnerOrderReturn | DEBIT | недостача Q9, которую партнёр удержал из кэша / взял на кассе | SETTLEABLE (добавлен) |
| `partner_order.cancellation_cost` | PartnerOrderCancellation | CREDIT | денежная часть одобренной фактической стоимости отмены | SETTLEABLE (добавлен) |
| `order_dispute.hold` | OrderDispute | DEBIT | заморозка спорной доли | SETTLEABLE (добавлен) |
| `order_dispute.release` | OrderDispute | CREDIT | разморозка | SETTLEABLE (добавлен) |
| `purchase_intent.money_release` | PurchaseIntent | CREDIT | TuTak-деньги подтверждённой QR-покупки | SETTLEABLE (добавлен) |
| `purchase_intent.money_refund` | PurchaseIntent(Refund) | DEBIT | возврат TuTak-денег при QR-возврате | SETTLEABLE (добавлен) |
| `purchase_intent.shortfall_settled_at_desk` | PurchaseIntentRefund | DEBIT | недостача Q9 из кэш-возврата QR | SETTLEABLE (добавлен) |
| `referral.withholding_recovered` | ReferralWithholding | CREDIT | возврат комиссии Q8 по мере погашения реферером | SETTLEABLE (добавлен) |
| `payout.requested`, `payout.settled`, `partner.collection.*`, `partner.settlement.paid` | выплаты / инкассация | — | сами перемещения денег между TuTak и партнёром | TRANSFER (без изменений) |

NOT SETTLEABLE среди kinds Partner Commerce нет. Внешний кэш/карта вообще не
проводятся по леджеру, поэтому не могут быть выплачены дважды; комиссия на
них уже внутри `partner.contribution`. Корректировки цены при закупке
двигают только эскроу и уходят в `partner_order.completion`. Kind, который
появится позже, не выплачивается, пока его не классифицируют, и виден в
`unrecognisedKinds()` (тест 15).

## 7. Добавлено в allow-list

11 точных kinds, у каждого комментарий в
`apps/api/src/modules/partner-settlements/settleable-kinds.ts`:
`partner_order.completion`, `partner_order.cancellation_cost`,
`partner_order.return_money`, `partner_order.return_discount`,
`partner_order.shortfall_settled_at_desk`, `order_dispute.hold`,
`order_dispute.release`, `purchase_intent.money_release`,
`purchase_intent.money_refund`,
`purchase_intent.shortfall_settled_at_desk`,
`referral.withholding_recovered`. Wildcard нет, deny-list нет.

## 8. Споры и гонка

- HOLD — это DEBIT на `PARTNER_PAYABLE`: пока спор открыт, замороженная доля
  не может быть выплачена (net черновика её вычитает).
- `createDraft` и `OrderDisputesService.open` берут одну и ту же блокировку
  строки партнёра (`lockPartnerForSettlement`) — они сериализуются.
- `approve` тоже берёт блокировку и отказывает с
  `OPEN_DISPUTE_NOT_IN_SETTLEMENT`, если расчёт заклеймил
  `partner_order.completion` заказа с открытым спором, а hold этого спора в
  расчёт не попал. Выход — cancel и новый черновик.
- `OrderDisputesService.isSettled` теперь смотрит на записи движка
  (completion заказа заклеймлена расчётом в committed-статусе).

## 9. Изменённые файлы

- `apps/api/src/modules/partner-settlements/settleable-kinds.ts` — allow-list.
- `apps/api/src/modules/partner-settlements/settlement-period.ts` — новый,
  границы периодов.
- `apps/api/src/modules/partner-settlements/partner-settlement.service.ts`
  и `partner-settlement.controller.ts` — блокировка, закрытый период,
  setPeriodicity, guard на approve, маршрут
  `POST admin/partner-settlements/drafts/:partnerId/closed-period`.
- `apps/api/src/modules/payouts/partner-settlement-statement.service.ts`
  и `partner-settlement.controller.ts`, `payouts.module.ts` — отчёт.
- `apps/api/src/modules/payouts/partner-settlement-check.service.ts` —
  возвращён к `main`.
- `apps/api/src/modules/sweeps/sweeps.jobs.ts`, `sweeps.module.ts` — удалён
  sweep выписок.
- `apps/api/src/modules/partner-orders/order-disputes.service.ts` —
  блокировка и `isSettled`.
- `apps/api/prisma/schema.prisma` — удалён `Partner.settlementPeriod`,
  добавлен `DAILY`, старые модели выписок помечены DEPRECATED.
- `packages/shared-types` — enum `SettlementPeriodicity`, DTO отчёта.
- `apps/partner` (страница расчётов), `apps/admin` (настройка каденции),
  `demo/` (перегенерирован штатным скриптом).
- `docs/PARTNER_COMMERCE.md` — §14 «Settlement: one engine», решение §13
  закрыто.
- Тесты: новый `apps/api/test/partner-commerce-settlement.int-spec.ts`;
  обновлены `partner-commerce-returns-disputes`, `partner-commerce-http`,
  `sweeps`, `alerting`.

## 10. Миграции

1. `20260926200000_settlement_periodicity_daily` —
   `ALTER TYPE "SettlementPeriodicity" ADD VALUE IF NOT EXISTS 'DAILY' BEFORE 'WEEKLY'`.
2. `20260926200100_partner_commerce_one_settlement_cadence` — guard
   (DO-блок, STOP при явном расхождении) и
   `ALTER TABLE "partners" DROP COLUMN "settlementPeriod"`.

Данные расчётов, записей, выписок и леджера миграции не трогают.

Проверка безопасности (на отдельных scratch-БД, локально):

| БД | Что было | Результат |
|---|---|---|
| Пустая | — | все миграции применяются, `migrate diff` без дрейфа |
| Текущий `main` (`origin/main` + baseline + demo seed + PAID и DRAFT расчёты) | 2 расчёта с записями | после миграций ветки снимки расчётов/записей/леджера идентичны (13 строк), колонки `settlementPeriod` нет, дрейфа нет |
| Partner Commerce v2 (код `c8392061`) | партнёр «Divergent A» (явно WEEKLY при MONTHLY), согласованный явный партнёр, партнёр по умолчанию, старая выписка с 2 строками, PAID-расчёт с 2 записями | миграция **остановилась** и назвала только «Divergent A»; колонка цела, DAILY уже добавлен шагом 1. После ручного решения оператора (UPDATE periodicity = WEEKLY + `migrate resolve --rolled-back` + deploy) — прошла. Diff снимков: изменилась только каденция A; дрейфа нет |

Новый код на этой v2-БД: unsettled 28500; из двух параллельных черновиков
проходит один; записи уникальны (двойного клейма нет); PAID-расчёт не
изменился; старая выписка читается; отчёт показывает claimed 28500;
`replayBalance` сходится; сумма леджера 0.

## 11. Тесты (чем доказано)

Новый `partner-commerce-settlement.int-spec.ts` — **16/16** на реальном PG:

| # | Сценарий | Проверка |
|---|---|---|
| 1 | Онлайн-заказ | net 28500, PAID |
| 2–3 | Смешанная оплата (TuTak-деньги + кэш) | 13500; кэш не выплачен |
| 4 | Возврат до расчёта | 17100 |
| 5 | Возврат после PAID | долг; следующий черновик 9500; PAID-расчёт не изменён |
| 6 | Q8 | первый расчёт 28350; второй = `withholding_recovered` 100 + 50 = 150 |
| 7 | Q9 на кассе | unsettled −1700 |
| 8 | Спор | hold 28500 → net 0; после release 28500 |
| 8b | Гонка «спор × расчёт» | либо черновика нет, либо approve отклонён `OPEN_DISPUTE_NOT_IN_SETTLEMENT`, затем cancel |
| 9 | Стоимость отмены | 3000 |
| 10 | Два воркера | один черновик, 4 уникальные записи |
| 11–14 | DAILY / WEEKLY / BIWEEKLY / MONTHLY | границы периода и окно черновика |
| 15 | Неизвестный kind | не выплачен, есть в `unrecognisedKinds` |
| 16 | QR-покупка с деньгами | net 4500; отчёт объясняет каждую строку |

В каждом тесте проверяется инвариант: долг перед партнёром = unsettled.net +
Σ net расчётов не в PAID/CANCELLED, при `unrecognised == []`.

Локально на `4d31a062`:
- затронутые наборы (returns-disputes, http, sweeps, alerting,
  partner-settlement, partner-settlement-check, final-fixes) — 7 наборов,
  108 тестов, все прошли;
- API unit — 704;
- partner — 95, admin — 105, checkout — 12, mobile — 535;
- `pnpm lint` — 0 ошибок, `pnpm typecheck` — 0, `pnpm build` — 4/4;
- полный локальный прогон всех интеграционных наборов — **117/117 наборов,
  1562/1562 тестов**, падений нет.

## 12. GitHub CI

Прогоны на `4d31a062` были отменены (`cancel-in-progress`) push'ем
коммита с отчётом `6e71f4e8` (только `docs/`, код тот же). Финальный CI —
на `6e71f4e8`: workflow `CI`, push (run 36250505758) и pull_request
(run 36250508725).

| Check | push | pull_request |
|---|---|---|
| Lint, test and build (lint, typecheck, unit, история миграций + drift, web/mobile, build) | ✅ | ✅ |
| Integration tests (1/3) | ✅ | ✅ |
| Integration tests (2/3) | ✅ | ✅ |
| Integration tests (3/3) | ✅ | ✅ |
| Build the container images (образы, e2e Playwright, backup/restore) | ✅ | ✅ |

**GREEN — 10/10 checks**, упавших и пропущенных нет. PR #70 — Draft,
`mergeable_state = clean`. Эта правка отчёта — ещё один docs-коммит поверх;
его CI указан в ответе.

## 13. Что НЕ сделано

- **Старый `PayoutEngineService` из `main`** продолжает существовать
  параллельно. Это собственный дизайн `main`, задача его не касалась, я его
  не трогал. Partner Commerce через него не платит.
- **Черновик DRAFT/READY, после которого открыт спор**, не пересчитывается
  автоматически: approve его отклоняет, нужен ручной cancel и новый
  черновик. Автоматической пересборки нет.
- **Автоматического sweep, который создаёт черновики по каденции**, нет:
  старый sweep выписок удалён, а `createDraftForClosedPeriod` вызывается
  вручную (маршрут админки). Создание расчётов по расписанию в задании не
  требовалось, и я не стал добавлять его без решения владельца.
- **Старые выписки** не мигрированы в записи движка: они остаются только
  историей. Их суммы никогда не выплачивались движком, поэтому двойной
  выплаты нет, но и связи «выписка → расчёт» нет.
- Собственные ошибки по ходу работы:
  1. Первый патч инструментирования `ledger.service.ts` (логирование kinds)
     упал на assert: якорь вставки встречался дважды. Переделал через regex,
     оригинал восстановлен из `.orig`, в ветке следов нет.
  2. После удаления `settlementPeriod` сломался `tsc` в check-сервисе и
     сервисе выписок, а sweep ещё вызывал `generateDue`. Удалить поле, не
     найдя всех потребителей, было ошибкой; исправил возвратом check-сервиса
     к `main`, переписыванием сервиса отчёта и удалением job.
  3. Тест Q8: второй заказ шёл от того же клиента-реферала, и его доля
     сразу погашала удержание (28500 вместо 28350). Заменил на клиента без
     реферера.
  4. Тест Q8: при сумме 20000 зелёная доля 200 гасила удержание одной
     проводкой 150. Взял суммы 10000 и 5000, чтобы проверить частичное
     погашение.
  5. Seed prev-state БД: бонус 1000 на покупку 20000 давал net 0
     («Nothing to pay»). Заменил на 2000.
  6. Ранее в этой сессии запускал два интеграционных jest одновременно на
     одной `tutak_test` — результаты портились. Дальше только
     последовательно.

## 14. UNVERIFIED

- Поведение на реальной production-БД: там могут быть партнёры с явным
  расхождением `settlementPeriod` ≠ `settlementPeriodicity`, и тогда
  миграция остановится. Сколько таких — неизвестно, production я не
  смотрел.
- Guard считает значение «явным» только при наличии аудита
  `PARTNER_SETTLEMENT_PERIOD_CHANGED`. Если значение поставили напрямую в БД
  без аудита, расхождение сочтётся дефолтом и колонка удалится (v2 нигде не
  была задеплоена, поэтому риск считаю низким, но не проверенным).
- Гонка спора проверена одним тестом с `Promise.all`, а не нагрузочно.
- Страницы кабинета партнёра и админки проверены unit-тестами и сборкой, не
  в браузере вручную.
- `BIWEEKLY` эпоха (2024-01-01) — моё решение для однозначности, с
  бизнесом не согласовано.

## 15. Внешние blockers

1. IDRAM — пополнение TuTak-денег требует договора и credentials; сейчас
   честно отклоняется. В `main` пополнение выключено флагом
   `CUSTOMER_PREPAID_TOPUP_ENABLED` (юридический вопрос о депозитах).
2. Деплой не выполнялся: хостинг `apps/checkout`,
   `NEXT_PUBLIC_API_BASE_URL`, `CORS_ORIGINS`, `CHECKOUT_WEB_BASE_URL`.
3. При деплое: если миграция `20260926200100` остановится, оператор должен
   решить каденцию каждого названного партнёра (порядок — в §10).

## 16. Вопросы владельцу

1. Нужен ли автоматический sweep «черновик за закрытый период» по
   каденции, или расчёты создаются вручную?
2. Эпоха BIWEEKLY (первый день якоря с 2024-01-01) — устраивает?
3. Черновик, после которого открыт спор: оставить ручной cancel/redraft или
   пересобирать автоматически?

---

Partner Commerce financial settlement: CLOSED
