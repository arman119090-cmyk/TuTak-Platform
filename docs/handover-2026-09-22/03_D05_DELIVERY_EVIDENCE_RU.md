# D05 — алерт, который срабатывает один раз: доказательство

Вопрос: **если канал лежал ровно в ту секунду, когда сработал одноразовый
алерт, узнает ли об этом человек когда-нибудь**. До 22.09.2026 — нет.

Код: `apps/api/src/infrastructure/alerts/alert-outbox.service.ts`,
`alerts.service.ts`, sweep `alerts.redeliver` в `sweeps.jobs.ts`, миграция
`20260922090000_alert_outbox`.
Тесты: `apps/api/test/audit-2209-alert-delivery.int-spec.ts` →
`evidence/d05-after.txt`.

---

## 1. Что именно было не закрыто

Исправление 21.09 верное и недостаточное. Оно укорачивает окно подавления в
Redis после неудачной отправки, то есть разрешает **следующий** `fire()`
пройти раньше. Для повторяющихся источников (reconciliation, heartbeat,
stale top-ups) этого хватает: они сработают снова.

Два источника не сработают снова никогда:

| Источник | Почему следующего `fire()` не будет |
| --- | --- |
| `outbox.dead-letter:<id>` (`ledger/outbox.service.ts`) | Строка получает `attempts >= MAX_ATTEMPTS` и навсегда выпадает из запроса claim (`WHERE attempts < MAX_ATTEMPTS`) |
| `psp.callback-dead-letter:<id>` (`psp/psp-callback-inbox.service.ts`) | Строка переходит в `DEAD`; воркер берёт только `RECEIVED` |

Что ещё могло бы заметить — проверено по всему коду:

- метрика `outboxDeadLettered` в `/metrics` — в production эндпоинт отвечает
  403, `METRICS_TOKEN` среди 38 переменных сервиса нет;
- `GET /psp/callbacks/dead-lettered` и `outbox.deadLettered()` — админские
  списки, которые надо открыть.

Оба требуют, чтобы человек уже смотрел. Именно этого алерт и должен был
добиться.

---

## 2. Решение

`alert_outbox_events`: id, key, severity, title, body, context, status
(`PENDING` / `DELIVERED` / `UNDELIVERABLE`), attempts, nextAttemptAt,
leaseUntil, lastError, deliveredAt, createdAt, updatedAt.

Поток в `AlertsService.fire`:

1. окно подавления в Redis — как раньше (дубли подавляются до записи);
2. **запись строки `PENDING` до отправки**;
3. отправка в канал;
4. `settle()` по ответу канала: `DELIVERED` + `deliveredAt`, либо attempts+1 и
   `nextAttemptAt = now + backoff`, либо `UNDELIVERABLE`, если канал не умеет
   доставлять по устройству (console-fallback, `retryable` не выставлен).

Порядок «запись → отправка», а не наоборот, именно из-за одноразовости:
падение процесса между ними оставляет строку `PENDING`, которую подберёт
sweep. Обратный порядок не оставил бы ничего.

`AlertOutboxService.redeliverDue()` (sweep `alerts.redeliver`, каждые 30 с):

```sql
UPDATE "alert_outbox_events" SET "leaseUntil" = $lease
 WHERE id IN (
   SELECT id FROM "alert_outbox_events"
    WHERE status = 'PENDING' AND "nextAttemptAt" <= now
      AND ("leaseUntil" IS NULL OR "leaseUntil" < now)
    ORDER BY "nextAttemptAt"
      FOR UPDATE SKIP LOCKED LIMIT 25)
RETURNING …
```

- `SKIP LOCKED` + lease 60 с: вторая реплика берёт **другие** строки;
- claim и отправка — разные транзакции: держать транзакцию БД открытой на
  время HTTP-запроса к Telegram значит занимать соединение чужой задержкой;
  просроченный lease закрывает дыру, если воркер умер в середине;
- backoff 60 с → 15 мин с потолком; `PENDING` не снимается по числу попыток —
  критичный алерт не выбрасывается по расписанию;
- `DELIVERED` — только из ответа канала;
- доставленные строки старше 30 суток удаляются тем же sweep.

Видимость для оператора: `undelivered()` возвращает `PENDING` и
`UNDELIVERABLE` (до 200 строк, старейшие первыми).

**Exactly-once не обещается.** Канал, принявший сообщение и потерявший ответ,
получит его снова. Приоритет — не потерять алерт; дубль допустим.

---

## 3. Тесты (13, на реальных PostgreSQL + Redis)

| Сценарий из задания | Тест |
| --- | --- |
| единственный `fire()`, первая доставка неудачна | «a single fire() whose delivery fails…»: строка `PENDING`, attempts 1, lastError содержит ECONNREFUSED |
| канал восстановился, доставка повторилась **без нового `fire()`** | тот же тест: `redeliverDue()` → `{claimed:1, delivered:1}`, строка `DELIVERED`, attempts 2 |
| рестарт между сохранением и отправкой | «a row written but never sent»: строка с attempts 0 подбирается и доставляется |
| два workers | «two workers draining together»: между ними доставлены обе строки, ни одна не ушла дважды |
| lease | «a lease that expires…» (подбирает) и «a live lease keeps a second worker off» (не подбирает) |
| сбой после отправки до фиксации результата | «a send whose outcome was never recorded»: строка осталась `PENDING` → отправляется снова (дубль вместо тишины) |
| Redis временно недоступен | «Redis being down…»: алерт отправлен и записан, потом доставлен повтором |
| БД временно недоступна | «the database being unavailable never fails the alert itself»: отправка состоялась, запись — best-effort |
| БД нет вовсе (скрипт `alert:verify`) | «a deployment with no database at all still alerts»: `durable === false`, доставка работает |
| сохранение санитаризации PII и секретов | «redelivery carries exactly what was sent…»: повтор равен оригиналу по всем пяти полям; ни attempts, ни leaseUntil, ни nextAttemptAt в сообщение не попадают. Контекст формирует вызывающий код — повтор ничего не добавляет |
| нет канала, способного доставить | «with no channel that can deliver…»: `UNDELIVERABLE`, sweep её не берёт, оператору видна |
| сквозной, через настоящий `OutboxService` | «a dead-lettered outbox event reaches a human even though the channel was down»: реальный обработчик бросает, событие исчерпывает 10 попыток, алерт ложится в PENDING, затем доставляется |

```
Tests: 13 passed, 13 total
```

Реальное сообщение человеку не отправлялось: канал в тестах — скрипт.

---

## 4. Красное «до»

Структурное, и это честнее подогнанного теста: до исправления не было ни
таблицы, ни сервиса, ни sweep — повторять было нечем, и тест не с чем было бы
запустить. Проверяемые факты на `293b02f`:

- в списке `SWEEPS` нет ни одной задачи, читающей алерты;
- единственные читатели dead-letter — метрика (в production 403) и два
  админских списка;
- `AlertsService.fire` завершается сразу после `settleWindow`, ничего не
  сохраняя.

---

## 5. Что осталось

- **Канал по-прежнему не подтверждён человеком** (gate 4). Durable outbox
  гарантирует, что алерт дождётся канала; он ничего не гарантирует о том, что
  кто-то смотрит в Telegram. Проверка из этой среды невозможна: egress-прокси
  отвечает 403 на CONNECT к `api.telegram.org`.
- Наблюдаемость: числа недоставленных алертов сейчас видны только запросом к
  БД — `/metrics` в production закрыт (`METRICS_TOKEN` не задан). Отдельной
  метрики `alert_outbox_undelivered` не добавлено: без `METRICS_TOKEN` её
  всё равно никто не прочитает. Это пункт 3 в `05_OWNER_ACTIONS_RU.md`.
- Ретеншн: доставленные строки чистятся через 30 суток; недоставленные
  хранятся неограниченно **намеренно** — это и есть след того, о чём никому
  не сказали.
