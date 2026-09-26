# Idram: что должен подтвердить провайдер до включения реальных денег

Дата: 19.09.2026
Состояние: `TUTAK_PSP_ENABLED` в production **отсутствует** (деньги выключены).
Код денежного контура в `main` (`ef710f3`, `98da0a4`) и в production.
Idram LIVE — **UNVERIFIED**: интеграция написана по предоставленной выписке из
документации и ни разу не работала против реального провайдера.

Этот документ — не «расскажите, как работает ваш API». Каждый вопрос ниже
привязан к конкретному месту в коде, и от ответа зависит, что в нём
изменится. Где ответ Idram ничего не меняет — вопроса нет.

Что здесь **не** спрашивается и что **не** передаётся Idram: секретный ключ,
реальные учётные данные, персональные данные клиентов, внутренняя
архитектура TuTak.

---

## 1. Таблица подтверждений

Условные обозначения в колонке «реализовано»: `idram.adapter.ts` —
`apps/api/src/modules/psp/idram.adapter.ts`; `contract.spec` —
`apps/api/src/modules/psp/idram.contract.spec.ts`; `inbox` —
`psp-callback-inbox.service.ts`; `ageing` — `psp-attempt-ageing.service.ts`.

### 1.1 Checksum (`EDP_CHECKSUM`)

| Вопрос | Реализовано в TuTak сейчас | Что должен подтвердить Idram | Что изменится при другом ответе |
|---|---|---|---|
| Порядок полей | `EDP_REC_ACCOUNT : EDP_AMOUNT : SECRET_KEY : EDP_BILL_NO : EDP_PAYER_ACCOUNT : EDP_TRANS_ID : EDP_TRANS_DATE` (`idram.adapter.ts`, `verifyCallback`) | Точный порядок, включая позицию `SECRET_KEY` | Массив в `verifyCallback` и ожидаемый дайджест `OFFICIAL_CHECKSUM` в `contract.spec`; тестовые подписанты в `psp-callback-inbox.int-spec.ts` и `psp-callback-burst-measured.int-spec.ts` |
| Разделитель | Двоеточие `:` без пробелов | Что это `:` и что пробелов/иных разделителей нет | Та же строка `join(':')` |
| Кодировка строки перед хешированием | UTF-8 (Node `createHash('md5').update(string)`) | Кодировка (UTF-8 / другая) и что поля берутся **как пришли** в POST, без trim/нормализации | `update(str, encoding)`; если нужна нормализация — `wireField` в `psp-wire.ts` |
| Представление MD5 | Hex, 32 символа; наш расчёт в верхнем регистре, сравнение регистронезависимое (`toUpperCase()` обеих сторон) | Что это hex (не base64) и в каком регистре Idram отправляет | Если base64 — `digest('base64')` и сравнение как есть |
| Формат `EDP_AMOUNT` в checksum | Строка **как пришла в коллбэке**; в нашей форме мы отправляем `amount.toFixed(2)` (например `14000.00`) | Формат суммы в коллбэке: разделитель `.`, всегда ли два знака, есть ли тысячные разделители, совпадает ли строка с той, что мы отправили в `EDP_AMOUNT` формы | `createBill`: `toFixed(2)`; `wireMoney` в `psp-wire.ts` (сейчас принимает только `^\d+(\.\d+)?$`, запятую отвергает как искажение) |
| Формат `EDP_TRANS_DATE` | Строка как пришла, в checksum не разбирается; контрактный вектор использует `DD/MM/YYYY HH:mm:ss` | Точный формат и часовой пояс | Только `contract.spec` (вектор); код не парсит дату — при другом формате менять нечего, кроме теста |
| Пустой `EDP_PAYER_ACCOUNT` | Допускается пустым; остальные обязательные поля пустыми не допускаются (отказ до подсчёта checksum) | Может ли `EDP_PAYER_ACCOUNT` отсутствовать/быть пустым; может ли пустым быть что-то ещё | Список исключений в `verifyCallback` (`name !== 'EDP_PAYER_ACCOUNT'`) |
| Контрольный вектор | `contract.spec`: для `110000110 / 14000.00 / bill-contract-1 / payer@example / IDRAM-TX-777 / 19/09/2026 12:34:56` и ключа `contract-secret-key` ожидается `CF9A9178674067320EE1E57003BE6278` | **Просим Idram посчитать checksum для этого же вектора** (ключ тестовый, не наш) и прислать результат | Если результат другой — порядок/кодировка/формат выше неверны; тест упадёт первым |

### 1.2 `EDP_TRANS_ID`

| Вопрос | Реализовано в TuTak сейчас | Что должен подтвердить Idram | Что изменится при другом ответе |
|---|---|---|---|
| Уникальность | Дедупликация коллбэков в `inbox` по паре (провайдер, `EDP_TRANS_ID`); один `EDP_TRANS_ID` на два разных счёта → первый расчитан, второй отвергнут громко | Уникален ли `EDP_TRANS_ID` глобально или только в рамках мерчанта | Если только в рамках мерчанта — ничего (у нас один мерчант); если **не** уникален — ключ дедупликации придётся строить по (`EDP_BILL_NO`, `EDP_TRANS_ID`) |
| Стабильность при повторной доставке | Повтор одного платежа с тем же `EDP_TRANS_ID` → replay, один экономический эффект; второй `EDP_TRANS_ID` на уже оплаченный счёт → replay, записанным остаётся первый | Одинаков ли `EDP_TRANS_ID` во всех повторных доставках одного платежа | Если может меняться — replay-защита по счёту уже есть (`successKey`), но аудит-трейл будет показывать несколько id; нужно решить, какой хранить |
| Изменение при retry пользователя | Новая попытка оплаты того же счёта = новый `EDP_TRANS_ID`; один счёт может быть оплачен только один раз | Может ли один `EDP_BILL_NO` быть оплачен дважды с разными `EDP_TRANS_ID` (двойная оплата на стороне Idram) | Если да — второй платёж попадает в отказ с записью в inbox; нужен официальный процесс возврата второго платежа (см. 1.6) |

### 1.3 Pre-check

| Вопрос | Реализовано в TuTak сейчас | Что должен подтвердить Idram | Что изменится при другом ответе |
|---|---|---|---|
| Как распознаётся | Тот же URL, что и финальный коллбэк: `POST /v1/psp/idram/callback`, `application/x-www-form-urlencoded`, признак `EDP_PRECHECK=YES` | Что pre-check приходит на тот же URL и именно с `EDP_PRECHECK=YES` (регистр значения) | Отдельный URL — добавить второй маршрут в `psp-callback.controller.ts`; другой признак — `isPrecheck` в адаптере |
| Обязательные поля | Читаем `EDP_REC_ACCOUNT`, `EDP_BILL_NO`, `EDP_AMOUNT`; проверяем мерчанта, существование счёта и что его можно оплатить | Точный список полей pre-check; приходит ли в нём `EDP_AMOUNT` и обязан ли он совпадать с суммой счёта | `readPrecheck` в адаптере; `answerPrecheck` в `psp-payment.service.ts` |
| Ответ | HTTP 200, `text/plain`, тело ровно `OK` или `NO` | Точные допустимые тела ответа, регистр, допустим ли перевод строки, важен ли `Content-Type` | `precheckResponse` в адаптере |
| Таймаут ожидания ответа | Не знаем; отвечаем синхронно за один запрос к БД (десятки мс) | Сколько Idram ждёт ответа на pre-check | Если очень мало — вынести проверку из транзакции; сейчас нет причин |
| Retry pre-check | Каждый pre-check обрабатывается независимо и записывается в inbox как `PRECHECK` | Повторяет ли Idram pre-check и сколько раз | Ничего в коде; влияет на объём inbox |
| Отсутствие ответа | — | Что делает Idram, если ответа нет: считает `NO`, повторяет, показывает клиенту ошибку? | Определяет, нужен ли нам аварийный «NO по умолчанию» на стороне прокси; в коде — ничего |

### 1.4 Финальный коллбэк

| Вопрос | Реализовано в TuTak сейчас | Что должен подтвердить Idram | Что изменится при другом ответе |
|---|---|---|---|
| Ожидаемый ответ | HTTP 200, `text/plain`, тело `OK` — **после записи в inbox, до расчёта** (расчёт делает воркер) | Что `OK` достаточно; нужен ли иной статус/тело; трактует ли Idram не-200 как «повторить» | `finalResponse` в адаптере |
| Retry policy | Не знаем. Наша сторона: приём идемпотентен, повторы безопасны в любом количестве | Интервалы, число попыток, общее окно повторов при отсутствии `OK` | Ничего в приёме; знание нужно для `PSP_TIMEOUT_POLICY` и для того, чтобы отличать «Idram ещё повторит» от «Idram сдался» |
| Поздний коллбэк | Принимается и после `EXPIRED` попытки, если нет противоречащего авторитетного ответа (`purchase-psp-lifecycle.int-spec.ts`) | Может ли коллбэк прийти через часы/дни после оплаты | Если Idram гарантирует окно (например, 24 ч) — `staleAfterMs`/`escalateEveryMs` можно выставить осмысленно вместо наших 30 мин / 1 ч |
| Коллбэк после отмены/ошибки | Отрицательного коллбэка в документации нет; отмену/ошибку мы узнаём только по отсутствию коллбэка и по ageing → эскалация человеку | Присылает ли Idram коллбэк о неуспехе/отмене, с какими полями и checksum; или неуспех = тишина | Если есть отрицательный коллбэк — новая ветка в `verifyCallback`/`settleVerifiedConfirmation`: авторитетный `FAILED` вместо ожидания; это существенно упрощает жизнь клиента |
| Коллбэк на уже подтверждённый счёт | Replay, второго эффекта нет | Присылает ли Idram повторно коллбэк по счёту, который уже подтвердил | Ничего |
| Источник запроса | Не ограничиваем по IP; подлинность — только checksum | Есть ли фиксированные исходящие IP/подсети Idram | Опционально: allow-list на уровне прокси; в коде — ничего |

### 1.5 Запрос статуса

| Вопрос | Реализовано в TuTak сейчас | Что должен подтвердить Idram | Что изменится при другом ответе |
|---|---|---|---|
| Официальный API статуса транзакции по `EDP_BILL_NO`/`EDP_TRANS_ID` | `capabilities.statusQuery = false`; `PROVIDER_STATUS_QUERY` — BLOCKED, эндпоинт не изобретён; зависшую оплату разрешают два человека по выписке | Есть ли такой API; если да — URL, аутентификация, поля ответа, лимиты | Если есть — `queryStatus` в адаптере, `statusQuery: true`, и ageing сможет спрашивать провайдера вместо эскалации человеку. **Если нет — фиксируем письменно, что нет**, и двухчеловечная реконсиляция остаётся единственным путём |

### 1.6 Возврат / отмена

| Вопрос | Реализовано в TuTak сейчас | Что должен подтвердить Idram | Что изменится при другом ответе |
|---|---|---|---|
| Полный возврат через API | `capabilities.refund = false`; `PSP_REFUNDS_ENABLED` выключен; возврат PSP-покупки отказывается с «not available yet» | Есть ли API полного возврата: URL, аутентификация, идемпотентность, сроки | Если есть — `refund()` в адаптере и `refund: true`; флаг остаётся выключенным до sandbox-проверки |
| Частичный возврат | Не поддерживается | Есть ли частичный возврат | Как выше; иначе частичный возврат PSP-покупки остаётся ручным |
| Reversal / void неоплаченного счёта | `capabilities.void = false`; неоплаченный счёт просто стареет | Можно ли отменить выставленный счёт | Если да — `void()` и закрытие брошенных счетов вместо ageing |
| Официальный ручной процесс | Не описан | **Если API нет** — как оформляется возврат вручную: через кабинет мерчанта, письмом, в какие сроки, кто подтверждает | Раздел в runbook для финансов; в коде — ничего |

### 1.7 Сроки

| Вопрос | Реализовано в TuTak сейчас | Что должен подтвердить Idram | Что изменится при другом ответе |
|---|---|---|---|
| Срок жизни счёта | Не знаем. Наши `PSP_STALE_AFTER_MS` (30 мин) и `PSP_ESCALATE_EVERY_MS` (1 ч) — **операционные умолчания TuTak**, не данные Idram | Через сколько выставленный счёт нельзя оплатить | `PSP_TIMEOUT_POLICY='{"idram":{"staleAfterMs":…}}'` в Railway — без изменения кода |
| Таймаут транзакции на стороне клиента | Не знаем | Сколько клиент может находиться на странице оплаты | То же |
| Окно повторов коллбэка | Не знаем | За какое время после оплаты Idram гарантированно доставит коллбэк (с учётом повторов) | То же; плюс порог, после которого «нет коллбэка» = обращаться в поддержку |
| Комиссия | `feeStatement = false`; комиссия записывается как **неизвестная**, не как ноль | Сообщается ли комиссия по транзакции в коллбэке или выписке; формат | Если в коллбэке — поле в `VerifiedConfirmation.feeAmount`; если в выписке — ручной ввод при сверке |
| Выписка / settlement feed | `settlementFeed = false`; ремитанс вводится оператором вручную | Есть ли машиночитаемая выписка (API/CSV), периодичность перечислений на счёт мерчанта | Если есть — импорт в acquirer settlement; иначе остаётся ручной ввод |

### 1.8 Sandbox

| Вопрос | Реализовано в TuTak сейчас | Что должен подтвердить Idram | Что изменится при другом ответе |
|---|---|---|---|
| Тестовая среда | `IDRAM_FORM_ACTION` без умолчания; при `TUTAK_PSP_ENABLED=true` обязателен `https://` адрес | URL формы оплаты sandbox, тестовый `EDP_REC_ACCOUNT` и тестовый секрет, тестовый кошелёк плательщика, ограничения по суммам | Только переменные окружения; см. план в разделе 3 |
| Регистрация callback URL | `POST https://<api-host>/v1/psp/idram/callback` | Где и как регистрируется URL коллбэка/pre-check у мерчанта; можно ли задать отдельный для sandbox | Ничего в коде |

---

## 2. Письмо в поддержку Idram

Заполнить: `<ИМЯ МЕРЧАНТА>`, `<ID МЕРЧАНТА>` (только идентификатор счёта,
не секрет), `<ХОСТ API>`. Ничего больше не добавлять.

### 2.1 Русская версия

Тема: Подтверждение параметров интеграции — мерчант <ИМЯ МЕРЧАНТА> (<ID МЕРЧАНТА>)

Здравствуйте.

Мы завершаем интеграцию оплаты через Idram и перед включением реальных
платежей просим подтвердить несколько параметров вашего API. Ответы
определяют нашу реализацию, поэтому просим отвечать по пунктам.

1. **Checksum (`EDP_CHECKSUM`).** Подтвердите, пожалуйста:
   а) точный порядок полей:
   `EDP_REC_ACCOUNT:EDP_AMOUNT:SECRET_KEY:EDP_BILL_NO:EDP_PAYER_ACCOUNT:EDP_TRANS_ID:EDP_TRANS_DATE`;
   б) разделитель — двоеточие без пробелов;
   в) кодировка строки перед MD5 (UTF-8?);
   г) представление MD5 — hex, регистр (верхний/нижний);
   д) точный формат `EDP_AMOUNT` в коллбэке (разделитель дробной части,
      число знаков, совпадает ли строка с отправленной нами в форме);
   е) точный формат и часовой пояс `EDP_TRANS_DATE`;
   ж) может ли `EDP_PAYER_ACCOUNT` быть пустым.
   Контрольный пример: для полей `110000110`, `14000.00`, `bill-contract-1`,
   `payer@example`, `IDRAM-TX-777`, `19/09/2026 12:34:56` и тестового ключа
   `contract-secret-key` мы получаем `CF9A9178674067320EE1E57003BE6278`.
   Просим посчитать checksum для этого же примера и прислать результат.

2. **`EDP_TRANS_ID`.** Уникален ли он глобально или в рамках мерчанта?
   Одинаков ли при повторных доставках одного и того же платежа? Может ли
   один `EDP_BILL_NO` быть оплачен дважды с разными `EDP_TRANS_ID`?

3. **Pre-check.** Приходит ли pre-check на тот же URL, что и финальный
   коллбэк, с `EDP_PRECHECK=YES`? Какие поля в нём обязательны, приходит ли
   `EDP_AMOUNT`? Какие ответы допустимы (мы отвечаем HTTP 200, `text/plain`,
   тело `OK` или `NO`)? Сколько вы ждёте ответа, повторяете ли pre-check, и
   что происходит, если ответа нет?

4. **Финальный коллбэк.** Достаточно ли ответа HTTP 200 с телом `OK`? Как
   вы повторяете коллбэк, если не получили `OK`: интервалы, число попыток,
   общее окно? Может ли коллбэк прийти через часы или дни после оплаты?
   Присылаете ли вы коллбэк при неуспешной или отменённой оплате, и если да
   — с какими полями и checksum? С каких IP-адресов приходят коллбэки?

5. **Запрос статуса.** Есть ли API для запроса статуса транзакции по
   `EDP_BILL_NO` или `EDP_TRANS_ID`? Если нет — просим подтвердить это явно.

6. **Возврат / отмена.** Есть ли API полного возврата, частичного возврата,
   отмены неоплаченного счёта? Если API нет — как оформляется возврат
   вручную и в какие сроки?

7. **Сроки и комиссия.** Срок жизни выставленного счёта; время, которое
   клиент может находиться на странице оплаты; окно доставки коллбэка;
   сообщается ли комиссия по транзакции (где и в каком формате); есть ли
   машиночитаемая выписка и с какой периодичностью перечисляются средства.

8. **Sandbox.** Просим предоставить: URL формы оплаты тестовой среды,
   тестовый идентификатор мерчанта и тестовый ключ, тестовый кошелёк
   плательщика, ограничения по суммам; а также указать, где регистрируется
   URL коллбэка. Наш URL коллбэка и pre-check:
   `https://<ХОСТ API>/v1/psp/idram/callback`.

Спасибо. Будем признательны за ответ по каждому пункту, включая
подтверждения вида «да, именно так» — они нам так же важны, как и
исправления.

С уважением,
<ИМЯ МЕРЧАНТА>

### 2.2 English version

Subject: Integration parameters to confirm — merchant <MERCHANT NAME> (<MERCHANT ID>)

Hello,

We are completing our Idram payment integration and, before enabling live
payments, would like to confirm a few parameters of your API. The answers
determine our implementation, so a point-by-point reply would help us most.

1. **Checksum (`EDP_CHECKSUM`).** Please confirm:
   a) the exact field order:
   `EDP_REC_ACCOUNT:EDP_AMOUNT:SECRET_KEY:EDP_BILL_NO:EDP_PAYER_ACCOUNT:EDP_TRANS_ID:EDP_TRANS_DATE`;
   b) the separator is a colon with no spaces;
   c) the string encoding before MD5 (UTF-8?);
   d) the MD5 representation — hex, and upper or lower case;
   e) the exact `EDP_AMOUNT` format in the callback (decimal separator,
      number of decimals, whether it is byte-identical to the amount we
      posted in the form);
   f) the exact format and time zone of `EDP_TRANS_DATE`;
   g) whether `EDP_PAYER_ACCOUNT` may be empty.
   Reference example: for the fields `110000110`, `14000.00`,
   `bill-contract-1`, `payer@example`, `IDRAM-TX-777`,
   `19/09/2026 12:34:56` and the test key `contract-secret-key`, we obtain
   `CF9A9178674067320EE1E57003BE6278`. Could you compute the checksum for
   the same example and send us the result?

2. **`EDP_TRANS_ID`.** Is it unique globally or per merchant? Is it
   identical across repeated deliveries of the same payment? Can one
   `EDP_BILL_NO` be paid twice with different `EDP_TRANS_ID` values?

3. **Pre-check.** Is the pre-check sent to the same URL as the final
   callback, with `EDP_PRECHECK=YES`? Which fields are mandatory, and is
   `EDP_AMOUNT` included? Which responses are accepted (we reply HTTP 200,
   `text/plain`, body `OK` or `NO`)? How long do you wait for a reply, do you
   retry the pre-check, and what happens if there is no reply?

4. **Final callback.** Is HTTP 200 with body `OK` sufficient? How do you
   retry when you do not receive `OK`: intervals, number of attempts, total
   window? Can a callback arrive hours or days after the payment? Do you
   send a callback for a failed or cancelled payment, and if so, with which
   fields and checksum? From which IP addresses are callbacks sent?

5. **Status query.** Is there an API to query a transaction's status by
   `EDP_BILL_NO` or `EDP_TRANS_ID`? If not, please confirm that explicitly.

6. **Refund / reversal.** Is there an API for a full refund, a partial
   refund, or voiding an unpaid bill? If not, what is the manual refund
   procedure and its timeline?

7. **Timing and fees.** Lifetime of an issued bill; how long a customer may
   stay on the payment page; the callback delivery window; whether the
   per-transaction fee is reported (where and in which format); whether a
   machine-readable statement exists and how often funds are settled.

8. **Sandbox.** Please provide: the sandbox payment-form URL, a test merchant
   ID and test key, a test payer wallet, any amount limits; and where the
   callback URL is registered. Our callback and pre-check URL is
   `https://<API HOST>/v1/psp/idram/callback`.

Thank you. Explicit confirmations ("yes, exactly so") are as valuable to us
as corrections.

Kind regards,
<MERCHANT NAME>

---

## 3. План активации sandbox (когда Idram ответит)

Общие правила плана:

- `TUTAK_PSP_ENABLED=true` ставится **только** в отдельной, не production
  среде (Render staging по `render.yaml` или отдельный Railway environment),
  с sandbox-кредами Idram. Production не трогается до конца плана.
- Любое финансовое несоответствие на любом шаге — **STOP**: платежи
  прекращаются, среда выключается (`TUTAK_PSP_ENABLED` удаляется), причина
  разбирается до следующего платежа.
- Каждый шаг фиксируется: скриншот + строки БД + строка лога. Без
  доказательства шаг не считается пройденным.

| # | Шаг | Ожидаемый результат | Доказательство | Критерий STOP |
|---|---|---|---|---|
| 1 | Сверить ответы Idram с `IdramAdapter` по таблице раздела 1, построчно | На каждую строку — «совпадает» или конкретная правка | Заполненная колонка «ответ Idram» в этом документе | Ответа нет или он противоречит сам себе |
| 2 | Исправить `contract.spec` под подтверждённый порядок/формат; пересчитать `OFFICIAL_CHECKSUM` и **сравнить с тем, что прислал Idram** для контрольного вектора | Unit-тест зелёный, дайджест совпадает с дайджестом Idram | Вывод `pnpm --filter @tutak/api test:unit -- idram.contract` + письмо Idram с дайджестом | Дайджест Idram не совпадает с нашим после правки |
| 3 | Получить sandbox-креды: `IDRAM_MERCHANT_ID`, `IDRAM_SECRET_KEY`, URL формы, тестовый кошелёк | Креды в secret store staging-среды; секрет нигде не логируется | Список имён переменных (без значений) в staging | Креды пришли открытым текстом в переписке с людьми, не имеющими доступа — сменить перед использованием |
| 4 | `IDRAM_FORM_ACTION` = sandbox URL (https), явно | Boot проходит; `assertReady` не жалуется | Лог старта без ошибок; `GET /health/ready` = ok | Адрес не https или production-адрес |
| 5 | Observability: `ALERT_WEBHOOK_URL` задан; `pnpm --filter @tutak/api alert:verify` → «accepted»; тестовое сообщение **увидел человек**; `SENTRY_DSN` задан, `sentry:verify` пройден | Оба verify зелёные, сообщение в канале | Скриншот сообщения в канале + вывод обоих скриптов | Скрипт говорит «not delivered» или человек ничего не увидел |
| 6 | `TUTAK_PSP_ENABLED=true` только в staging; `PSP_REFUNDS_ENABLED` и `CUSTOMER_PREPAID_TOPUP_ENABLED` отсутствуют | Boot проходит (все guard'ы: креды, https, webhook) | Лог старта; список переменных production по-прежнему без флагов | Флаг случайно появился в production |
| 7 | Один партнёр (тестовый) с активным contribution-rule, одобренным вторым человеком | Правило `ACTIVE`, `liveRule(partnerId)` не null | Строка `partner_contribution_rules` | Правило не одобрено или одобрено тем же, кто предложил |
| 8 | Один кассир с `PURCHASE_INTENT_CONFIRM`, привязанный к партнёру | Кассир видит покупки партнёра в Partner-кабинете | Скриншот | — |
| 9 | Один тестовый клиент (телефон, прошедший OTP) с тестовым кошельком Idram | Клиент залогинен в приложении | Скриншот | — |
| 10 | Минимальная сумма: наименьшая, которую допускает sandbox Idram (уточнить в п. 8 письма), например 100 AMD | Покупка создана с `paymentRoute=TUTAK_PSP` | Строка `purchase_intents` | Сумма выше минимальной |
| 11 | Реальный `FORM_POST` на Android: кассир согласовал (`approve-for-payment`), клиент нажал «оплатить», `POST /v1/psp/purchases/:id/begin` вернул `FORM_POST`, WebView открыл форму Idram | Страница оплаты Idram открылась с правильной суммой и описанием | Скриншот WebView; строка `psp_payment_attempts` со `status=INITIATED` | Форма не открылась / сумма отличается / `begin` вернул ошибку |
| 12 | Pre-check | В inbox строка `PRECHECK` с `verified=true`, ответ `OK`; Idram перешёл к оплате | Строка `psp_callback_inbox` + лог | Ответ `NO` при правильном счёте, или pre-check не пришёл вовсе (см. п. 3 письма) |
| 13 | Финальный коллбэк | Строка inbox `verified=true`, `status` → `PROCESSED` воркером; checksum сошёлся с первого раза | Строка inbox; лог без «checksum mismatch» | «checksum mismatch» — STOP немедленно: порядок/формат неверны |
| 14 | Inbox → воркер | `processed=1`, `failed=0` за один проход; нет `DEAD` | Лог воркера; `SELECT count(*) FROM psp_callback_inbox WHERE status='DEAD'` = 0 | Любой `DEAD` или `attempts>1` без объяснения |
| 15 | Settlement | Попытка `SUCCEEDED`, покупка `CONFIRMED`, событие `psp.payment.captured` ровно одно | Строки `psp_payment_attempts`, `purchase_intents`; outbox | Покупка не `CONFIRMED` или событий ≠ 1 |
| 16 | Ledger | Проводки: дебет = кредит; `PARTNER_PAYABLE` партнёра увеличился на сумму по правилу; комиссия провайдера = **неизвестна**, не ноль; `tutak_ledger_imbalance_amd` = 0 | Выгрузка `GET /admin/accounting/ledger.csv` за день; `/metrics` | Дисбаланс ≠ 0 или сумма не совпадает с ожидаемой из правила |
| 17 | Cashback / referral | Клиент получил кешбэк по правилу; реферер (если есть) — свою долю; суммы совпадают с DIRECT-покупкой на ту же сумму у того же партнёра | Строки `bonus_ledger_entries`; сравнение с контрольной DIRECT-покупкой | Расхождение с DIRECT-эталоном |
| 18 | Повтор коллбэка: вручную отправить тот же коллбэк ещё раз (тем же телом) | `200 OK`, inbox: replay, `processed=0`, второго экономического эффекта нет | Счётчики проводок до/после равны | Любая новая проводка |
| 19 | Cancel / failure: новая покупка, клиент закрывает WebView не заплатив; отдельно — оплата с недостаточным балансом тестового кошелька | Коллбэка нет (или отрицательный, если Idram его присылает — п. 4 письма); попытка через `staleAfterMs` → `EXPIRED`; `psp.attempt-unresolved` **дошёл до человека**; покупка не `CONFIRMED`, проводок нет | Скриншот алерта в канале; строки БД | Покупка подтвердилась без коллбэка; алерт не пришёл |
| 20 | Reconciliation: зависшую попытку из шага 19 разрешают два разных человека (`propose` → `confirm`) по выписке Idram | Попытка `FAILED` с `resolutionBasis=MANUAL_RECONCILIATION`, клиент может платить снова; попытка одним человеком отвергнута | Строки БД + 403/409 на попытку одним человеком | Один человек смог закрыть оба шага |

После шага 20 — отдельное решение владельца о production: те же переменные
на production, **сначала один партнёр, один кассир, суммы в пределах
нескольких тысяч драм**, и только потом шире. Это решение не принимается
автоматически ни этим документом, ни кодом.

---

## 4. Что этот документ не делает

- Не подставляет наши 30 минут / 1 час как данные Idram — это умолчания
  TuTak до получения реальных значений (раздел 1.7).
- Не включает `TUTAK_PSP_ENABLED` нигде.
- Не изобретает ответы провайдера: везде, где ответа нет, стоит
  «не знаем» и вопрос.
