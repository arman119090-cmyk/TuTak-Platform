# D02 — payout и settlement одновременно: доказательство

Файл отвечает на один вопрос: **может ли одно экономическое обязательство
партнёра профинансировать два независимых назначения выплаты**. До 22.09.2026
— да. Сейчас — нет, и это проверяется тестом, который без исправления красный.

Тесты: `apps/api/test/audit-2209-payout-settlement-race.int-spec.ts`.
Логи: `evidence/d02-before.txt`, `evidence/d02-after.txt`.

---

## 1. Что было в коде

`PayoutEngineService.executePayout` (до исправления):

```ts
const locked = await tx.$queryRaw`
  SELECT balance FROM "ledger_accounts" WHERE id = ${payableAccount.id} FOR UPDATE
`;
const reserved = await this.reservedBySettlements(tx, partnerId, currency);
const available = new Decimal(locked[0]?.balance ?? 0).negated().minus(reserved);
if (available.lessThan(amount)) throw new ConflictException(…);
```

Комментарий рядом утверждал, что параллельный draft «либо виден здесь, либо
блокируется на той же строке, когда читает `unsettled()` в своей транзакции».
Второй половины не существовало:

`PartnerSettlementService.createDraft` открывал `$transaction`, читал партнёра,
искал открытые settlement и вызывал `unsettled()` — а `unsettled()` делает
`db.ledgerAccount.findFirst` и `db.ledgerPosting.findMany`. Ни одной
блокировки. Изоляция — READ COMMITTED (по умолчанию у Prisma).

Защита на уровне БД одна: `UNIQUE (ledgerPostingId)` на
`partner_settlement_entries`. Она разводит два draft между собой и **ничего не
знает о payout**: payout не создаёт ни одной entry-строки.

---

## 2. Как это проверено

Не `Promise.all` и не `sleep`. Каждый тест открывает обе транзакции на
реальных соединениях и останавливает одну из них ровно в точке принятия
решения — после чтения «сколько свободно», до записи claim — и отпускает
только когда вторая дошла до нужного состояния.

Барьер ставится подменой метода на экземпляре сервиса (собственное свойство
перекрывает прототип), то есть настоящий код выполняется целиком, а пауза
вставляется между его собственными операторами:

```ts
// draft: пауза после чтения unsettled(), внутри его транзакции
(settlements as …).unsettled = async (...args) => {
  const result = await original(...args);
  if (armed && args[1]?.tx) { armed = false; await arrive(); }
  return result;
};

// payout: пауза после FOR UPDATE и чтения reserved, внутри его транзакции
holder['reservedBySettlements'] = async (...args) => {
  const result = await original(...args);
  if (armed && args[0] !== prisma) { armed = false; await arrive(); }
  return result;
};
```

Проверяемый инвариант сформулирован по-человечески и печатает обе стороны:

```
открытые settlement + payout не в статусе FAILED  ≤  обязательство партнёра
```

Ledger-идентичность (`ledgerBalance = net + inOpenSettlements + underReview`)
этот случай **не ловит**: дебет самого payout попадает в `net` со знаком
минус, и книги сходятся при 100 000 обещаний против 50 000 обязательства.
Поэтому инвариант проверяется отдельно.

---

## 3. Числа

Партнёру начислено 50 000 (`partner.bonus_redemption_compensation`, CREDIT).

### До исправления — `evidence/d02-before.txt`

```
✕ D02d  settlements 50000.0000 + payouts 50000.0000 = 100000.0000  (обязательство 50000.0000)
✕ D02e  settlements 50000.0000 + payouts 50000.0000 = 100000.0000
✕ D02j  settlements 50000.0000 + payouts 20000.0000 =  70000.0000
✓ D02f D02g D02h D02i D04c D02k
Tests: 3 failed, 6 passed, 9 total
```

### После исправления — `evidence/d02-after.txt`

```
✓ D02d  draft проходит; payout → ConflictException «already claimed by an open settlement»; payout-строк 0
✓ D02e  payout проходит; draft → ConflictException «Nothing to pay»; settlement-строк 0
✓ D02f  два draft одновременно → ровно один DRAFT
✓ D02g  два payout одновременно → ровно один payout
✓ D02h  cancel settlement в середине решения payout: payout отклонён; после cancel деньги свободны ровно один раз
✓ D02i  mark-paid в середине решения payout: settlement оплачен, payout отклонён
✓ D02j  частичная выплата 20 000 против draft → draft проходит, payout отклонён
✓ D04c  draft, созданный посреди чтения position(): одна и та же сумма не показана дважды
✓ D02k  повтор запроса с тем же idempotency key после потери ответа → один payout
Tests: 9 passed, 9 total
```

Отдельно проверено, что D02d/D02e не «проходят сами собой»: в обоих тестах
фиксируется, что проигравшая операция **ждала** (не завершилась за 750 мс,
пока держалась блокировка), а не просто была отвергнута по другой причине.

---

## 4. Исправление

`LedgerService.lockPartnerPayable(tx, partnerId)`:

```sql
SELECT id FROM "ledger_accounts"
 WHERE "type" = 'PARTNER_PAYABLE' AND "partnerId" = $1
 ORDER BY id
   FOR UPDATE
```

Вызывается **первым оператором** транзакции в двух местах:
`PartnerSettlementService.createDraft` и `PayoutEngineService.executePayout`.
После блокировки каждая операция перечитывает свою величину (draft —
`unsettled()`, payout — баланс счёта и сумму открытых settlement).

Почему так:

- **Один порядок у всех.** Все строки `PARTNER_PAYABLE` партнёра, `ORDER BY
  id`. Взаимная блокировка невозможна, даже если у партнёра появится вторая
  валюта.
- **Конфликт с записью баланса.** `ledger.post` делает
  `UPDATE … SET balance = balance + delta`, который конфликтует с `FOR
  UPDATE`. Значит, начисление или оплата settlement, пришедшие в середине
  решения, ждут — а не двигают число, по которому решение уже принято.
- **Нет новой таблицы и нет вычисляемого ключа.** Advisory lock потребовал бы
  ключа, который нужно одинаково вычислить в двух местах; отдельная строка
  координации — ещё одной сущности, которую надо создавать раньше счёта.
  Строка счёта существует всегда, когда есть что выделять: без счёта нет
  проводок, без проводок нечего обещать.
- **Отсутствие счёта безопасно.** Нет строк — нет блокировки; но тогда нет и
  проводок, `unsettled()` вернёт ноль, и draft откажет сам.

Цена: транзакция draft на время своей работы блокирует начисления этому
партнёру. Draft — короткая транзакция; на нагрузочном прогоне (23 809
проводок, один busy-партнёр) деградации не наблюдалось.

---

## 5. Что этим не доказано

- Две и более реплики API одновременно: блокировка живёт в PostgreSQL и от
  числа процессов не зависит, но прогон на двух репликах не делался.
- Партнёр с несколькими валютами: блокировка берёт все его строки, но
  `unsettled()` и `createDraft` по-прежнему не фильтруют по валюте — это
  отдельная неточность, отмеченная как P2 и не исправленная здесь, чтобы не
  менять бизнес-поведение settlement.
- Одновременные `collection` + `draft` (D03): не проверялось.
