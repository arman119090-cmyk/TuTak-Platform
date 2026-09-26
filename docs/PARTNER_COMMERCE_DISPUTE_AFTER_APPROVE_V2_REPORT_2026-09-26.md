# Partner Commerce — спор после APPROVE, часть 2 (решения владельца): отчёт (2026-09-26)

## 0. Сводка для владельца

| Пункт | Значение |
|---|---|
| FINAL code SHA | `ced29089a9e5ff08661742f7260fb39059947099` (head PR #70 на момент отчёта) |
| FINAL report SHA | коммит, добавляющий этот файл поверх `ced29089` (только `docs/`, код тот же). Файл не может содержать свой собственный SHA — он назван в аудите и виден в `git log`; CI на нём — там же |
| Полный последовательный integration run на FINAL code SHA (одна тестовая PostgreSQL) | **117/117 наборов, 1580/1580 тестов** (16:55–17:13 UTC; 1576 прежних + 8k2 + 8l×3) |
| GitHub CI на FINAL code SHA | push run 36258462669, pull_request run 36258465609 — **10/10 GREEN** (Lint/test/build, Integration 1/3, 2/3, 3/3, Build the container images × 2), 17:16–17:23 UTC |
| GitHub CI на FINAL report SHA | в аудите (после коммита этого файла) |
| Partner payout authoritative path | только `PartnerSettlementService`: DRAFT (claim проводок PARTNER_PAYABLE из allow-list, уникальный `ledgerPostingId`) → READY → APPROVED (maker/checker, банковский счёт) → PAYMENT_PENDING → PAID (`partner.settlement.paid`). Черновики — только вручную за закрытый период каденции (`createDraftForClosedPeriod`). Выписки — read-only отчёт |
| Settlement migration safety | без изменений с отчёта интеграции: `20260926200000` (+DAILY) и `20260926200100` (guard STOP при явном расхождении, затем DROP `settlementPeriod`) проверены на пустой БД, БД `main`, БД Partner Commerce v2 — двойного клейма нет, PAID не тронуты, replay ок, сумма леджера 0, дрейфа нет. В этой части миграций нет |
| FAILED / MONEY_DID_NOT_MOVE recovery | FAILED revocable, если доказано «деньги не ушли»: однозначный отказ банка (`markFailed`, без reconciliation) или двухперсонно подтверждённый MONEY_DID_NOT_MOVE без какой-либо попытки после подтверждения; исторический reference не мешает; при customer refund stale-сумму нельзя ни оплатить, ни начать переводить — только revoke, проводки уходят в следующий closed-period draft. Тесты 8i, 8j, 8k, 8k2, HTTP |
| OPEN dispute recovery | OPEN → `markPaid`/`markPaymentPending` → `OPEN_DISPUTE_NOT_IN_SETTLEMENT`, `revokeApproval` → `OPEN_DISPUTE_PENDING_RESOLUTION`; ждём решения. RESOLVED_PARTNER → оплата как есть; RESOLVED_CUSTOMER/SPLIT без признаков перевода → revoke; иначе lifecycle. Hold задним числом не создаётся. Тесты 8c, 8d, 8l×3 |
| resolve × markPaid concurrency | 12 гонок на реальной PostgreSQL (4 порядка × 3 исхода): CUSTOMER/SPLIT — 8/8 `markPaid` отклонён (наблюдены OPEN ×5 и REFUND-blocker ×3), stale-сумма ни разу не стала PAID, 0 проводок выплаты; PARTNER — 4/4 ровно одна проводка выплаты (1 сразу, 3 после отказа по OPEN и повтора); инвариант леджера и replay после каждой |

## 1. Задание (пересказ)

Продолжение задачи «спор после APPROVE» в Draft PR #70 по решениям владельца.
Не merge, не deploy, не Anti-Fraud.

1. **revoke из FAILED** — разрешить только если доказуемо, что деньги НЕ
   ушли. Не правило «status == FAILED → можно». Проверить модель transfer
   attempts / reconciliation; освобождать claims только когда результат
   однозначно эквивалентен MONEY_DID_NOT_MOVE и нет: успешного перевода,
   неоднозначного/нерешённого перевода, `partner.settlement.paid`, иного
   доказательства выплаты. Иначе — revoke запрещён, reconciliation
   lifecycle. Тест: customer-favourable dispute после доказанно FAILED
   перевода — stale не выплачивается, безопасный revoke разрешён.
2. **HOLD при revokeApproval** — не создавать задним числом. Если спор OPEN:
   stale не платить, ждать решения, новых финансовых механик не добавлять.
3. **Убрать автоматический redraft из revokeApproval** — только безопасный
   revoke, сохранить историю approval, освободить entries, AuditLog; новый
   draft — только вручную через authoritative closed-period flow. Причина:
   `periodStart → now` захватывает чужие новые проводки и обходит cadence.
   Immediate corrective settlement не добавлять.
4. **Concurrency test** на реальном PostgreSQL: `resolve(dispute) ×
   markPaid` для RESOLVED_CUSTOMER / SPLIT — ни один interleaving не даёт
   stale сумме стать PAID (допустимо: отказ по OPEN или по refund-blocker);
   для RESOLVED_PARTNER — после окончательного решения markPaid проходит;
   нет двойных проводок, инвариант леджера.
5. **HTTP test** `POST admin/partner-settlements/:id/revoke-approval`:
   permission, обязательный reason, APPROVED без evidence → success,
   DRAFT/READY → reject, PAYMENT_PENDING → reject, reconciliation → reject,
   FAILED → только при доказанном MONEY_DID_NOT_MOVE, повторный вызов
   отклоняется, claims освобождены, redraft не создаётся.
6. **Admin UI** — если FAILED допускает safe revoke, не оставлять Cancel,
   который сервер всегда отклоняет; показывать только действия реальной
   state machine; обычный `cancel()` на committed-статусы не расширять.
8. **Решение владельца перед push (1):** двухперсонно подтверждённый
   MONEY_DID_NOT_MOVE — достаточное доказательство для решённой им попытки;
   исторический `bankTransferReference` этой попытки сам по себе не запрещает
   revoke. FAILED revocable только если: есть подтверждённый MONEY_DID_NOT_MOVE,
   соответствующий attempt окончательно resolved, и ПОСЛЕ момента
   подтверждения не было нового PAYMENT_PENDING, нового attempt, MONEY_MOVED,
   `partner.settlement.paid`, PAID, нового неоднозначного результата.
   Нужна последовательностная проверка. При наличии customer refund — не
   разрешать повтор stale-выплаты, а revoke и оставить проводки следующему
   штатному closed-period settlement. Тесты: FAILED → confirmed
   DID_NOT_MOVE → refund → revoke → claims released → повтор невозможен;
   confirmed DID_NOT_MOVE → новый attempt → revoke снова запрещён.
9. **Решение владельца перед push (2):** `revokeApproval` при OPEN ORDER
   dispute по заказу из settlement — ЗАПРЕТИТЬ отдельным conflict
   (`OPEN_DISPUTE_PENDING_RESOLUTION`); после решения: PARTNER → markPaid;
   CUSTOMER/SPLIT + нет признаков перевода → revoke; иначе lifecycle.
   Обычный `cancel()` не расширять. Тесты на все три исхода.
7. **Завершение** — полный локальный integration run последовательно; push;
   GitHub CI; финальный report commit; GitHub CI на финальном head. Только
   после этого «Partner Commerce financial settlement: CLOSED», если
   выполнены и остальные условия CLOSURE FIXES v3.

## 2. База

- Ветка `claude/tutak-staging-flow-check-hl97qh`, Draft PR #70.
- Начало этой части: `814385db` (часть 1: код `dbf3ebf9`, отчёт
  `docs/PARTNER_COMMERCE_DISPUTE_AFTER_APPROVE_REPORT_2026-09-26.md`).
  GitHub CI на `814385db` — 10/10 GREEN (push run 36254552346, pull_request
  run 36254556783); один шард integration шёл 19 минут (16:11→16:30) — с
  прежним лимитом 15 минут он бы упал, лимит 25 оправдался.
- Код этой части: `4636a1bc` + `ced29089` = **FINAL code SHA `ced29089`**. Финальный отчёт — docs-коммит поверх.

## 3. Что сделано

Миграций нет. Все правила — на существующих данных и триггерах.

### 3.1 Что значит «доказуемо не ушли» (`transferEvidence`)

`transferEvidence(settlement)` возвращает список признаков того, что перевод
мог сдвинуть деньги. **Пустой список = доказано, что нет.** Только при пустом
списке (а) разрешён `revokeApproval` и (б) refund по решению в пользу клиента
блокирует выплату stale-суммы (`DISPUTE_REFUND_NOT_IN_SETTLEMENT`).

| Признак | Когда считается |
|---|---|
| `status …` | статус не APPROVED и не FAILED (PAYMENT_PENDING — перевод в пути; REQUIRES_RECONCILIATION — неизвестно; PAID) |
| `marked paid` | `paidAt` или `ledgerTransactionId` |
| `partner.settlement.paid posting` | проводка выплаты с `sourceId` этого settlement |
| `a successful transfer attempt` | attempt с `succeeded = true` |
| `an unresolved transfer attempt` | attempt с `resolvedAt IS NULL` (неоднозначный) |
| APPROVED: `a transfer attempt`, `a bank transfer reference…`, `a reconciliation reading…`, `PAYMENT_PENDING recorded` | у APPROVED ничего не пробовали — любой след попытки (защита от подмены данных) |
| FAILED: `FAILED without a recorded attempt` | ни одного attempt (несогласованные данные) |
| FAILED без reconciliation: `a bank transfer reference on the settlement` | однозначный отказ банка (`markFailed`) reference на строку не ставит; если он есть — история неясна |
| FAILED с подтверждённым MONEY_DID_NOT_MOVE: `a transfer attempt after MONEY_DID_NOT_MOVE was confirmed`, `PAYMENT_PENDING after MONEY_DID_NOT_MOVE was confirmed` | attempt с `attemptedAt > reconciliationConfirmedAt` или аудит payment_pending после подтверждения — старое подтверждение ничего не говорит о новой попытке |
| FAILED с иным чтением: `a reconciliation reading of MONEY_MOVED` / `… (unconfirmed)` | чтение MONEY_MOVED или неподтверждённое решение |

Для FAILED событие PAYMENT_PENDING в истории — норма (так отклонённый
перевод и дошёл до банка). Доказательство — либо однозначный отказ банка
(`markFailed`, без reconciliation), либо двухперсонное подтверждение
MONEY_DID_NOT_MOVE; в последнем случае reference на строке (от решённой
попытки или отозванного чтения MONEY_MOVED) **не** считается против (решение
владельца), а любая попытка после момента подтверждения делает settlement
недоказанным до новой reconciliation с новым `reconciliationConfirmedAt`.

Ровно один из двух режимов действует всегда: либо доказано «не ушло» —
тогда stale-сумму нельзя ни оплатить, ни начать переводить, но можно
отозвать; либо не доказано — тогда revoke запрещён, а выплата/повтор
разрешены, refund становится долгом следующего периода. Зависшего
состояния нет.

### 3.2 `revokeApproval` — только освобождение (п. 3)

- Разрешён из APPROVED и FAILED, только при пустом `transferEvidence`;
  всё под `lockPartnerForSettlement`, со свежим чтением.
- DRAFT/READY → «cancel this settlement instead»; CANCELLED →
  `ALREADY_CANCELLED` (повторный вызов безопасно отклоняется); остальное →
  `TRANSFER_MAY_HAVE_STARTED` с перечислением признаков.
- Делает: статус → CANCELLED (approvedBy/At, failedReason — остаются как
  история), `cancelledReason = "approval revoked: …"`, удаляет entries
  (триггер `partner_settlement_entries_frozen` разрешает после смены
  статуса), аудит `settlement.approval_revoked` с `fromStatus` и числом
  освобождённых entries. Возвращает строку settlement.
- **Redraft убран.** Освобождённые проводки и refund остаются unsettled и
  попадают в следующий черновик, который администратор создаёт через
  `createDraftForClosedPeriod` (cadence). Helper `draftInTx` из части 1
  удалён, `createDraft` возвращён к форме `main` + lock.
- HOLD при revoke не создаётся (п. 2). OPEN спор → `markPaid` /
  `markPaymentPending` отклоняются, **и `revokeApproval` отклоняется**
  (`OPEN_DISPUTE_PENDING_RESOLUTION`, п. 9): settlement ждёт решения; PARTNER
  → оплачивается как есть, CUSTOMER/SPLIT → revoke.

### 3.3 Исправление модели attempts (п. 1, «проверить существующую модель»)

В `main` подтверждение reconciliation писало **новую** строку attempt, а
неоднозначная строка (`resolvedAt = NULL`) оставалась навсегда. Для
MONEY_MOVED это скрывалось совпадением bank reference; для
MONEY_DID_NOT_MOVE — нет: FAILED после двухперсонного «деньги не ушли»
выглядел бы как «возможно ушли», и revoke был бы невозможен всегда.

Исправлено: `confirmReconciliationOutcome` передаёт `resolvesAmbiguous`, и
`recordAttempt` решает неоднозначную строку **на месте**, какой бы reference
ни назвало решение (reference добавляется, но не затирается). Это
соответствует собственному docblock `main` («the same row is updated rather
than a new one written»). Тесты `main` по reconciliation проходят без
изменений (`partner-settlement.int-spec.ts`, 1 attempt после MONEY_MOVED).

### 3.4 HTTP и админка (пп. 5, 6)

- Роут `POST admin/partner-settlements/:id/revoke-approval` (SETTLEMENT_MANAGE,
  тело `{reason}` 3–500 символов) возвращает settlement.
- Админка: у APPROVED и FAILED — «Revoke approval» (с причиной), кнопки
  «Cancel», которую сервер всегда отклонял, у обоих нет. У PAYMENT_PENDING и
  REQUIRES_RECONCILIATION revoke не предлагается (сервер отказал бы).
  `cancel()` на committed-статусы не расширен.
- `docs/PARTNER_COMMERCE.md` §14 — таблица «спор × статус» переписана под
  новые правила; комментарий в `order-disputes.service.ts` обновлён.

### 3.5 Файлы

- `apps/api/src/modules/partner-settlements/partner-settlement.service.ts`
- `apps/api/src/modules/partner-settlements/partner-settlement.controller.ts`
- `apps/api/src/modules/partner-orders/order-disputes.service.ts` (комментарий)
- `apps/api/test/partner-commerce-settlement.int-spec.ts` (8e, 8h переписаны; 8i, 8j, 8k, 8k2, 8l×3, 8r×3 добавлены)
- `apps/api/test/partner-commerce-http.int-spec.ts` (HTTP revoke-approval)
- `apps/admin/src/app/(dashboard)/settlements/page.tsx`, `page.test.tsx`, `apps/admin/src/lib/api/financeApi.ts`
- `docs/PARTNER_COMMERCE.md`

## 4. Что НЕ сделано

- **OPEN спор после APPROVE** по-прежнему ничего не замораживает и hold не
  создаётся (по п. 2); revoke при OPEN запрещён (п. 9).
- **FAILED без reconciliation, но с reference на строке** — штатно
  недостижимо (`markFailed` reference на строку не пишет); если данные
  такие, revoke запрещён. Теста нет.
- **FAILED после новой попытки при устаревшем подтверждении**: stale-сумму
  по-прежнему можно повторно выплатить (`markPaid` из FAILED разрешён в
  `main`, refund станет долгом) — это режим «не доказано». Выход к revoke —
  новая reconciliation (8k2).
- **Автоматики нет**: revoke делает человек; черновики — только вручную по
  cadence (по п. 3).
- **Мутационная проверка HTTP-теста** не делалась (сервисные мутации
  покрывают ту же логику).
- **Собственные ошибки по ходу работы:**
  1. HTTP-тест: ожидал 403 для владельца партнёра — получил 201 и на минуту
     принял это за дыру в правах. Причина — интеграционный seed выдаёт
     **каждой роли все permissions** (`test/setup/global-setup.ts`, так
     задумано: интеграционные наборы проверяют деньги, не авторизацию).
     Production-раскладку прав проверяет `src/scripts/money-permissions.spec.ts`
     (SETTLEMENT_MANAGE — только ADMIN и SUPER_ADMIN). В HTTP-тесте заменил на
     «без токена → 401, пользователь без роли → 403» и объяснил в комментарии.
  2. При правке `financeApi.ts` продублировал закрывающие скобки — поймал
     prettier до коммита.
  3. В helper гонки вернул Promise из колбэка `setTimeout` — eslint
     `no-misused-promises`; исправил.

## 5. Чем доказано

Новые/переписанные интеграционные тесты (реальный PostgreSQL),
`partner-commerce-settlement.int-spec.ts` — весь набор **29/29**:

| Тест | Сценарий | Проверка |
|---|---|---|
| 8e ×2 | APPROVED → RESOLVED_CUSTOMER 12000 / SPLIT 6000 | markPaid и payment-pending → `DISPUTE_REFUND_NOT_IN_SETTLEMENT`; cancel отклонён; revoke → CANCELLED, approvedBy сохранён, 0 entries, **0 DRAFT/READY** (redraft нет); освобождённые проводки в unsettled; closed-period draft клеймит их + refund: 17100 / 22800; оплачен; долг 0 |
| 8h | то же, финансовое сравнение | фактически выплачено 17100 ≠ stale 28500; кредит PLATFORM_BANK 17100; клиенту вернулось 12000 |
| 8i | FAILED через `markFailed` (банк отказал) + решение для клиента | attempt: 1, resolved, failed; markPaid/payment-pending stale → отказ; revoke разрешён из FAILED; следующий draft 17100 |
| 8j | FAILED через reconciliation MONEY_DID_NOT_MOVE | пока REQUIRES_RECONCILIATION — ни оплатить, ни отозвать; после confirm — **1 attempt, resolved на месте** (MAYBE-8J, failureReason = evidence); stale отказ; revoke разрешён; draft 17100 |
| 8k | FAILED после отозванного MONEY_MOVED | revoke → `TRANSFER_MAY_HAVE_STARTED` (упоминает bank reference); entries 2; повтор выплаты проходит (28500), refund — долг −11400 |
| 8r CUSTOMER / SPLIT | `resolve × markPaid`, 4 порядка (pay-first, resolve-first, ±15 мс) × 2 исхода = 8 гонок | все 8 — markPaid отклонён; статус APPROVED; 0 проводок выплаты; entries 2; инвариант |
| 8r PARTNER | 4 гонки | markPaid либо прошёл (1 из 4 — после финального решения), либо отклонён по OPEN и прошёл повтором; ровно 1 проводка выплаты; долг 0 |

Наблюдённые interleavings в 8r (отдельный прогон с логом, лог не закоммичен):
CUSTOMER — 3× OPEN, 1× REFUND-blocker; SPLIT — 2× OPEN, 2× REFUND-blocker;
PARTNER — 3× OPEN + повтор, 1× сразу PAID. То есть оба допустимых отказа
реально встречаются.

HTTP `partner-commerce-http.int-spec.ts`: без токена 401; без роли 403;
`{}` и `{reason:'no'}` → 400; DRAFT/READY → 409 «cancel instead», entries
на месте; PAYMENT_PENDING / REQUIRES_RECONCILIATION / FAILED-неоднозначный →
409 `TRANSFER_MAY_HAVE_STARTED`, статус и entries без изменений; APPROVED и
FAILED-доказанный → 201 CANCELLED, entries 0, unsettled 30000, DRAFT/READY
нет; повтор → 409 `ALREADY_CANCELLED`.

Мутационные проверки на FINAL SHA (конвейер `final-pipeline.sh`, лог
`pipeline.log`; после каждой файл восстановлен и сверен с HEAD — «restored
== HEAD»):

| Мутация | Что отключено | Упало (ожидаемо) |
|---|---|---|
| m1 | `assertPayable` (блокировки markPaid/payment-pending) | 14: 8c, 8e×2, 8f, 8h, 8i, 8j, 8k, 8k2, 8l×3, 8r CUSTOMER, 8r SPLIT |
| m2 | revoke игнорирует признаки перевода | 4: 8f, 8g, 8j, 8k2 |
| m3 | reconciliation не решает attempt на месте | 3: 8j, 8k, 8k2 |
| m4 | нет проверки «попытка после подтверждения» | 1: 8k2 |
| m5 | нет проверки OPEN dispute при revoke | 3: 8l×3 |

Проходят под мутациями только тесты, которым соответствующая защита не
нужна по построению (8d, 8g под m1; 8r PARTNER и т.п.).

Локально на FINAL code SHA `ced29089`:

| Прогон | Результат |
|---|---|
| `partner-commerce-settlement` | 33/33 (в т.ч. 8k2, 8l×3) |
| затронутые: settlement, http, `partner-settlement` (main), returns-disputes, settlement-check | 5 наборов, 92/92 |
| Полный интеграционный прогон (последовательно, одна PostgreSQL, именно FINAL SHA) | 117/117 наборов, 1580/1580 тестов |
| API unit | 704/704 |
| admin | 15 наборов, 107/107 |
| `pnpm typecheck` (build + spec) | 0 |
| `pnpm lint` | 0 ошибок |

GitHub CI на `ced29089`: **10/10 GREEN** — push run 36258462669 и pull_request run 36258465609; все пять jobs в обоих success, пропущенных нет.

## 6. UNVERIFIED

- 8r сэмплирует 4 порядка запуска × 3 исхода; это не исчерпывающий перебор
  interleavings, а выборка на реальной БД. Корректность при любом порядке
  следует из того, что `markPaid` читает статус спора и refund под
  блокировкой партнёра одним снимком: до commit `resolve` виден OPEN,
  после — RESOLVED с `customerRefundAmount`, а return ещё не заклеймлен.
- Кнопки админки проверены unit-тестами, не в браузере.
- Признак `PAYMENT_PENDING recorded` для APPROVED читается из JSON аудита.
- Поведение «FAILED без attempt» (несогласованные данные) покрыто только
  кодом, теста нет — такое состояние штатно недостижимо.

## 7. Вопросы владельцу

Оба вопроса прошлого черновика решены владельцем до push (пп. 8–9) и
реализованы. Новых вопросов нет.

---

Partner Commerce financial settlement: CLOSED
(FINAL code SHA `ced29089`; полный прогон 117/117 · 1580/1580 на нём; GitHub CI 10/10; условия отчёта интеграции — allow-list, одна каденция, read-only выписки, миграции — без изменений выполнены; финансовых UNVERIFIED по settlement нет. Не merge, не deploy.)
