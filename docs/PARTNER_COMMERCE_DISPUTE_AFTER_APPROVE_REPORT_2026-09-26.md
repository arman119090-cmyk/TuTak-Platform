# Partner Commerce — спор после APPROVE: отчёт (2026-09-26)

## 1. Задание (пересказ)

«4. DISPUTE ПОСЛЕ APPROVE». Исходный факт: `cancel()` разрешён только из
DRAFT/READY. `OrderDisputesService.isSettled()` считает APPROVED и дальше
committed, поэтому спор, открытый после APPROVED, получает
`openedAfterSettlement = true`, и `order_dispute.hold` для него не создаётся.

- **4а.** Переход APPROVED / PAYMENT_PENDING / FAILED → PAID должен:
  1. взять `lockPartnerForSettlement`;
  2. прямо перед проводкой перепроверить споры по заказам, чей
     `partner_order.completion` входит в settlement;
  3. при OPEN споре, финансовое влияние которого не входит в settlement,
     вернуть `OPEN_DISPUTE_NOT_IN_SETTLEMENT`: не писать
     `partner.settlement.paid` и не менять статус.
- **4б.** RESOLVED_PARTNER без других блокеров: APPROVED settlement идёт к
  PAID обычным путём, без redraft.
- **4в.** RESOLVED_CUSTOMER / RESOLVED_SPLIT с refund, когда перевод
  доказуемо не начинался (не было PAYMENT_PENDING, attempt, bank reference,
  `partner.settlement.paid`):
  - старую полную сумму не выплачивать;
  - путь: safe `revokeApproval` → освободить claims → новый draft, в котором
    completion, refund и прочие актуальные проводки;
  - если безопасный revoke на существующих данных невозможен — STOP только
    для этого пути и описать operator flow.
- **4г.** Если перевод мог начаться (PAYMENT_PENDING, есть attempt, FAILED
  после attempt, REQUIRES_RECONCILIATION, любая неоднозначность): claims не
  освобождать, redraft не делать. Работает существующий
  transfer/reconciliation lifecycle; если settlement стал PAID, refund — долг
  следующего settlement.
- **4д.** Тесты 8c–8h.

## 2. База

- Ветка `claude/tutak-staging-flow-check-hl97qh`, Draft PR #70.
- Работа начата от `418cf630`: GitHub CI 10/10 GREEN, проверено перед push.
- Коммит с кодом: `dbf3ebf9`. Коммит с этим отчётом идёт поверх.
- Не merge, не deploy.

## 3. Что сделано

Миграций нет. Всё сделано на существующих данных и триггерах.

### 3.1 Блокировки (`apps/api/src/modules/partner-settlements/partner-settlement.service.ts`)

`disputeBlockers(tx, settlementId)` — один SQL-запрос по заказам, чей
`partner_order.completion` заклеймлен этим settlement. Он возвращает два
списка.

**`open`** — OPEN спор типа ORDER, у которого:
- hold есть, но этот settlement его не клеймит (hold появился после
  черновика), **или**
- hold нет, потому что спор открыт после APPROVE
  (`openedAfterSettlement`, ничего не заморожено).

**`refunds`** — спор RESOLVED_CUSTOMER / RESOLVED_SPLIT с
`customerRefundAmount > 0`, чей возврат не входит в settlement:
- return ещё не создан — окно между `resolve()` и `createReturn()`;
- **или** return ждёт кассы (AWAITING_SHORTFALL_SETTLEMENT / MANUAL_REVIEW);
- **или** у return есть проводки на PARTNER_PAYABLE этого партнёра, которые
  этот settlement не клеймит.

Где применяются блокировки:

| Место | Что проверяется | Ошибка |
|---|---|---|
| `markPaid` (APPROVED / PAYMENT_PENDING / FAILED → PAID) | перед проводкой, под `lockPartnerForSettlement`, со свежим чтением статуса: `open` при любом статусе; `refunds` только если статус APPROVED и `transferEvidence` пуст | `OPEN_DISPUTE_NOT_IN_SETTLEMENT` / `DISPUTE_REFUND_NOT_IN_SETTLEMENT`; `partner.settlement.paid` не пишется, статус не меняется |
| `markPaymentPending` | та же проверка на шаг раньше — не начинать перевод устаревшей суммы | те же |
| `approve` (READY) | `open` + `refunds` (перевода ещё нет) | те же; лекарство — cancel и черновик до текущего момента |
| путь reconciliation (REQUIRES_RECONCILIATION → PAID) | блокировок нет: деньги ушли по выписке, refund — долг следующего периода (4г) | — |

`transferEvidence` — это доказательство, что перевод не начинался. Список
пуст, только если нет ни одного признака:
- `bankTransferReference`;
- `paidAt` / `ledgerTransactionId`;
- строки `partner_settlement_transfer_attempts`;
- проводки `partner.settlement.paid` с `sourceId` этого settlement;
- события аудита `settlement.payment_pending`.

### 3.2 `revokeApproval(id, {actorId, reason})`

- Всё в одной транзакции, под блокировкой партнёра, со свежим чтением.
- Разрешён **только** из APPROVED и только при пустом `transferEvidence`.
- Отказы:
  - DRAFT / READY → «cancel instead»;
  - PAYMENT_PENDING / FAILED / REQUIRES_RECONCILIATION / PAID / любой
    признак перевода → `TRANSFER_MAY_HAVE_STARTED`, claims остаются.
- Действия при успехе:
  - статус → CANCELLED, `cancelledReason = "approval revoked: …"`; данные об
    одобрении остаются в строке как история;
  - удаляются entries — триггер `partner_settlement_entries_frozen` это
    разрешает, потому что статус уже не approved-or-later;
  - аудит `settlement.approval_revoked`.
- Сразу создаётся новый черновик за период `periodStart` → now: now, а не
  конец старого периода, чтобы refund, записанный после старого `periodEnd`,
  попал в новый черновик.
- Если net ≤ 0 или выплаты заблокированы, redraft не создаётся
  (`redraftSkipped` объясняет почему), но revoke фиксируется — баланс
  переносится, как обычно.
- `createDraft` разделён на обёртку и `draftInTx`, логика не менялась.
- Роут: `POST admin/partner-settlements/:id/revoke-approval`
  (SETTLEMENT_MANAGE, тело `{reason}`).

### 3.3 Остальное

- `order-disputes.service.ts` — обновлён только комментарий к `isSettled`.
- Админка (`apps/admin/.../settlements/page.tsx`, `financeApi.ts`): у
  APPROVED кнопка «Cancel» заменена на «Revoke approval and redraft» с
  обязательной причиной. Прежняя кнопка «Cancel» на APPROVED всегда
  отклонялась сервером — это дефект интерфейса из `main`. Тест админки
  добавлен.
- `docs/PARTNER_COMMERCE.md` §14 — таблица правил «спор × статус
  settlement» и определение «доказуемо не начинался».
- Тесты — `apps/api/test/partner-commerce-settlement.int-spec.ts`, 8c–8h
  (раздел 5).

### 3.4 Итог по 4а–4г

| Пункт | Статус |
|---|---|
| 4а | Сделано (плюс то же на `markPaymentPending`) |
| 4б | Сделано |
| 4в | Сделано; STOP не понадобился — безопасный revoke реализуем на существующих данных |
| 4г | Сделано |

## 4. Что НЕ сделано

- **OPEN спор после APPROVE по-прежнему ничего не замораживает.** Hold не
  создаётся, settlement просто ждёт решения — markPaid и payment-pending
  отклоняются. Если сделать `revokeApproval`, пока спор ещё OPEN, новый
  черновик возьмёт completion без hold, и `approve` его отклонит
  (`OPEN_DISPUTE_NOT_IN_SETTLEMENT`) до решения спора. Автоматически
  hold при revoke не создаётся — это отдельное решение.
- **FAILED + спор решён для клиента:** по 4г `markPaid` из FAILED проходит
  на старую сумму, refund становится долгом. FAILED по определению `main`
  значит «однозначно не ушли», так что формально revoke был бы безопасен.
  Но задание относит FAILED к 4г, и я сделал по заданию (вопрос 1).
- **Спор типа PAYMENT в статусе OPEN не блокирует:** по спецификации он
  ничего не замораживает и ничего не двигает автоматически. Решение по нему
  с refund блокирует через правило `refunds`.
- **Нет автоматики:** revoke и redraft делает человек; никакой sweep не
  отзывает одобрения сам.
- **В админке у FAILED осталась кнопка «Cancel», которую сервер
  отклоняет** — дефект интерфейса `main`, в задание не входил, не трогал.
- **Собственные ошибки по ходу работы:**
  1. В тест 8f я по ошибке вписал строку
     `complete(...).catch(() => undefined)` — проглатывание ошибки, фактически
     фальшивый шаг. Удалил до первого запуска, в коммит она не попала.
  2. Искал `transaction-discipline` среди интеграционных наборов, а это unit-тест
     (`src/common/guards/transaction-discipline.spec.ts`). Прогон показал
     «file not found». Unit-тесты прогнал отдельно, они прошли.
  3. Первый вариант 8h проходил и при отключённой блокировке `markPaid`:
     он проверял только revoke. Добавил в 8h явную проверку отказа
     `markPaid`.
  4. Контекст из прошлой задачи: локальные Postgres и Redis упали после
     рестарта контейнера, пришлось поднимать заново.

## 5. Чем доказано

Новые интеграционные тесты на реальном PostgreSQL, в `partner-commerce-settlement.int-spec.ts`:

| Тест | Сценарий | Результат |
|---|---|---|
| 8c | READY → APPROVED → спор OPEN (`openedAfterSettlement = true`, hold нет) → `markPaid` | `OPEN_DISPUTE_NOT_IN_SETTLEMENT`; `markPaymentPending` — тоже; 0 проводок `partner.settlement.paid`, статус APPROVED, нет reference и attempts |
| 8d | APPROVED → спор → RESOLVED_PARTNER → `markPaid` | PAID 28500, одна проводка, долг перед партнёром 0 |
| 8e ×2 | APPROVED → спор → RESOLVED_CUSTOMER 12000 / RESOLVED_SPLIT 6000 | `markPaid` и `markPaymentPending` → `DISPUTE_REFUND_NOT_IN_SETTLEMENT`, `cancel` отклонён. `revokeApproval` → CANCELLED, 0 entries, одобрение сохранено. Redraft заново клеймит освобождённые проводки плюс refund: net 17100 / 22800; оплачен; долг 0 |
| 8f | PAYMENT_PENDING → спор OPEN | `markPaid` отклонён |
|  | → решён для клиента | revoke → `TRANSFER_MAY_HAVE_STARTED`, `cancel` отклонён, claims на месте |
|  | → `markPaid` | PAID 28500; unsettled −11400 (долг), «Nothing to pay»; следующий заказ 40000 → 26600 |
| 8g | REQUIRES_RECONCILIATION + спор решён для клиента | revoke отклонён; unsettled не содержит заклеймленных проводок; новый draft клеймит только новые (26600); вставка второго claim на ту же проводку → P2002; reconciliation MONEY_MOVED + confirm → PAID |
| 8h | Решён для клиента до перевода | `markPaid` старой суммы отклонён; фактически выплачено 17100 (≠ 28500), кредит `PLATFORM_BANK` 17100, долг 0, клиенту вернулось 12000 |

Во всех тестах после каждого теста проверяются `assertExplained`
(PARTNER_PAYABLE = unsettled + незакрытые settlements, нераспознанных видов
нет) и replay всех счетов.

Мутационная проверка:
- Отключил `assertPayable` → упали 8c, 8e ×2, 8f (4 теста). 8h после
  доработки тоже проверяет отказ.
- Отключил проверку статуса и признаков перевода в `revokeApproval` → упали
  8f и 8g.
- Код возвращён из копии, `MUTANT` в коде нет (grep = 0).

Локальные прогоны на коде `dbf3ebf9`:

| Прогон | Результат |
|---|---|
| `partner-commerce-settlement` | 23/23 |
| Затронутые наборы: settlement, `partner-settlement` (`main`), returns-disputes, http, final-fixes, partner-settlement-check | 6 наборов, 103/103 |
| Полный интеграционный прогон | LOCAL_FULL |
| API unit (включая `transaction-discipline`) | 704/704 |
| admin | 15 наборов, 106/106 |
| `pnpm typecheck` | 0 ошибок |
| `pnpm lint` | 0 ошибок |

GitHub CI: CI_RESULT

## 6. UNVERIFIED

- Гонка «`resolve()` × `markPaid`» не покрыта отдельным параллельным тестом.
  Корректность обоснована рассуждением: `resolve` меняет статус спора
  атомарно, а return пишется позже. `markPaid` в этом окне видит «return ещё
  нет» и отказывает. Гонка «`open()` × `markPaid`» сериализована блокировкой
  партнёра.
- HTTP-роут `revoke-approval` проверен только сборкой и типами, HTTP-тестом
  не проверялся. Сервис проверен интеграционными тестами.
- Кнопка в админке проверена unit-тестом, не в браузере.
- Признак `settlement.payment_pending` берётся из JSON-поля аудита
  (`metadata.event`). Если аудит этого события когда-нибудь уберут, этот
  признак пропадёт. Остальные четыре признака останутся.

## 7. Вопросы владельцу

1. FAILED (перевод однозначно не ушёл) + спор решён для клиента. Сейчас, по
   4г, можно выплатить старую сумму, а refund станет долгом. Разрешить здесь
   `revokeApproval` так же, как для APPROVED?
2. OPEN спор после APPROVE ничего не замораживает. Нужно ли при
   `revokeApproval` создавать hold, чтобы новый черновик можно было одобрить
   до решения спора (без спорной суммы)?
3. Redraft после revoke идёт за период `periodStart` → now, а не по
   каденции партнёра. Устраивает?

---

FINAL_LINE
