# TuTak: исправление пользовательских сценариев по проверенному аудиту — отчёт

Дата: 20.09.2026. Ветка `claude/ux-truth-20260920`.

## 1. Задание

Устранить подтверждённые проблемы U01–U12, из-за которых клиент, кассир или
владелец партнёра неправильно понимает состояние покупки, бонусов, возврата
или выплаты. Для каждой операции должно быть понятно: что произошло, насколько
актуальны данные, что с деньгами и бонусами, какое действие разрешено, как
восстановиться после ошибки без повторной финансовой операции.

Главный критерий: интерфейс больше не выдаёт неизвестность за нулевой баланс,
отсутствие заявки, разрешение платить или завершённый возврат.

Границы: без деплоя, без реальных платежей/возвратов/SMS, без изменения
production-переменных, ставок и ledger, без включения PSP и денежного кошелька.
Логотип, иконка и бренд не тронуты. Телефон по умолчанию +374.

## 2. База

* Аудит выполнен на `369eda196581591366fd90efd1ae7a2f20ae5190` (main).
* Проверка текущего состояния: main = `369eda1`; PR #60
  (`claude/final-integration-20260919`, `2eac071`) — не слит; PR #61
  (`claude/jako-design`, `235d9b5`) — не слит, стоит поверх `claude/dark-theme`;
  PR #62 (`claude/audit-fixes-20260920`, `b1a809f`) — не слит, идёт в main.
* Выбранная база: `claude/dark-theme` @ `4c4827e` (ветка PR #60 плюс тёмная
  тема). Причина: все экраны, которые правились, уже переписаны в PR #60;
  правка поверх main породила бы конфликты с #60. Иллюстрации Jako (PR #61)
  в базу не входят — финансовые исправления от них отделены, как требовало
  задание.
* Каждый пункт U01–U12 подтверждён чтением кода на `4c4827e` до правки
  (см. таблицу).
* Итоговый SHA ветки: `e496f65`. PR #63 в `claude/dark-theme`. Восемь
  коммитов: `0352bc4` (панель партнёра), `46d9a7f` (PSP-контракт и экран),
  `47a6a6d` (история и экран операции), `3d8fbe4` (кошелёк, суммы, партнёры),
  `ca4b47f` (телефон, демо-маршрут), `24037ce` (отчёт и скриншоты),
  `362b87f` и `e496f65` — две починки CI, см. раздел 5.

## 3. Таблица U01–U12

| № | Проблема | На `4c4827e` | Итог | Где |
|---|---|---|---|---|
| U01 | Ложные нули во взаиморасчётах | подтверждено: `position?.net ?? '0'`, payouts `?? []`, lifetime totals = сумма по пустым спискам | исправлено | `apps/partner/.../settlements/page.tsx`, `earnings/page.tsx`, `lib/queryState.ts`, `lib/components/DataStatus.tsx` |
| U02 | Недоступная очередь выглядит пустой | подтверждено: `intents ?? []` → EmptyState | исправлено | `purchase-intents/page.tsx` |
| U03 | Неизвестный PSP-статус = можно платить | подтверждено: `status?.state ?? NOT_STARTED`, любая ошибка begin → «кассир не согласовал» | исправлено (сервер + клиент) | `psp-payment.service.ts`, `shared-types/dto/purchase-intent.ts`, `ProviderPaymentScreen.tsx` |
| U04 | Неполная история | подтверждено: только первая страница; сортировка `createdAt` без tie-break | исправлено | `transactions.service.ts`, `TransactionHistoryScreen.tsx` |
| U05 | Бонусы скрывают статус; нет деталей | подтверждено: subtitle заменял статус на «−N бонусов»; экрана деталей нет | исправлено | `TransactionHistoryScreen.tsx`, новый `TransactionDetailScreen.tsx`, `TransactionDto.purchaseIntentId` |
| U06 | Ошибки разделов кошелька | подтверждено: `!ledger ? skeleton`, `lots ?? []`, `wallet?.x ?? 0`, инвалидация только `['wallet']` | исправлено | `WalletScreen.tsx`, `data/query/invalidateMoney.ts`, `PurchaseIntentStatusScreen.tsx`, `ProviderPaymentScreen.tsx` |
| U07 | Ввод бонусов: ноль вместо «недоступно», `Math.max` | подтверждено | исправлено | `CreatePurchaseIntentScreen.tsx`, `domain/money.ts` |
| U08 | Ошибки списка возвратов = «заявок нет» | подтверждено: `requests ?? []`, `purchases ?? []`, onError закрывал форму | исправлено | `refunds/page.tsx` |
| U09 | Семантика взаиморасчётов | подтверждено: `position` = только `unsettled()`, net=0 читалось как «закрыто» | исправлено (новый серверный `position`) | `partner-settlement.service.ts`, `.controller.ts`, `shared-types/dto/settlement.ts`, `settlements/page.tsx` |
| U10 | Сбой станций скрывает партнёров | подтверждено: `isError = partners.isError \|\| stations.isError` | исправлено | `PartnersScreen.tsx` |
| U11 | Локализация партнёрских действий | подтверждено частично: панель партнёра — только английский по решению 14.09.2026; но статусы выводились как `status.toLowerCase()` («outoforder», «partner_purchase»), виды проводок — сырые коды | исправлено в рамках решения об английском: читаемые названия, код рядом | `lib/labels.ts`, `transactions/page.tsx`, `earnings/page.tsx`, `ev-stations/page.tsx`, `locations/BranchFuelTools.tsx`, `settlements/page.tsx` |
| U12 | При неудачном отказе кассир теряет причину | подтверждено: `reject.onError` закрывал форму и чистил текст | исправлено | `purchase-intents/page.tsx` |

Дополнительно по разделу 6: вставка полного номера в поле телефона удваивала
префикс (`v.replace(/\D/g,'').slice(0,8)` оставлял «37491234») — исправлено на
пяти экранах авторизации (`domain/phone.ts`).

## 4. Что сделано

### Панель партнёра (U01, U02, U08, U09, U11, U12)

* `apps/partner/src/lib/queryState.ts` — `dataStateOf(query)`: `loading | error |
  stale | fresh`. Первичный сбой и неудачное фоновое обновление — разные
  состояния.
* `apps/partner/src/lib/apiError.ts` — `describeApiFailure`: `network`
  (ответа нет — исход неизвестен), `state` (сервер отказал: 400/404/409/410),
  `auth`, `server`.
* `apps/partner/src/lib/components/DataStatus.tsx` — `LoadingNotice`,
  `LoadError` (с «Try again»), `StaleNotice` («Connection problem. Showing X as
  of HH:MM:SS»).
* **Settlements** переписан: плитки «TuTak owes you in total» (ledger),
  «Not yet in a settlement» (net), «In settlements not yet paid», «Paid out so
  far», «Transfers under review» (если ≠ 0); до ответа — «—», не «0.00»;
  DRAFT подписан «Being prepared — not paid yet»; виды проводок — читаемые
  названия, технический код и reference рядом моноширинным.
* **Purchase requests**: состояния загрузки/ошибки/устаревания, «Refresh»;
  отказ при сетевой ошибке сохраняет причину и объясняет, что исход
  неизвестен и очередь перечитана; при ответе сервера «покупка изменилась» —
  объяснение и перечитанный список; ни в одном состоянии не предлагается
  создать новую покупку.
* **Returns**: заявки и завершённые продажи — независимые состояния; решение
  при потерянном ответе: сначала перечитать, ввод сохранить, ничего не
  переотправлять; статус решённой заявки — словами, не enum; поиск по коду
  кассы/id.
* **Earnings**: lifetime totals — только после ответа обоих источников; список
  выплат/сборов/активности — свои состояния.
* **Локализация (U11)**: `lib/labels.ts` — читаемые названия типов/статусов
  транзакций, статусов выплат, статусов коннекторов, ролей.

### API

* `GET /partner/settlements/:partnerId/position` теперь возвращает
  `UnsettledPositionDto`: `ledgerBalance` (кредитовый остаток счёта
  PARTNER_PAYABLE), `net` (вне расчётов), `inOpenSettlements`
  (DRAFT/READY/APPROVED/PAYMENT_PENDING/FAILED), `underReview`
  (REQUIRES_RECONCILIATION), `paidTotal` (PAID), `asOf`.
  Тождество: `ledgerBalance = net + inOpenSettlements + underReview`;
  `paidTotal` в сумму не входит (проводки PAID уже списаны со счёта). Двойного
  учёта нет: каждая проводка принадлежит ровно одному расчёту или ни одному
  (`partner-position.int-spec.ts`, 5 тестов, в т.ч. обязательный: долг 50 000,
  DRAFT 50 000 → `net` 0, `ledgerBalance` 50 000, `paidTotal` 0).
* `GET /psp/purchases/:id/status` (`CustomerPaymentStatusDto`) дополнен
  `purchaseStatus`, `canBeginPayment`, `reason` (`NOT_ROUTED | PROVIDER_DISABLED
  | PURCHASE_NOT_OPEN | NOTHING_TO_COLLECT | AWAITING_MERCHANT_APPROVAL |
  UNRESOLVED_ATTEMPT`). Считается теми же проверками, что и `beginAttempt`,
  в том же порядке; `beginAttempt` по-прежнему проверяет всё сам
  (`psp-can-begin.int-spec.ts`, 6 тестов — каждая причина сверена с реальным
  вызовом begin; два начала оплаты → одна попытка, второй отказ).
* `GET /transactions/me`: сортировка `[createdAt desc, id desc]` — курсор
  стабилен при одинаковых timestamps (`transaction-history-paging.int-spec.ts`:
  5 строк на одном timestamp → 3 страницы, без дублей и пропусков);
  `TransactionDto.purchaseIntentId` через `PurchaseIntent.sourceTransactionId`.
* Миграций нет: новых колонок/индексов не потребовалось.

### Мобильное приложение

* **ProviderPaymentScreen (U03)**: состояния «проверяем», «сервер недоступен»
  (с повтором, без кнопки оплаты), «данные устарели», «ждём кассира»,
  «ждём провайдера», «отказ провайдера», «неопределённый исход», «успех»,
  «покупка закрыта (истекла/отклонена/отменена)», «провайдер отключён»,
  «нечего платить». Кнопка «Оплатить» — только при `canBeginPayment`.
  Потерянный ответ на begin: перечитать статус; найденная попытка показывается
  как ожидание, новая не создаётся. Тексты `psp.*` на hy/ru/en.
* **TransactionHistoryScreen (U04/U05)**: `useInfiniteQuery` по курсору,
  «Показать более ранние операции», неудачная страница — сообщение под уже
  загруженными строками и повтор; статус показан всегда, бонус — третьей
  частью; нажатие открывает операцию.
* **TransactionDetailScreen (U05)**: партнёр из snapshot, дата, сумма,
  оплачено бонусами, оплачено деньгами (точное вычитание, BigInt 4 знака),
  начислено; по `purchaseIntentId` — маршрут (касса/провайдер), состояние
  покупки, код кассы, возвращено, список возвратов (сумма, причина,
  возвращённый бонус); для покупки и возвратов свои ошибки «не удалось
  загрузить», никогда не «возвратов нет». Явно: «это запись TuTak, не
  фискальный чек».
* **WalletScreen (U06)**: wallet / ledger / lots — независимые состояния;
  ошибка ledger завершает skeleton ошибкой; ошибка lots — предупреждение, не
  «ничего не сгорает»; lifetime — только из ответа; устаревание при неудачном
  обновлении. `invalidateMoney()` инвалидирует `wallet`, `wallet-ledger`,
  `wallet-lots`, `transactions` после покупки/отмены/оплаты.
* **CreatePurchaseIntentScreen (U07)**: «Проверяем, сколько у вас баллов…» /
  «Баланс недоступен» вместо 0; проверки: сумма > 0, бонус — число, бонус ≤
  сумма, бонус ≤ `maxBonusPaymentPercent` партнёра (округление вниз до 4 знака
  — строже сервера на ≤ 0,0001, сервер решает), бонус ≤ баланс; предпросмотр
  остатка точный (`domain/money.ts`, BigInt × 10⁴, без `Math.max`). Точность
  Decimal(18,4) сохранена; отправляются строки как введены.
* **PartnersScreen (U10)**: партнёры и станции судятся отдельно; при сбое
  одного источника список другого показан с предупреждением и повтором только
  этого источника.
* **Телефон (раздел 6)**: `domain/phone.ts` — вставка `+374 91 234567`,
  `374…`, `091…` даёт `91234567`; применено в Login/Register/OtpLogin/
  OtpRegister/ForgotPassword.
* Демо-адаптер отвечает на `GET /purchase-intents/:id/refunds`.

## 5. Что НЕ сделано

* **Скриншоты U03 (ProviderPaymentScreen) и U07 (валидация) не сняты.** Веб-
  сборка карты (`PartnersScreen`) перехватывает нажатия абсолютным слоем; пять
  подходов (force-click, dispatchEvent, CSS pointer-events) дали нестабильный
  результат, один кадр U07 (`mobile-create-balance-unknown.png`) снят. Состояния
  доказаны RNTL-тестами (20 в `ProviderPaymentScreen.test.tsx`, 11 в
  `CreatePurchaseIntentScreen.test.tsx`).
* **Кадр «кошелёк устарел» на мобильном не снят** — при повторной попытке
  снялся не тот экран, файл удалён; состояние доказано тестом.
* **Повторная выдача формы оплаты при потерянном ответе begin не реализована.**
  Если ответ на begin потерян, счёт у провайдера может существовать, а
  форма — нет; сервер отказывает во втором счёте (и это правильно). Экран
  говорит правду («если страница не открылась — не платите иначе, попытка
  закроется сама»). Безопасная повторная выдача той же формы требует
  бизнес-решения (см. вопрос 3).
* **U11 в трёх языках для панели партнёра не сделан**: панель по решению
  14.09.2026 англоязычная; сделаны читаемые английские тексты вместо сырых
  enum. Мобильные тексты — на hy/ru/en.
* **«Картинка с неправильным ноутбуком»** относится к `assets/jako/
  reset-password.webp` в PR #61 (`claude/jako-design`); в этой ветке
  иллюстраций нет. Заменить изображение я не могу; в PR #61 её следует
  исключить до замены (см. вопрос 4).
* **Face ID** заново не реализовывался: app lock с биометрией уже в базе
  (`fc904e4`, `appLock/`, `data/biometrics/`); ветка
  `feat/mobile-biometric-unlock` и коммит `1c2fc90` содержат отдельный перенос
  — не смешивал.
* **APK не собирался.** Production и физическое устройство не проверялись.
* **Ошибки по ходу работы** (переделывал): (1) первая версия тестов
  settlements сравнивала одну цифру, которая теперь встречается в двух плитках —
  переписал на `findAllByText`; (2) в тестах mobile использовал ` ` в
  регулярных выражениях — eslint `no-irregular-whitespace`, заменил на `\D?`;
  (3) экран ProviderPayment сначала лишил `t()` английских значений по
  умолчанию — тесты видели ключи, вернул defaults; (4) первый прогон
  скриншотов панели партнёра делал `page.goto` — токен в памяти терялся,
  перешёл на клиентскую навигацию; (5) стабы API без
  `Access-Control-Allow-Credentials` ломали логин панели; (6) моё имя шага
  «decline» нажимало «Confirm» соседней строки — исправлено; (7) в тесте
  `money` пример `4999.9999 − 0.0001` в float даёт ровно 4999.9998 — заменил
  на `0.3 − 0.1`. **После первого отчёта CI дважды упал по моей вине:**
  (8) не перегенерировал `demo/` после мобильных правок — шаг «The demo app
  matches the app it was generated from» красный; исправлено `362b87f`
  (`scripts/build-demo-app.sh`, 23 файла и три новые папки). Локально я этот
  шаг не прогонял, только jest и линтеры — именно поэтому он и всплыл в CI;
  (9) мой же тест постраничной истории на раннере не уложился в
  стандартную односекундную паузу RNTL: третья страница отрисовалась позже,
  хотя третий запрос уже ушёл. Поведение верное, бюджет — нет; дал 5 секунд
  (`e496f65`), локально три прогона подряд зелёные. Оба случая — мои
  недопроверки перед push, а не чужие сбои.

## 6. Чем доказано

Локально, на изолированной PostgreSQL 16 (`tutak_test`, поднята truncate-ом
перед каждым тестом) и Redis:

| Проверка | Результат |
|---|---|
| API integration, весь проект (`jest --selectProjects integration`) | 116 suites, 1505 tests — все прошли (включая новые 3 spec) |
| `psp-can-begin.int-spec.ts` | 6/6 |
| `partner-position.int-spec.ts` | 5/5 |
| `transaction-history-paging.int-spec.ts` | 3/3 |
| `transaction-disclosure.int-spec.ts` | 5/5 (список полей дополнен `purchaseIntentId`) |
| API `tsc` (build + spec), eslint по изменённым модулям | чисто |
| Mobile jest (весь) | 75 suites, 659 tests |
| Mobile `tsc`, eslint `src` | чисто |
| Partner jest (весь) | 13 suites, 119 tests |
| Partner `tsc`, eslint `src` | чисто |
| Admin jest (весь) | 16 suites, 112 tests |
| CI на итоговом `e496f65` (runs 914 push и 915 pull_request) | 10 check-run'ов зелёные: lint/test/build, три шарда integration, сборка образов |
| shared-types `tsc` | чисто |

Раздел 4 (защиты): реализация, миграции и тесты проверены чтением и прогоном
существующих int-spec на PostgreSQL — механизмы есть, не отсутствуют:

* два начала оплаты — `psp-can-begin` («refuses a second begin while the first
  attempt is live»), `hasUnsafeAttempt` + `@@unique([purchaseIntentId, liveKey])`;
* повторный callback — `psp-callback-inbox` («settles once when 50 duplicates
  are drained»), `psp-adversarial-callbacks` («treats a second transaction id on
  an already-settled bill as a replay»), уникальность `(provider,
  providerTransactionId)`;
* потеря ответа после commit — `psp-callback-inbox` («costs a repeat and not a
  double when the worker dies after the ledger commit»), `refund-psp-confirmation`
  («recovers from a local failure after the PSP already confirmed»);
* поздний callback — `purchase-psp-lifecycle` («a callback after the attempt
  timed out … confirms it once», «holds a late callback whose amount disagrees»);
* подтверждение кассира против PSP — `assertDirectCollectionAllowed`,
  `purchase-psp-lifecycle` («refuses a cashier rejection while the payment is
  unresolved», «will not approve a direct purchase for payment»);
* подтверждение против отмены — `purchase-intents` («lets a cancel and a confirm
  race without double-processing», «lets a confirm and a reject race…»);
* два решения по возврату — `refund-decision-races` («a rejection that started
  before an approval cannot overwrite it», «one request can never become two
  refunds, whoever approves it»);
* несколько частичных возвратов — `purchase-intent-refund` («lets multiple
  partial refunds accumulate to the full amount, and refuses more»,
  «two concurrent refunds with different keys never take more than the purchase»);
* возврат после settlement — `purchase-intent-refund` («a refund after the
  partner accrual was claimed by a settlement still leaves the ledger balanced»),
  `partner-position` («a refund after payout makes the total negative»),
  `partner-reconstruction` («reconstructs after a refund that follows the payout»).

Скриншоты (`docs/screenshots/ux-truth/`, 30 кадров): панель партнёра — 18
(settlements: draft ≠ paid, itemisation, loading dashes, position error,
statements error, stale; queue: ok, error, stale, reject network kept, reject
state explained; refunds: ok, requests error / sales ok, sales error, decision
network kept; earnings: payouts loading / error); мобильное — 12 (wallet ok /
error / ledger+lots error; history page 1 / page 2 / end / page 2 failed kept;
detail ok / purchase+refunds error; partners: stations failed / partners
failed; create: balance unknown).

Что использовало mocks, реальную БД, устройство:

* реальная PostgreSQL + Redis: все `*.int-spec.ts`;
* mocks: jest/RNTL-тесты экранов (API замокан), Playwright-скриншоты
  (панель Next dev и web-экспорт Expo против полностью застабленного API
  через `page.route`);
* устройство: не использовалось.

## 7. UNVERIFIED

* Production (Railway) и физическое устройство — не проверялись.
* Нативные модули (клавиатура, safe areas, крупный шрифт, Face ID) — только
  чтение кода; на web-экспорте не воспроизводятся.
* Поведение при просроченной сессии и смене аккаунта: сброс кэша при смене
  `sessionEpoch` есть в коде (`queryClient.ts`, партнёр `registerSessionCacheReset`)
  и покрыт существующими тестами; сквозной прогон вручную не делался.
* API unit-suite целиком локально не гонял (>500 с) — CI ветки.
* Скриншоты U03/U07 (см. раздел 5).
* Локализованные строки hy/ru на длину в реальных экранах — проверены только
  в jest-рендере (en); визуально hy/ru не снимались.

## 8. Вопросы владельцу

1. **DIRECT-возврат: что означает Approved.** Сейчас `approve()` сразу
   выполняет `RefundEngine.refund`: уменьшает обязательство перед партнёром,
   возвращает бонусы клиенту, пишет `PurchaseIntentRefund`. То есть «Approved»
   = проводки в ledger сделаны. Это не доказательство, что кассир выдал
   клиенту наличные. Выбор: (a) оставить как есть и назвать статус в панели
   «Refund recorded» (сделано в этой ветке: «Approved — refund recorded»);
   (b) ввести отдельное подтверждение выдачи (второй шаг кассира «cash handed
   over»), после которого клиент видит «деньги возвращены»; (c) считать
   выдачу наличных внешним фактом и не отражать её. Я не придумывал правило —
   нужен ваш выбор.
2. **Панель партнёра: оставить только английский** (решение 14.09.2026) или
   добавить hy/ru? Инфраструктуры i18n в панели нет; это отдельная задача.
3. **Потерянный ответ на begin (PSP):** разрешить серверу повторно выдать ту
   же форму для INITIATED-попытки, по которой провайдер ещё не прислал ни
   pre-check, ни final? Это новое правило денежного контура; без вашего
   решения оставлено честное сообщение об ожидании.
4. **Иллюстрация reset-password (PR #61):** исключить `reset-password.webp` до
   замены изображения ноутбука?

## 9. Остаточные риски и действия

* PR этой ветки идёт в `claude/dark-theme` (стек: main ← #60 ← dark-theme ←
  эта ветка). Слияние в main возможно только после #60; порядок: #60 → dark-
  theme → эта ветка (или ребейз при изменении плана).
* Владелец: решить вопросы 1–4; проверить APK/устройство перед релизом; PR #60
  по-прежнему не сливать до закрытия гейтов.
