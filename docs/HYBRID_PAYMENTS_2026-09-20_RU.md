# TuTak — каноническая гибридная платёжная система: отчёт

Дата: 20.09.2026. Ветка `claude/hybrid-payments-20260920`, PR
[#64](https://github.com/arman119090-cmyk/TuTak-Platform/pull/64) →
`claude/ux-truth-20260920`.

## Итоговый статус (§46)

**HYBRID PAYMENT CORE IMPLEMENTED — SAFE FOR NON-PRODUCTION INTEGRATION
TESTING.**

Не для реальных денег. Все флаги реальных денег выключены по умолчанию и в
production не трогались. Заблокировано внешними сторонами: реальное
пополнение (PSP + юрист), вендорный POS-протокол (партнёр-POS).

## 1. Задание

Довести до рабочего, протестированного кода полную платёжную механику:
предоплаченный баланс клиента + бонусы + наличные/карта в кассе партнёра +
POS-интеграция + QR-fallback + двусторонние расчёты с партнёром. Главный
принцип: **не создавать вторую финансовую систему** — переиспользовать
двойную запись, `CUSTOMER_PREPAID_BALANCE`, `CustomerBalanceService`,
`BankTopUpAdapter`, PSP/Idram-инфраструктуру, `PurchaseIntent`,
резервирование бонусов, `PARTNER_PAYABLE`, contribution rules,
`PartnerSettlementService`, `PartnerCollectionService`, refund-движок,
идемпотентность, reconciliation, QR-flow. Формула:
`gross = bonus + prepaid + external`. Комбинации A–D (§7) должны работать с
точными проводками. Все real-money-возможности OFF в production. Не merge в
main, не deploy, не включать `TUTAK_PSP_ENABLED` /
`CUSTOMER_PREPAID_TOPUP_ENABLED` / `CUSTOMER_PREPAID_PURCHASE_ENABLED`, не
проводить платежи, не трогать production-переменные и данные. Отдельная
ветка и отдельный PR; не потерять визуальные изменения #61.

## 2. База (§45.1–5)

- **Base SHA:** `333b9f4` (`claude/ux-truth-20260920`). Почему: это RC
  финансовой архитектуры #60 + dark-theme + мои `position`/PSP-контракт из
  UX-брифа. Исторический `main` (`369eda1`) финансового RC не содержит.
- **Ветка:** `claude/hybrid-payments-20260920`; 8 коммитов кода/доков +
  этот отчёт; 152 файла, +7355/−257.
- **PR:** #64 → `claude/ux-truth-20260920` (не в main; после merge #63 diff
  сложится в dark-theme). Не мержить до решения владельца.
- **Совместимость с #61 (`claude/jako-design`):** пробный merge-tree
  показывает 10 конфликтующих файлов **до** и те же 10 **после** моей
  работы (auth-экраны ux-truth ↔ jako-design). Гибридная работа новых
  конфликтов не добавляет. Логотип/иконка/Jako-сцены не менялись.

## 3. Что сделано (§45.6–19)

### Миграции (§45.6), все аддитивные, `migrate diff` = «No difference»

| Миграция | Что |
|---|---|
| `20260920100000_hybrid_prepaid_funding` | enum `CUSTOMER_PREPAID_RESERVED`; `purchase_intents.prepaidAmountApplied`, `prepaidHoldTransactionId` (unique, FK); CHECK `funding_sums_to_gross`, `prepaid_hold_matches_amount`; freeze-триггер расширен; `purchase_intent_refunds.prepaidRestored/externalRefundDue/externalRefundStatus/…` + enum `ExternalRefundStatus` + CHECK’и |
| `20260920110000_balance_topup_unresolved` | `BalanceTopUpStatus.UNRESOLVED`; `resolvedAt/unresolvedAt/escalatedAt/escalationCount` |
| `20260920120000_partner_checkouts` | таблица `partner_checkouts` (+ enum статуса, уникальность `(partnerId, externalReference)`, `(partnerId, idempotencyKey)`, `token`, `purchaseIntentId`) |
| `20260920120100_merchant_approval_by_api_key` | `purchase_intents.merchantApprovedByApiKeyId`; constraint «ровно один из user/key»; freeze-триггер |

Fresh (`migrate deploy` на пустую БД в тестах) и upgrade (`migrate deploy`
поверх существующей) прогнаны; diff миграций против schema — пусто.

### Флаги (§45.7), все OFF по умолчанию

`CUSTOMER_PREPAID_PURCHASE_ENABLED` (расход баланса на покупку),
`PARTNER_POS_PURCHASES_ENABLED` (POS-чекауты), существующий
`CUSTOMER_PREPAID_TOPUP_ENABLED` (приём денег) и `TUTAK_PSP_ENABLED` — не
связаны друг с другом. Конфиг: `CUSTOMER_PREPAID_TOPUP_STALE_AFTER_MS`,
`..._ESCALATE_EVERY_MS`, `PARTNER_CHECKOUT_TTL_SECONDS`. В jest-setup первые
два флага включены; «выключенное» поведение проверяется отдельными сьютами
(`customer-balance-disabled`, `money-disabled-routes`).

### Модели / сервисы (§45.8)

- `CustomerBalanceService`: `getBalanceDetail` (available/reserved/book),
  `holdForPurchase` (условный `UPDATE … WHERE balance <= -amount`, затем
  проводка DEBIT available / CREDIT reserved), `releaseHold`
  (`LedgerService.reverse`, exactly-once через `reversesId`),
  `settleHoldToPartner` (DEBIT reserved / CREDIT PARTNER_PAYABLE),
  `refundPrepaidFromPartner`, `getTopUpStatus`, `escalateStaleTopUps`.
- `PurchaseFundingService.quote/components` — единый набор правил для
  quote и create.
- `PurchaseIntentsService.create`: hold и строка покупки в одной
  транзакции (retry по коллизии кода — вся транзакция); `settlePurchase`
  добавляет `partner.prepaid_funding`; cancel/reject/expire — release в той
  же транзакции, что и смена статуса. `confirm` принимает `{ apiKeyId }`.
- `PurchaseIntentRefundService`: `splitRefundAcrossComponents` (тот же
  watermark, external — остаток), проводка `partner.prepaid_funding_refund`,
  `confirmExternalRefund`, `listPendingExternal`.
- `PartnerCheckoutService` + `PartnerApiKeyGuard`: create/status/cancel/
  confirm (M2M), resolve/claim (клиент), `expireStale`.
- `PartnerSettlementService.position.funding` (§29).
- `ReconciliationService.checkHybridInvariants` (A–E) +
  `alertStaleExternalRefunds`.
- `settleable-kinds`: `partner.prepaid_funding`, `partner.prepaid_funding_refund`.
- Sweeps: `balance.escalate-stale-topups` (10 мин), `partner-checkout.expire` (1 мин).

### DTO / API (§45.9)

`POST /purchase-intents/quote`; `prepaidAmountApplied` в create;
`PurchaseIntentDto.prepaidAmountApplied`; `PurchaseIntentRefundDto.
prepaidRestored/externalRefundDue/externalRefundStatus/externalRefundConfirmedAt`;
`GET /purchase-intents/refunds/pending-external`; `POST /purchase-intents/
refunds/:id/confirm-external`; `GET /balance/me` (detail + флаги; 404 при
обоих флагах off); `GET /balance/topup/:id`; `/partner-checkouts` (POST, GET
:id, POST :id/cancel, POST :id/confirm — `x-api-key`; GET resolve/:token,
POST claim/:token — JWT); `UnsettledPositionDto.funding`;
`CustomerBalanceDto`, `FundingQuoteDto`, `PartnerCheckoutResolveDto`,
`PendingExternalRefundDto`.

### Mobile (§45.10)

`balanceApi`, `partnerCheckoutApi`, `purchaseIntentApi.quote`;
`CreatePurchaseIntentScreen` — поле «с баланса TuTak», баланс как факт /
«недоступно» / «не удалось проверить» (никогда ноль), превью серверного
разбиения, «В кассе платить не нужно…», режим чекаута (сумма кассы
read-only, submit = claim); `PurchaseIntentStatusScreen` — три строки,
«ничего в кассе» / «оплачено через TuTak» только после подтверждения;
`WalletScreen` — денежный баланс отдельно от баллов; `TransactionDetail` —
`prepaidRestored`, статус наличной части возврата; `ScanQrScreen` —
`tutak://checkout/<token>`. HY/RU/EN. `demo/` перегенерирован.

### Partner panel (§45.11)

Очередь: столбец «Bonus / balance», «Collect 0 ֏ — paid through TuTak after
you confirm» при нулевом остатке. Settlements: «Where your sales were paid
from» (8 плиток). Returns: «Cash to hand back» + «Confirm cash returned».

### POS seam (§45.12), QR (§45.13), top-up (§45.14), refund (§45.15), settlement (§45.16), collection (§45.17), reconciliation (§45.18)

См. §3 выше и PR-описание. QR-flow (12 шагов) не менялся: бонусное
резервирование и код кассира те же; добавлен только компонент баланса.
Settlement-движок не трогался: новые kinds добавлены в allow-list, PAID
неизменяем; collection — существующий `PartnerCollectionService` (без
автоматических инвойсов).

### Точные проводки (§45.19), фикстура 5 %, gross 50 000

| Случай | Проводки на PARTNER_PAYABLE (kind:direction:amount) | Итог |
|---|---|---|
| A | `partner.contribution:DEBIT:2500` | партнёр должен TuTak 2 500 |
| B | `contribution:DEBIT:2500`, `bonus_redemption_compensation:CREDIT:5000` | TuTak должен 2 500 |
| C | `contribution:DEBIT:2500`, `bonus…:CREDIT:5000`, `prepaid_funding:CREDIT:45000` | TuTak должен 47 500 |
| D | `contribution:DEBIT:2500`, `bonus…:CREDIT:5000`, `prepaid_funding:CREDIT:20000` | TuTak должен 22 500 |

Плюс на стороне клиента: hold `DEBIT CUSTOMER_PREPAID_BALANCE / CREDIT
CUSTOMER_PREPAID_RESERVED` при создании, `DEBIT RESERVED / CREDIT
PARTNER_PAYABLE` при подтверждении; PLATFORM_BANK/PSP_RECEIVABLE — 0 проводок
во всех четырёх случаях (external — не деньги TuTak).

## 4. Что НЕ сделано

1. **Реальное пополнение** — BLOCKED BY PSP + LEGAL. Есть seam, UNRESOLVED,
   статус-запрос, sweep, документы; реального адаптера нет.
2. **Вендорный POS-протокол** — BLOCKED BY PARTNER-POS. Есть внутренний
   контракт и M2M-роуты; подписи/вебхуки конкретного вендора — нет.
3. **Скриншоты §44 — не все:** нет кадров «чекаут кассы» на клиенте
   (нужен скан, проверено unit-тестом), нет «stale» для баланса, нет
   fontScale 1.3 (web-экспорт не эмулирует), нет POS-статуса в панели (у
   POS нет UI — это API), нет админки. Кассир: «waiting/confirmed/stale» не
   снимал повторно — они не менялись с UX-брифа.
4. **Race matrix:** строки 25–26 (клиентский stale/logout) — только
   unit-тесты экранов; строки 9–10 — эмуляция обрыва через spy, не kill
   процесса.
5. **Reconciliation F** (bank/PSP records vs счета) — не новая проверка, а
   существующее сравнение со statement.
6. **Sweep для CLAIMED-чекаута без покупки** (краш между claim и create):
   повторный claim того же клиента подхватывает; авто-возврат в OPEN по
   времени не сделан.
7. **Собственные ошибки по ходу работы:**
   - Сначала не понял, что `@Module()` читает флаг при импорте — «disabled»
     сьют сломался; переделал read-роут на проверку per request.
   - Забыл, что `ledger_postings` append-only — тест D сначала пытался
     удалить проводку; переписан на «лишнюю» проводку.
   - Фикстура баланса писала только проводку без `BalanceTopUp` — моя же
     проверка A нашла «подлог»; фикстура исправлена.
   - Экранированные кавычки в heredoc сломали spec (`\\'`), инвариант
     «один лот на источник» не учитывал restore-лоты возвратов — исправлено.
   - Неиспользуемый импорт попал в коммит (поймал lint на следующем шаге).
   - Partner-скриншоты: забыл про CORS с credentials и in-memory токен —
     две итерации.

## 5. Чем доказано (§45.20–22)

| Проверка | Результат |
|---|---|
| API integration (PostgreSQL 16 + Redis), весь набор | 122 suites / **1575 tests passed** |
| Новые сьюты: `hybrid-funding` 15, `hybrid-refund` 8, `partner-checkout` 15 (HTTP, x-api-key), `hybrid-race-matrix` 15, `customer-balance` +4, `customer-balance-read` 2, `reconciliation` +6 | все зелёные |
| Concurrency (реальная БД): два hold 45 000 на 50 000 → один; двойной create/confirm; confirm↔cancel/expiry; reject↔expiry; два полных возврата; частичные возвраты; payout↔refund; collection↔purchase; два claim одного чекаута | по одному победителю, инварианты replay=materialized |
| API `typecheck` (build+spec), `lint` | чисто |
| Mobile jest | 75 suites / 668 tests; tsc, eslint чисто |
| Partner jest | 13 / 121; tsc, eslint чисто |
| Admin | tsc чисто, 16 / 112 |
| shared-types tsc | чисто |
| `prisma migrate diff` migrations→schema | No difference |
| Demo parity | `demo/` перегенерирован и закоммичен |
| Скриншоты `docs/screenshots/hybrid/` | 52 кадра: mobile 48 (EN 15, RU 11, HY 11, EN@360px 11), partner 4 |
| CI на PR #64 (head `f289d0e`) | зелёный: Lint/test/build, Integration 1/3–3/3, Build the container images — 5 check-run'ов × 2 прогона, все success (22:03 UTC); mergeable clean, тредов нет |

Что использовало mocks / реальную БД / устройство (§45.23): все
`*.int-spec.ts` — реальная PostgreSQL + Redis; экраны — jest/RNTL с
замоканным API; скриншоты — Playwright против web-экспорта Expo и Next dev с
полностью застабленным API (`page.route`); устройство не использовалось.

## 6. UNVERIFIED

- Поведение с реальным провайдером пополнения и реальным POS.
- Экраны на реальном устройстве, fontScale 1.3, стейл-состояние баланса на
  экране (unit-тест есть, кадра нет).
- Строки 25–26 матрицы гонок на устройстве.
- Полный прогон при `CUSTOMER_PREPAID_PURCHASE_ENABLED=false` кроме двух
  «disabled» сьютов.

## 7. Что нужно от владельца (§45.24–26)

- Ответы юриста по `docs/PREPAID_BALANCE_LEGAL_QUESTIONS_RU.md` (10
  вопросов) — до любого включения top-up.
- Ответы провайдера по `docs/PREPAID_PSP_PROVIDER_REQUIREMENTS_RU.md`.
- Партнёр-POS: спецификация протокола (или решение оставить только QR).
- Решение по PR #64: держать до merge #63 (его база), потом — в dark-theme.

**До sandbox:** staging с `CUSTOMER_PREPAID_PURCHASE_ENABLED=true`, тестовые
балансы проводкой, чек-лист `docs/PARTNER_HYBRID_PAYMENTS_PILOT_RU.md`.
**До реальных денег:** юрист, провайдер, sandbox-цикл top-up, повторный
аудит sweep/alert, и только затем обсуждение флагов — не в этом PR.

Ограничения соблюдены: production не трогался, Idram-платежи не
проводились, флаги не включались, секреты не публиковались, main не
мержился.
