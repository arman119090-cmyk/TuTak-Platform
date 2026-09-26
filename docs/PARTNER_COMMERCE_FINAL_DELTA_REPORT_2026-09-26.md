# TuTak Partner Commerce v2 — FINAL DELTA REPORT (2026-09-26)

Отчёт только по изменениям **после 7e44ad8** (ветка `claude/tutak-staging-flow-check-hl97qh`).
Merge не выполнялся, deploy не выполнялся, PR не создавался, настройки Render/Railway и секреты не трогались.

## 1. Итоговый SHA

- **Новый final SHA (код + тесты + миграция + документация): `3640d46` (`3640d4601e02c291c1a7287963c974e241211ea7`)**
- Отчёт закоммичен следующим коммитом поверх него (только этот файл `docs/`).
- Базовая точка сравнения: `7e44ad8`. Между ними также лежит `1a62d89` — предыдущий отчёт v2 (только `docs/PARTNER_COMMERCE_V2_REPORT_2026-09-26.md`).

## 2. Новые миграции

Одна: `apps/api/prisma/migrations/20260926180000_partner_commerce_final_fixes/migration.sql`

- Аддитивная, без DROP таблиц/колонок. Переименования «на месте», данные сохраняются:
  `HANDED_OVER → DELIVERED`, `PARTNER_ORDER_HANDED_OVER → PARTNER_ORDER_DELIVERED`,
  `PARTNER_ORDER_ESCROW → PARTNER_ORDER_MONEY_ESCROW`, `handedOverAt/handedOverByUserId → deliveredAt/deliveredByUserId`.
- Защитный блок: миграция отказывается выполняться, если в старом общем эскроу есть CAPTURED-нога DISCOUNT.
- Бэкфилл разбивки Q9 для старых возвратов/рефандов (gross = net, recovered = 0); существующие QR-покупки — `LEGACY_V1`.
- Новые CHECK: `refunded + retained ≤ amount` у ног; скидка никогда не удерживается; разбивка возврата/рефанда сходится; исполненный возврат/рефанд восстановил ровно свою недостачу; суммы удержаний; стоимость отмены = наличные + деньги ≤ заявленной. Частичные уникальные индексы: одна активная отмена на заказ; один открытый рефанд на QR-покупку.
- Проверено на трёх базах:
  1. пустая БД — применяется, дрейфа нет;
  2. заполненная БД на базовой ветке (baseline + demo seed + подтверждённая QR-покупка): снимки до/после **идентичны** (15 строк), существующие покупки `LEGACY_V1`, дрейфа нет;
  3. **БД в состоянии 7e44ad8 с реальными строками v2, записанными кодом 7e44ad8** (заказ HANDED_OVER, завершённые заказы, возврат COMPLETED, возврат PENDING_EXTERNAL_REFUND, старый MANUAL_REVIEW-возврат, заказ SUBMITTED с деньгами в эскроу, QR с рефандом, ожидающая QR с деньгами): переименования и бэкфилл как ожидалось, все CHECK проходят, дрейфа нет; на клоне с CAPTURED DISCOUNT-ногой миграция корректно отказалась (схема не тронута). Затем **новый код довёл каждую «висящую» старую строку до конца**: DELIVERED → получено → COMPLETED; старый MANUAL_REVIEW → REOPEN → расчёт на кассе → COMPLETED; PENDING_EXTERNAL_REFUND → подтверждено; SUBMITTED → отмена клиентом → деньги вернулись; ожидающая QR → подтверждена; повторный legacy-рефанд → COMPLETED (LEGACY_V1). Все счета реплеятся, книга в сумме 0, оба эскроу и клиринг недостачи = 0.

## 3. Статус пунктов 1–12

| № | Пункт | Статус |
|---|---|---|
| 1 | Q8 = A: недостача реферала | **Закрыт** |
| 2 | Q9: версия политики + netting недостачи клиента | **Закрыт** |
| 3 | Q10: COMPLETED только при получении + всех внешних подтверждениях | **Закрыт** |
| 4 | Q11: только AMD | **Закрыт** (решение, изменений не требовалось; покрыто HTTP-тестом) |
| 5 | Q12: отдельный TuTak Web Checkout | **Закрыт в коде**; хостинг/деплой — внешний шаг (см. §6) |
| 6 | Q13 = НЕТ: скидка не закрывает предоплату | **Закрыт** |
| 7 | Разделение доставки, таймеры только от «доставлено» | **Закрыт** |
| 8 | Отмена с фактическими затратами через проверку TuTak | **Закрыт** |
| 9 | Доказуемая провенанс эскроу / раздельные эскроу | **Закрыт** |
| 10 | PARTNER_MANAGER / смены по разрешениям | **Закрыт** |
| 11 | IDRAM | **Внешний blocker** (фейкового успеха нет) |
| 12 | Повторные прогоны, конкурентность, инварианты, миграция | **Закрыт** (цифры в §4) |

### Что именно сделано

**1. Q8 (недостача реферала).** Доступная часть отзывается сразу. Уже потраченная часть USER-реферера становится `ReferralWithholding` (OPEN) и погашается FIFO из его следующих положительных начислений (покупка, реферал, промо, отложенные бонусы) внутри `BonusEngine.accrue`, атомарно (claim на `remainingAmount`, конкурентные начисления гасят удержание ровно один раз). Отрицательного баланса нет; `CUSTOMER_PREPAID_BALANCE` не трогается; ни на клиента, ни на партнёра, ни на TuTak не перекладывается. PARTNER-реферер — обычный реверс из его payable. MANUAL_REVIEW для этого случая удалён. По ответу «Партнёр ждёт»: возврат комиссии продающему партнёру за удержанную часть зачисляется в его PARTNER_PAYABLE только по мере погашения (`referral.withholding_recovered`); TuTak ничего не авансирует; непогашенное — открытое удержание, видно партнёру (страница расчётов) и админу (Commerce reviews), автосписания нет.

**2. Q9.** `FinancialPolicyVersion {LEGACY_V1, COMMERCE_V2}`: онлайн-заказы — всегда COMMERCE_V2; QR-покупки — COMMERCE_V2, если созданы после `FINANCIAL_POLICY_V2_EFFECTIVE_AT` (не задано = уже действует); старые покупки — по старым правилам. Недостача клиента вычитается из того, что он получает назад: сначала TuTak-деньги (автоматически, одна проводка показывает gross/recovered/net, пример 20000 − 1700 = 18300), затем наличные/внешний возврат через партнёра, остаток — доплата на кассе. `grossRefund`, `recoveredShortfall`, `netRefund` и части хранятся отдельно. Любое участие кассы → `AWAITING_SHORTFALL_SETTLEMENT`, ничего не движется, пока сотрудник на активной смене не подтвердит точные суммы (изменились → 409 `SETTLEMENT_AMOUNT_CHANGED` с новыми цифрами). Отказ клиента/партнёра → `MANUAL_REVIEW`/спор: возврат не финализируется, скрытого долга нет; админ может только WITHDRAW (возврат не исполнен) или REOPEN (назад на кассу). **Новое в этой дельте:** REOPEN сразу пересчитывает суммы пробным прогоном в транзакции, которая всегда откатывается, — касса видит актуальные цифры (и для строк 7e44ad8 без разбивки, и если клиент потратил ещё бонусов за время проверки); у старых строк снимается устаревший флаг заказа `return_shortfall`.

**3. Q10.** Получение при неподтверждённой внешней ноге сохраняет `customerReceivedAt`, эскроу не освобождается, распределения нет, сразу PAYMENT_ISSUE (аудит, эскалация, уведомление). 24 ч — повторная эскалация `PAYMENT_ISSUE_24H`. Подтверждение ноги → `tryComplete` → COMPLETED, флаг снимается.

**5. Q12.** Новое приложение `apps/checkout` (Next.js): Partner Website → `/o/<orderId>` → вход в TuTak (OTP, гостевого checkout нет) → просмотр → части оплаты → «Подтвердить заказ» → тот же API, та же машина состояний, книга, заказ и ключ идемпотентности, что у приложения. Кнопка «Открыть в TuTak» (`tutak://checkout/<id>`); приложение не обязательно. Ответ создания заказа содержит `checkoutUrl` и `appCheckoutUrl`. Правило разбиения оплаты вынесено в общий `computeCheckoutSplit` (`@tutak/shared-types`), им пользуются и мобильное приложение, и веб. Шаг CI добавлен.

**6. Q13.** Предоплату закрывают только реальные деньги (TuTak-деньги в денежном эскроу); скидка не засчитывается (`PREPAYMENT_REQUIRED` с пояснением); снимок `prepaymentCoveredAmount` при отправке.

**7. Доставка.** Новые состояния `OUT_FOR_DELIVERY`, `READY_FOR_PICKUP`, `DELIVERED` (+ `FulfillmentMethod`, заметка курьера). Передача курьеру и «готово к выдаче» не запускают таймеры; напоминание 24 ч и ручная проверка 48 ч — только от `deliveredAt`.

**8. Отмена.** Клиент может отменить до подтверждения получения (после — это возврат). До подтверждения наличия, а также если у заказа нет раскрытых условий отмены, — мгновенно и полностью. Иначе: `CANCELLATION_REQUESTED` → партнёр на смене: «затрат нет» (полный возврат) или заявка на фактические затраты (сумма, причина, доказательства) → `CANCELLATION_REVIEW` → админ approve/reduce/reject (одно решение, AuditLog). Нет ответа в окне (`PARTNER_ORDER_CANCELLATION_CLAIM_HOURS`, 24 ч) → полный возврат. По ответу «Только реальные деньги»: сначала подтверждённые наличные (остаются у партнёра), затем денежный эскроу → PARTNER_PAYABLE; скидка всегда возвращается полностью; больше реальных денег одобрить нельзя (`COST_EXCEEDS_REAL_MONEY`); сверх этого клиенту ничего не выставляется; без комиссии и без 20/30/30/20; фиксированных/процентных штрафов нет. Клиент может отозвать запрос до решения; отгрузка блокируется, пока запрос открыт.

**9. Эскроу.** `PARTNER_ORDER_MONEY_ESCROW` и `PARTNER_ORDER_DISCOUNT_ESCROW`: скидка попадает только в дисконтный эскроу и возвращается только в BONUS_LIABILITY, деньги — только в денежный и только в CUSTOMER_PREPAID_BALANCE/PARTNER_PAYABLE. Инвариант `assertEscrowProvenance` (включая перекрёстные проверки типов и нулевой клиринг) выполняется после **каждого** теста набора final-fixes; per-escrow net-zero в `assertOrderInvariants`.

**10. Смены.** API принимает любое из разрешений `PURCHASE_INTENT_CONFIRM` / `PARTNER_ORDER_MANAGE` (`RequireAnyPermission`); кабинет партнёра показывает панель смены по разрешениям из логина (PARTNER_MANAGER и будущие роли получают её автоматически).

**11. IDRAM.** Реальный адаптер не подключён: в production действует `NoopBankTopUpAdapter`, который честно отказывает (`DECLINED: top_up_not_configured`), фейкового успеха нет. Нужны договор, креды и спецификация webhook от IDRAM.

## 4. Тесты

### Новые тест-кейсы после 7e44ad8: 54

| Где | Новых |
|---|---|
| API integration `partner-commerce-final-fixes.int-spec.ts` (Q8 ×3, Q9 ×9 вкл. QR v2/legacy и REOPEN legacy-строки, Q10, Q13, таймеры доставки, отмена ×5, провенанс ×2) | 22 |
| API integration `purchase-intent-refund.int-spec.ts` — V2-аналоги (источник проводок = рефанд; полностью/частично потраченный бонус → netting на кассе) | 3 |
| API integration `partner-commerce-orders.int-spec.ts` (отмена после доставки без условий) | 1 |
| API e2e HTTP (Q13, проверка затрат отмены, расчёт недостачи, доступ к сменам — каждый только своему актору) | 1 |
| API unit (`permissions.guard.spec.ts` ×3, `configuration.spec.ts` ×1) | 4 |
| `apps/checkout` (jest 12 + node 3) | 15 |
| `apps/partner` authStore (PARTNER_MANAGER, права смены) | 3 |
| `apps/mobile` `checkoutSplit.test.ts` | 5 |

Переписаны под новые решения (не подогнаны — проверяют новое правило): возврат с недостачей (было MANUAL_REVIEW → теперь netting Q9), payment issue (Q10 — сразу, не через 24 ч), сценарий E (Q13), отмена после выдачи, заглушка sweeps. В `purchase-intent-refund.int-spec.ts` 4 теста старого правила явно помечены `LEGACY_V1` (покупки до даты вступления), а legacy-граница `programVersion = null` также стампуется LEGACY_V1 (такая строка по определению старше V2); сценарии этих 4 тестов (форма проводок, полностью и частично потраченный бонус) покрыты 3 новыми V2-аналогами.

### Повторные прогоны (всё после последней правки)

| Набор | Результат |
|---|---|
| API integration (весь набор, реальный Postgres/Redis) | 84 набора / 1155 тестов — **все прошли** |
| API unit | 36 наборов / 518 тестов — все прошли |
| API typecheck (build + spec) и ESLint (`src`, `test`) | чисто |
| Mobile jest | 40 наборов / 335 тестов — все прошли; `tsc` чисто |
| Partner | jest 9/65 + node 4 — все прошли; `next build` OK |
| Admin | jest 9/60 + node 4 — все прошли; `next build` OK |
| Checkout | jest 3/12 + node 3 — все прошли; `next build` OK |
| shared-types / design `tsc`, ESLint изменённых web/mobile файлов | чисто |
| Миграция: пустая / заполненная / состояние 7e44ad8 с v2-данными | см. §2 — всё ОК |

Конкурентность и инварианты в прогоне: два админа решают одну отмену → одно решение; два параллельных начисления гасят одно удержание ровно один раз; повторы с тем же ключом идемпотентности → одна операция; после каждого теста final-fixes — реплей всех счетов, сумма книги 0, провенанс эскроу.

### Failed / skipped

- **Failed: 0. Skipped: 0.**
- В ходе работы первый полный прогон показал 4 падения в `purchase-intent-refund.int-spec.ts` (тесты предполагали legacy-путь, а новые QR-покупки штампуются COMMERCE_V2) — исправлено как описано выше, и одну реальную находку на данных 7e44ad8 (устаревший флаг `return_shortfall` оставлял заказ в очереди ручной проверки после REOPEN) — исправлено в коде + регрессионный тест.

## 5. Изменённые файлы (121 файл, +9511 / −761 строк; `git diff --stat 7e44ad8..3640d46`)

В т.ч. `docs/PARTNER_COMMERCE_V2_REPORT_2026-09-26.md` — это предыдущий отчёт из `1a62d89`, не код.

**API — миграция и схема** (2)

- (новый) `apps/api/prisma/migrations/20260926180000_partner_commerce_final_fixes/migration.sql`
- `apps/api/prisma/schema.prisma`

**API — код** (28)

- `apps/api/src/common/decorators/permissions.decorator.ts`
- `apps/api/src/common/guards/permissions.guard.ts`
- `apps/api/src/config/configuration.ts`
- `apps/api/src/modules/commerce-ledger/commerce-ledger.service.ts`
- (новый) `apps/api/src/modules/commission-distribution/commerce-reversal.service.ts`
- `apps/api/src/modules/commission-distribution/commission-distribution.module.ts`
- `apps/api/src/modules/customer-balance/customer-balance.service.ts`
- `apps/api/src/modules/employee-shifts/employee-shifts.controller.ts`
- `apps/api/src/modules/partner-orders/dto/create-partner-order.dto.ts`
- (новый) `apps/api/src/modules/partner-orders/dto/final-fixes.dto.ts`
- `apps/api/src/modules/partner-orders/order-disputes.service.ts`
- `apps/api/src/modules/partner-orders/order-escalation.service.ts`
- (новый) `apps/api/src/modules/partner-orders/partner-order-cancellation.service.ts`
- `apps/api/src/modules/partner-orders/partner-order-notifier.service.ts`
- `apps/api/src/modules/partner-orders/partner-order-payments.service.ts`
- `apps/api/src/modules/partner-orders/partner-order-returns.service.ts`
- `apps/api/src/modules/partner-orders/partner-order-sla-sweep.service.ts`
- `apps/api/src/modules/partner-orders/partner-orders-admin.controller.ts`
- `apps/api/src/modules/partner-orders/partner-orders.controller.ts`
- `apps/api/src/modules/partner-orders/partner-orders.module.ts`
- `apps/api/src/modules/partner-orders/partner-orders.service.ts`
- `apps/api/src/modules/payouts/partner-settlement-statement.service.ts`
- `apps/api/src/modules/purchase-intents/purchase-intent-refund.service.ts`
- `apps/api/src/modules/purchase-intents/purchase-intents.controller.ts`
- `apps/api/src/modules/purchase-intents/purchase-intents.service.ts`
- `apps/api/src/modules/sweeps/sweeps.jobs.ts`
- `apps/api/src/modules/wallet/bonus-engine.service.ts`
- `apps/api/src/modules/wallet/deferred-bonus-lot.service.ts`

**API — тесты** (10)

- (новый) `apps/api/src/common/guards/permissions.guard.spec.ts`
- `apps/api/src/config/configuration.spec.ts`
- (новый) `apps/api/test/partner-commerce-final-fixes.int-spec.ts`
- `apps/api/test/partner-commerce-http.int-spec.ts`
- `apps/api/test/partner-commerce-orders.int-spec.ts`
- `apps/api/test/partner-commerce-returns-disputes.int-spec.ts`
- `apps/api/test/partner-commerce-shifts-qr-sla.int-spec.ts`
- `apps/api/test/purchase-intent-refund.int-spec.ts`
- `apps/api/test/support/commerce.ts`
- `apps/api/test/sweeps.int-spec.ts`

**Web Checkout (apps/checkout, новое приложение)** (22)

- (новый) `apps/checkout/api-base-url.mjs`
- (новый) `apps/checkout/api-base-url.test.mjs`
- (новый) `apps/checkout/jest.config.js`
- (новый) `apps/checkout/next-env.d.ts`
- (новый) `apps/checkout/next.config.ts`
- (новый) `apps/checkout/package.json`
- (новый) `apps/checkout/postcss.config.mjs`
- (новый) `apps/checkout/src/app/globals.css`
- (новый) `apps/checkout/src/app/layout.tsx`
- (новый) `apps/checkout/src/app/o/[orderId]/page.tsx`
- (новый) `apps/checkout/src/app/page.tsx`
- (новый) `apps/checkout/src/components/CheckoutGate.test.tsx`
- (новый) `apps/checkout/src/components/CheckoutGate.tsx`
- (новый) `apps/checkout/src/components/CheckoutView.test.tsx`
- (новый) `apps/checkout/src/components/CheckoutView.tsx`
- (новый) `apps/checkout/src/components/LoginPanel.tsx`
- (новый) `apps/checkout/src/lib/api/checkoutApi.ts`
- (новый) `apps/checkout/src/lib/httpClient.ts`
- (новый) `apps/checkout/src/lib/i18n.test.ts`
- (новый) `apps/checkout/src/lib/i18n.ts`
- (новый) `apps/checkout/src/lib/stores/authStore.ts`
- (новый) `apps/checkout/tsconfig.json`

**Кабинет партнёра (apps/partner)** (6)

- `apps/partner/src/app/(dashboard)/orders/page.tsx`
- `apps/partner/src/app/(dashboard)/settlement/page.tsx`
- `apps/partner/src/components/ShiftBar.tsx`
- `apps/partner/src/lib/api/partnerOrderApi.ts`
- `apps/partner/src/lib/stores/authStore.test.ts`
- `apps/partner/src/lib/stores/authStore.ts`

**Админка (apps/admin)** (5)

- (новый) `apps/admin/src/app/(dashboard)/commerce-reviews/page.tsx`
- `apps/admin/src/app/(dashboard)/partner-order-disputes/page.tsx`
- `apps/admin/src/app/(dashboard)/partner-orders/page.tsx`
- `apps/admin/src/components/Sidebar.tsx`
- `apps/admin/src/lib/api/partnerOrderAdminApi.ts`

**Мобильное приложение (apps/mobile)** (5)

- `apps/mobile/src/data/api/mockAdapter.ts`
- `apps/mobile/src/data/api/partnerOrderApi.ts`
- `apps/mobile/src/presentation/screens/partner-order/CheckoutScreen.tsx`
- `apps/mobile/src/presentation/screens/partner-order/MyOrdersScreen.tsx`
- (новый) `apps/mobile/src/presentation/screens/partner-order/checkoutSplit.test.ts`

**Общие пакеты (packages/*)** (12)

- `packages/i18n/src/locales/en.json`
- `packages/i18n/src/locales/hy.json`
- `packages/i18n/src/locales/ru.json`
- (новый) `packages/shared-types/src/contracts/checkout-split.ts`
- (новый) `packages/shared-types/src/contracts/index.ts`
- `packages/shared-types/src/dto/auth.ts`
- `packages/shared-types/src/dto/partner-order.ts`
- `packages/shared-types/src/dto/purchase-intent.ts`
- `packages/shared-types/src/enums/bonus.ts`
- `packages/shared-types/src/enums/partner-order.ts`
- `packages/shared-types/src/enums/roles.ts`
- `packages/shared-types/src/index.ts`

**Demo (пересобран scripts/build-demo-app.sh)** (26)

- `demo/App.tsx`, `demo/src/app/navigation/RootNavigator.tsx`, `demo/src/app/navigation/types.ts`, (новый) `demo/src/data/api/customerBalanceApi.ts`, `demo/src/data/api/mockAdapter.ts`, `demo/src/data/api/mockData.ts`, (новый) `demo/src/data/api/partnerOrderApi.ts`, (новый) `demo/src/presentation/screens/partner-order/CheckoutScreen.tsx`, (новый) `demo/src/presentation/screens/partner-order/MyOrdersScreen.tsx`, `demo/src/presentation/screens/purchase-intent/CreatePurchaseIntentScreen.tsx`, `demo/src/presentation/screens/purchase-intent/PurchaseIntentStatusScreen.tsx`, `demo/src/presentation/screens/settings/SettingsScreen.tsx`, `demo/vendor/i18n/locales/en.json`, `demo/vendor/i18n/locales/hy.json`, `demo/vendor/i18n/locales/ru.json`, (новый) `demo/vendor/shared-types/contracts/checkout-split.ts`, (новый) `demo/vendor/shared-types/contracts/index.ts`, `demo/vendor/shared-types/dto/auth.ts`, `demo/vendor/shared-types/dto/index.ts`, (новый) `demo/vendor/shared-types/dto/partner-order.ts`, `demo/vendor/shared-types/dto/purchase-intent.ts`, `demo/vendor/shared-types/enums/bonus.ts`, `demo/vendor/shared-types/enums/index.ts`, (новый) `demo/vendor/shared-types/enums/partner-order.ts`, `demo/vendor/shared-types/enums/roles.ts`, `demo/vendor/shared-types/index.ts`

**Инфраструктура репозитория** (3)

- `.github/workflows/ci.yml`
- `eslint.config.mjs`
- `pnpm-lock.yaml`

**Документация** (2)

- `docs/PARTNER_COMMERCE.md`
- (новый) `docs/PARTNER_COMMERCE_V2_REPORT_2026-09-26.md`

## 6. Внешние blockers (вне кода)

1. **IDRAM** — реальный адаптер пополнения, webhook, сверка: нужны договор, креды, спецификация. До этого пополнение честно отклоняется.
2. **Деплой `apps/checkout`** (не выполнялся по условию): хостинг, `NEXT_PUBLIC_API_BASE_URL`, origin в `CORS_ORIGINS` API, `CHECKOUT_WEB_BASE_URL` на API.
3. **Новые env API** (значения по умолчанию безопасны): `FINANCIAL_POLICY_V2_EFFECTIVE_AT` (не задано = V2 сразу для новых QR), `PARTNER_ORDER_CANCELLATION_CLAIM_HOURS` (24), `CHECKOUT_WEB_BASE_URL` (не задано = без `checkoutUrl`). Если нужна дата вступления в будущем — задать до деплоя.
4. Merge в main и деплой на staging/production — только после вашего решения.

## 7. Замечания

- Истёкший лот бонуса ни на кого не перекладывается: его обязательство списывается обратно (`expiredWrittenBackAmount`); истёкший/утраченный отложенный лот — реверс из `PLATFORM_REVENUE`.
- Удержание Q8 не гасится ручными корректировками и восстановленной скидкой (это не «новые начисления»).
- `demo/` пересобран штатным `scripts/build-demo-app.sh` (был устаревшим с v2); `pnpm-lock.yaml` — новый importer `apps/checkout`, версии пакетов не менялись.
- Новых финансовых неоднозначностей не возникло; Q8–Q13 повторно не задавались.
