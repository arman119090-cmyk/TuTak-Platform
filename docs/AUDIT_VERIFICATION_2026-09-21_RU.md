# Проверка внешнего аудита 21.09.2026 и закрытие подтверждённых проблем (D01–D18)

Дата: 21 сентября 2026. Ветка `claude/audit-verification-20260921`.
База: `aec987b417de9cded5449486963624146b452d6c` (голова `claude/hybrid-payments-20260920`, PR #64).
PR: #65 (`claude/audit-verification-20260921` → `claude/hybrid-payments-20260920`). Последний коммит с кодом — `fbaf56a`.

---

## 1. Задание

Архив `TuTak_For_Claude.zip` (внешний аудит от 21.09.2026: `Audit/01_FULL_AUDIT_RU.md`,
`02_ACCEPTANCE_AND_TEST_MATRIX_RU.md`, `03_EVIDENCE_INDEX.md`, `04_FINANCIAL_ARCHITECTURE_PROPOSALS_RU.md`,
`evidence/`, `screenshots/`) и файл задания `CLAUDE_TASK_PROPOSALS_RU.md`:
«Проверить аудит TuTak и закрыть подтверждённые проблемы».

Требования задания (пересказ, близкий к тексту):

- прочитать весь аудит и доказательства; самостоятельно проверить D01–D18 на текущем коде
  и воспроизвести на реальном PostgreSQL; по каждому D-ID дать вердикт
  confirmed / disproved / already fixed / needs evidence с SHA, root cause и repro;
- исправлять в отдельной ветке с сохранением истории (без force push и destructive checkout);
- приоритеты: 1 — financial allocation (D01–D04); 2 — refund arithmetic и commit boundaries
  (D09, D10, D11, D18); 3 — auth/локальная защита и POS scope (D07/D08, D17);
  4 — правдивый UX (D06/D14, D12, D13/D15, D16); §8 — эксплуатация и доказательства релиза;
  §9 — бизнес-вопросы, которые нельзя решать молча; §10 — тесты, ломающие систему до исправления;
  §11 — состав итогового отчёта;
- «Не меняй production, не запускай реальные оплаты/refunds/банковские переводы/SMS,
  не merge/deploy без отдельного поручения Армана. Файл не является разрешением включить
  stored value/PSP/POS или принять юридические решения»;
- «Логотип TuTak не менять. Биометрия добровольная. В армянском телефонном сценарии сохранить +374.
  Не переписывать работающую Viva без воспроизведённой проблемы. Не заменять финансовую работу
  перерисовкой Жако/ноутбука»;
- предложения аудитора — предложения, а не истина; исходный REPRO не называть production-инцидентом;
  не писать, что деньги потеряны/возвращены, если подтверждён только контролируемый тест.

Действующие ограничения из предыдущих заданий сохранены: `TUTAK_PSP_ENABLED`, PSP refunds,
prepaid top-up, live EV не включались; Idram-платежи не проводились; production DB и переменные
не трогались; секреты не публиковались; PR #60 не merge-ится до закрытия gates.

---

## 2. База, ветка, коммиты

| Что | Значение |
| --- | --- |
| Production (`main`, задеплоено на Railway: api, admin, partner) | `369eda1` |
| База работы | `aec987b` = голова `claude/hybrid-payments-20260920` (PR #64, CI зелёный) |
| Почему не `main` | 13 из 18 находок аудита относятся к коду гибридной модели (#64): PSP capture, POS checkout, prepaid refund split, funding breakdown, app lock. На `main` этого кода нет. D02, D03, D05, D13, D16 присутствуют и на `main`; их исправление доедет до production вместе с #64 |
| Ветка | `claude/audit-verification-20260921` (от `aec987b`, история линейная, без force push) |
| Коммиты | `657a5ef` API: D01–D04, D09, D12 · `df07dd0` API: D10, D11, D17, D18 · `fcf1e48` API: D05, D06 · `c268804` mobile/admin: D06–D08, D13–D16 · `fbaf56a` demo + alert specs |
| Итоговый SHA | голова PR #65 (`https://github.com/arman119090-cmyk/TuTak-Platform/pull/65`); последний коммит с кодом — `fbaf56a`, далее только `docs/` |
| Объём | 54 файла вне `demo/`, +2567 / −335 строк; 1 миграция |

Ancestry: `aec987b` — предок HEAD; `origin/main 369eda1` — предок `aec987b`.

---

## 3. Вердикты D01–D18

Легенда: **CONFIRMED** — воспроизведено мной на текущем коде (PostgreSQL для API, jest для клиентов);
**FIXED** — исправлено в этой ветке и закрыто тестом, который был красным до исправления.

| ID | Заявление аудитора | Вердикт | Root cause (source) | Доказательство (tests) |
| --- | --- | --- | --- | --- |
| D01 | `psp.payment.captured` не входит в settlement | CONFIRMED → FIXED | Writer пишет `psp.payment.captured`, allowlist содержал только `payment.captured`; `unrecognisedKinds` не ловил, т.к. kind попадал в «неизвестные» без ошибки | `audit-2109-allocation` D01 (красный до fix); `settleable-kinds.spec` статически сверяет все writers на PARTNER_PAYABLE с классификатором |
| D02 | Legacy payout и settlement выделяют одно обязательство независимо | CONFIRMED → FIXED (обе последовательности) | `payout.requested` был TRANSFER и исключался из `unsettled()`, а `requestPayout` не знал об открытых settlement | `audit-2109-allocation` D02a/b/c (payout→draft, draft→payout, отклонение с текстом «claimed by an open settlement») |
| D03 | Collection не закрывает debt residual | CONFIRMED → FIXED | `partner.collection.*` исключались как transfer; residual оставался unsettled | `audit-2109-allocation` D03, D03b |
| D04 | Position смешивает snapshots | CONFIRMED (source), race не воспроизведена → FIXED | `Promise.all` из трёх независимых чтений | `position()` теперь в одной `$transaction(RepeatableRead)`; `audit-2109-allocation` D04/D04b (identity ledger = unsettled + open + paid держится) |
| D05 | Failed alert send подавляет retry на 900 с | CONFIRMED → FIXED | `SET NX EX` до `send`, `delivered:false` не снимал ключ | `alerts.service.spec` 5 тестов, первый — сценарий аудитора (1 send, 2-й fire подавлен) красный до fix |
| D06 | EXPIRED PSP = WAITING_PROVIDER | CONFIRMED → FIXED | EXPIRED без очереди callback не имел своего состояния | `audit-2109-psp-unresolved` 2 теста; mobile `ProviderPaymentScreen.test` «UNRESOLVED» |
| D07 | Ошибка чтения PIN → setup + новый PIN | CONFIRMED → FIXED | `getItem` сворачивал OS-ошибку в `null`; `hydrate` читал `null` как «кода нет» | `appLockStore.test` «keystore read error at cold start…» (setup/createPin true до fix → locked/false после); `LockScreen.test` без клавиатуры и без биометрии |
| D08 | Счётчик попыток в памяти, restart возвращает 5 | CONFIRMED → FIXED | `checkPin` уменьшал счётчик в state, запись на диск после и без проверки | `appLockStore.test` «wrong code is counted on disk before it is judged» и «attempt whose count cannot be written is refused» |
| D09 | Partial refund даёт external −0.0001 | CONFIRMED → FIXED | Два cumulative-компонента округлялись независимо, external — остаток дельты | `refund-split.spec` 5 property-тестов (кейс аудитора 3/1/2 и 1+1+1; 1/2/3/99/100/301 AMD; LCG 400 случайных) |
| D10 | Link failure после commit → чек снова OPEN | CONFIRMED → FIXED | Три шага без общей транзакции; общий catch возвращал OPEN | `partner-checkout.int-spec` D10 ×2 (fault injection на bind; второй покупатель получает 409) |
| D11 | Idempotency fingerprint неполный | CONFIRMED → FIXED | Проверялся только `externalReference` | `partner-checkout.int-spec` D11 ×2 (другая ветка → 409; тот же запрос → тот же чек) |
| D12 | PSP remainder попадает в «деньги в кассе» | CONFIRMED → FIXED | `fundingBreakdown` без фильтра по `paymentRoute` | `audit-2109-allocation` (breakdown по маршруту); партнёрская страница — новая плитка «Collected by the payment provider» |
| D13 | Admin показывает unknown как 0/empty | CONFIRMED → FIXED | `data ?? []` и числовые defaults без `isError` | `LoadFailed` на overview, reconciliation, users, partners, audit-logs, fraud-signals, roaming-cpo-stations; admin jest 112/112 |
| D14 | 5xx при PSP begin = «отказ» | CONFIRMED → FIXED | Любой HTTP-статус трактовался как refusal; refetch не ожидался | `ProviderPaymentScreen.test` 502 → unknown; 503/504 → unknown; 409 остаётся отказом |
| D15 | Старые purchase/refund данные выглядят свежими | CONFIRMED → FIXED | Секции предпочитали cache без пометки | `TransactionDetailScreen.test` «marks kept purchase and refund data as stale…»; очистка cache при смене аккаунта уже была (`queryClient.ts`, подписка на `sessionEpoch`) |
| D16 | Cached геолокация без maxAge/accuracy | CONFIRMED → FIXED | `getLastKnownPositionAsync()` без параметров, cache → `isFallback=false` навсегда | `useApproximateLocation.test`: maxAge 300 000 / accuracy 500; stale при timeout; `refresh()` даёт новый fix; recentre на карте — кнопка |
| D17 | POS key не ограничен integration | CONFIRMED → FIXED | `verify` возвращал только partnerId/apiKeyId; confirm не проверял integration | `partner-checkout.int-spec` D17 ×3 (ключ другой integration → 403; выключенная integration → 403 на следующем запросе; branch scope) |
| D18 | Audit error после commit компенсирует purchase | CONFIRMED → FIXED | `auditService.record` вне транзакции, catch компенсировал hold и помечал source FAILED | `audit-2109-purchase-atomicity` 2 теста (spy бросает на PURCHASE_INTENT_CREATED: intent не создаётся, hold не «висит»; без ошибки — всё в одной транзакции) |

Ни одна находка не опровергнута. Ни одна не была «уже исправлена». Все 18 подтверждены на коде
`aec987b`; из них 7 тестов allocation были красными до исправления на настоящем PostgreSQL.

### Где рекомендация аудитора заменена другим решением и почему

- **D02/D03 — не «единый allocation engine», а три класса проводок.** Аудитор предлагал
  единый engine или facade. Сделано проще и без миграции истории: проводки PARTNER_PAYABLE
  делятся на SETTLEABLE (экономика, включая `psp.payment.captured`), ALLOCATION
  (`payout.requested/failed`, `partner.collection.recorded/confirmed` — забираются следующим
  settlement независимо от периода) и SETTLED (`partner.settlement.paid`, `payout.settled` — никогда).
  Legacy `requestPayout` дополнительно вычитает `netPayable` открытых settlement под `FOR UPDATE`.
  Так residual гасится ровно один раз (D03), а payout и settlement не претендуют на одну сумму (D02)
  без нового движка. `settleable-kinds.spec` сканирует исходники и ломается, если появится writer
  на PARTNER_PAYABLE с неклассифицированным kind (контрактный тест, о котором просил аудитор).
- **D09 — не `max(0, external)`, а монотонный cumulative allocator v2 с версией политики.**
  Bonus считается от cumulative watermark (как раньше), prepaid — от cumulative остатка,
  external — остаток. Введён `REFUND_ROUNDING_POLICY_VERSION = 2`, столбец
  `PurchaseIntentRefund.roundingPolicyVersion` (миграция `20260921100000_refund_rounding_policy_version`
  ставит существующим строкам 1); смешение версий на одной покупке с prepaid > 0 → 409, а не тихая
  арифметика. Conservation (Σ = t), неотрицательность и монотонность доказаны property-тестами.
- **D10 — не saga, а одна транзакция.** `createWithConfirmationCode` принимает hooks
  `{fund, afterInsert}`; binding checkout ↔ intent и audit-строка (D18) выполняются внутри той же
  `$transaction`. Recoverable saga не нужна, когда всё умещается в одну транзакцию.
- **D11 — fingerprint по семантическим полям, без отдельного hash-столбца.** Сравниваются
  `externalReference, grossAmount, partnerBranchId, quantity, quantityUnit, unitPrice, occurredAt`
  (и funding на replay claim). Unique key по (integration, externalReference) уже был; hash-столбец
  добавлял бы миграцию ради того, что даёт сравнение полей.
- **D05 — не durable outbox, а bounded backoff внутри существующего dedupe.** Неудачная
  отправка с `retryable: true` укорачивает ключ до min(60·2^(n−1), 900) с; доставка сбрасывает
  серию; недоставляемый по замыслу канал (console) держит полное окно, чтобы не устроить шторм
  в dev. Outbox для alert — отдельная работа, см. UNVERIFIED.
- **D07 — recovery только через полный sign-in.** Экран «хранилище недоступно» предлагает
  повторить чтение или «Войти заново» — это существующий путь `forgot`: server logout +
  локальная очистка + SMS-вход, т.е. свежая серверная аутентификация, как просил аудитор.

---

## 4. Что сделано (файлы)

**API (`apps/api`)**
- `src/modules/partner-settlements/settleable-kinds.ts` — три класса проводок; `settleable-kinds.spec.ts` (новый).
- `src/modules/partner-settlements/partner-settlement.service.ts` — `unsettled()` (SETTLEABLE до periodEnd + ALLOCATION всегда), `position()` в RepeatableRead, `fundingBreakdown(partnerId, tx)` с разбивкой по `paymentRoute`, поле `receivedViaProvider`.
- `src/modules/payouts/payout-engine.service.ts` — резерв открытых settlement в `availableBalance` и в `requestPayout` под блокировкой.
- `src/modules/reconciliation/reconciliation.service.ts` — проверка E на CLAIMABLE/SETTLED.
- `src/modules/purchase-intents/purchase-intent-refund.service.ts` — `splitRefundAcrossComponents` v2, версия политики, 409 при смешении; `refund-split.spec.ts` (новый).
- `prisma/schema.prisma` + `prisma/migrations/20260921100000_refund_rounding_policy_version/migration.sql`.
- `src/modules/purchase-intents/purchase-intents.service.ts` — `CreatePurchaseIntentOptions.bind`, audit-строка внутри транзакции.
- `src/modules/partner-checkout/partner-checkout.service.ts` — `posScope`, `checkoutForKey`, `assertSameRequest`, `assertSameFunding`, `bindCheckoutToPurchase`.
- `src/modules/roaming-cpo/partner-api-key.service.ts`, `src/modules/partner-checkout/partner-api-key.guard.ts` — `integrationId` в identity.
- `src/infrastructure/alerts/*` — `retryable` в `AlertDelivery`, `settleWindow` в `AlertsService`; `alerts.service.spec.ts` (новый); два существующих spec обновлены под `retryable`.
- `src/modules/psp/psp-payment.service.ts` — состояние `UNRESOLVED`.
- Тесты: `test/audit-2109-allocation.int-spec.ts`, `test/audit-2109-purchase-atomicity.int-spec.ts`, `test/audit-2109-psp-unresolved.int-spec.ts` (новые), `test/partner-checkout.int-spec.ts` (+7).

**Shared types / partner panel**
- `packages/shared-types/src/dto/settlement.ts` (`receivedViaProvider`), `src/enums/purchase-intent.ts` (`UNRESOLVED`).
- `apps/partner/src/app/(dashboard)/settlements/page.tsx` — плитка «Collected by the payment provider».

**Admin (`apps/admin`)**
- `src/components/LoadFailed.tsx` (новый); ошибка запроса на 7 страницах вместо пустого состояния/нулей.

**Mobile (`apps/mobile`)**
- `src/data/storage/secureStorage.ts`, `.web.ts` — `readItem` → value | absent | unavailable.
- `src/data/stores/appLockStore.ts` — `storage: ok | unavailable | invalid`, fail-closed hydrate, счётчик на диск до вердикта.
- `src/presentation/screens/appLock/LockScreen.tsx` — ветка «хранилище недоступно», биометрия не вызывается без `storage: ok`.
- `src/presentation/screens/purchase-intent/ProviderPaymentScreen.tsx` — 5xx/408/429 → unknown после refetch; UNRESOLVED.
- `src/presentation/screens/transactions/TransactionDetailScreen.tsx` — `StaleNotice` с временем и retry.
- `src/presentation/screens/partners/useApproximateLocation.ts`, `PartnersScreen.tsx` — source/fixedAt/isStale/refresh; recentre — кнопка.
- `packages/i18n/src/locales/{en,ru,hy}.json` — 563 ключа в каждом, паритет проверен.
- `demo/` перегенерирован скриптом `scripts/build-demo-app.sh` (CI-проверка «demo matches»).

---

## 5. Чем доказано

Локальные PostgreSQL 16 + Redis, отдельная БД `tutak_test`; shadow-БД для drift — отдельная `tutak_shadow`.

| Проверка | Результат |
| --- | --- |
| API `pnpm typecheck` (build + spec) | 0 ошибок |
| API eslint | 0 ошибок (после правки `require-await` в новом spec) |
| API unit (`--selectProjects unit`) | 58 suites, 747/747 |
| API integration, полный прогон (`--selectProjects integration`, serial, локальный PostgreSQL 16) | 125 suites, 1594/1594 |
| `audit-2109-allocation` до исправления / после | 7 из 8 красных / 8 из 8 зелёных |
| `audit-2109-purchase-atomicity` | 2/2 |
| `audit-2109-psp-unresolved` | 2/2 |
| `partner-checkout.int-spec` | 22/22 (из них 7 новых) |
| Настроечные suites после D01–D04 (settlement, payout, collection, reconciliation, hybrid, position, acquirer, roaming, ev-cdr) | 14 suites, 206/206 |
| PSP + alerting suites после D05/D06 | 153/153 |
| `prisma migrate diff --from-migrations --to-schema-datamodel` (shadow `tutak_shadow`) | No difference detected |
| Mobile `tsc` / eslint / jest | 0 / 0 / 75 suites, 681/681 |
| Admin `tsc` / eslint / jest + node:test | 0 / 0 / 16 suites 112/112 + 4/4 |
| Partner `tsc` / eslint / jest | 0 / 0 / 13 suites, 121/121 |
| shared-types `tsc`, i18n `tsc`, паритет ключей en/ru/hy | 0 / 0 / 563 = 563 = 563 |
| demo parity (`scripts/build-demo-app.sh`, затем `git diff --quiet -- demo`) | перегенерирован и закоммичен; diff пуст |

### 5.1 Полный integration-прогон

125 suites, 1594 теста, 0 падений, на коде `fbaf56a` (последний коммит с кодом; далее только `docs/`).
Для сравнения: на базе `aec987b` было 1494 + новые в этой ветке (allocation 8, atomicity 2, psp-unresolved 2, checkout +7) и
существующие suites, затронутые классификацией проводок, — все зелёные без правок ожиданий, кроме двух alert-spec
(точная форма `AlertDelivery` дополнена полем `retryable`).

---

## 6. Что НЕ сделано

### 6.1 Не дошли руки / вне этой ветки
- **Alert outbox (D05, полное решение аудитора).** Сделан bounded retry внутри dedupe; durable outbox
  с in-flight/delivered состояниями не построен. Контрольная доставка человеку — operator test,
  требует `ALERT_TELEGRAM_CHAT_ID`/webhook у владельца (по-прежнему не заданы, см. gates watch).
- **D04 как SQL-гонка.** Snapshot-фикс сделан, identity доказана последовательно; параллельная гонка
  двух транзакций против `position()` не воспроизводилась (аудитор тоже её не воспроизводил).
- **D14 «resume прежнего bill».** Клиент показывает «неизвестно» и ждёт статус; повторный begin
  запрещён сервером (`canBeginPayment=false` при живой попытке). Явного «продолжить старый bill»
  в UI нет — провайдер (Idram) не даёт такого API до подписания договора.
- **D13 «last-success timestamp» и «forbidden отдельно от error».** Сделан один `LoadFailed`
  (unknown ≠ zero) с retry; 403 показывается тем же экраном.
- **§8.2 backup rehearsal с непустыми финансовыми таблицами, §8.3 измерение proxy depth,
  §8.4 Sentry runtime SHA, §8.5 S3 upload/read/delete, §8.6 seed rotation, §8.7 MapTiler key,
  §8.9 APK, §8.10 rollback rehearsal** — не выполнялись в этом задании: каждое требует либо доступа
  владельца (ключи, provider console), либо отдельного разрешённого прогона на инфраструктуре.
  Состояние по фактам на сегодня — в разделе 8.
- **§10 «Телефон».** Ни один сценарий на физическом устройстве не выполнен. Всё ниже — jest/PG.

### 6.2 Собственные ошибки по ходу работы
- **Снёс `_prisma_migrations` тестовой БД.** Запустил `prisma migrate diff` с
  `--shadow-database-url` = тестовой БД; Prisma сбросила её, глобальный setup jest упал с P3005.
  Пересоздал `tutak_test` (`DROP/CREATE DATABASE`), для drift завёл отдельную `tutak_shadow`.
  Production не затронуто (локальная БД).
- **Неверная команда typecheck.** `tsc --noEmit -p tsconfig.json` даёт rootDir-ошибки; правильная —
  `pnpm typecheck` (build + spec). Потерял время, кода не сломал.
- **Сломал два существующих spec.** Добавив `retryable: true` в `AlertDelivery`, не обновил
  `telegram-alert.channel.spec` и `webhook-alert.channel.spec` (`toEqual` на точную форму) —
  найдено полным unit-прогоном, исправлено в `fbaf56a`.
- **Тест утекал мок между кейсами.** Первый D07-тест переопределял `readItem` и не возвращал
  реализацию; 18 соседних тестов упали. Восстановление мока перенесено в `beforeEach`.
- **Экран блокировки вызывал биометрию при недоступном хранилище.** Найдено моим же новым тестом
  `LockScreen.test` (store отказывал, но OS-диалог показался бы). Исправлено гейтом на `storage`.
- **Мок LockScreen без `storage`/`hydrate`.** Новые поля store не были в моке экрана → 3 теста
  красных. Добавлены.
- **Ожидание backoff.** Первая версия `settleWindow` держала серию сбоев 900 с, и после 5-го шага
  серия истекала; ожидание `[60,120,240,480,900,900]` не выполнялось. Ключ серии живёт `2×` окна.

### 6.3 Заблокировано решением владельца или данными
- Все пункты §9 (Model C refund vs owner exception; marketplace collection/stored value;
  Seller/Merchant of Record, фискальный чек, НДС, netting; credit limits) — не решались, ничего
  не захардкожено. Prepaid/PSP/POS остаются выключенными флагами.
- `ALERT_TELEGRAM_CHAT_ID` / webhook, MapTiler key rotation, seed rotation — только владелец.

---

## 7. UNVERIFIED (прямой список)

1. Поведение на физическом телефоне: keystore-ошибка (D07/D08), 502 после commit (D14), stale (D15),
   геолокация/recentre (D16), UNRESOLVED (D06) — только jest.
2. Параллельная SQL-гонка `position()` (D04).
3. Расчёты D01–D03 на данных production — production DB не читалась (правило «не подключать API
   к restored DB», данных для сверки нет). Утверждений о потерянных/двойных выплатах нет и не делается.
4. Миграция `20260921100000` на production — не применялась (только локально + shadow drift).
   Expand-only (ADD COLUMN DEFAULT + UPDATE), но rollback-rehearsal не проводился.
5. Доставка alert живому получателю (D05) — канал не настроен у владельца.
6. CI GitHub Actions на итоговом SHA — на момент записи прогон на `d3ed01a` (run 35597499881) шёл; результат
   фиксируется комментарием в PR #65, здесь не переписывается, чтобы не плодить коммиты отчёта.
7. Backup/PITR с непустыми финансовыми таблицами, proxy depth, Sentry runtime SHA, S3, MapTiler,
   APK, rollback — не проверялись в этом задании.
8. Скриншоты новых экранов (lock «хранилище недоступно», UNRESOLVED, stale notice, LoadFailed)
   не снимались.

---

## 8. Production и кандидат; эксплуатационные факты

| Сервис (Railway env `aebe04da…`) | Деплой | SHA |
| --- | --- | --- |
| tutak-api `39cf03f4…` | 2026-09-19 07:30Z, SUCCESS | `369eda1` (main) |
| admin `a34ead5d…` | 2026-09-19 07:30Z, SUCCESS | `369eda1` (main) |
| partner `2af2591c…` | 2026-09-19 07:30Z, SUCCESS | `369eda1` (main) |
| Postgres / Redis | 2026-09-19 / 2026-09-01 | образы, без кода |

Production не менялся этим заданием: ни деплоя, ни переменных, ни данных. Кандидат —
`claude/audit-verification-20260921` поверх #64; до production он дойдёт только через
merge #64 (и далее #60) по отдельному поручению.

Что из D01–D18 есть в production (`main`) уже сейчас: D02, D03 (allocation legacy payout /
collection), D05 (alerts), D13 (admin), D16 (геолокация). Остальные 13 — код только в #64 и за
флагами (`TUTAK_PSP_ENABLED=false`, POS/prepaid выключены), в production их путей нет.

Gates watch (PR #60): без изменений — `ALERT_TELEGRAM_CHAT_ID` не задан, `SEED_BASELINE` и
`SEED_ADMIN_PASSWORD` присутствуют, device review не проводился. #60 NOT READY, не merge-ится.

---

## 9. Вопросы владельцу (только owner-only)

1. **Refund model:** строгая Model C (STAFF никогда не возвращает напрямую, любой возврат через другого
   менеджера) или owner/manager exception для solo-партнёра? Код сейчас — Model C.
2. **Версия округления возвратов (D09):** для покупок с prepaid > 0, у которых уже есть возвраты
   версии 1, новые возвраты будут отклоняться (409) до ручного решения. Таких покупок в production
   нет (prepaid выключен). Подтвердить, что это приемлемо для кандидата.
3. **Alert-канал:** задать `ALERT_TELEGRAM_CHAT_ID` или webhook и разрешить одну контрольную
   доставку человеку.
4. **MapTiler key:** отозвать старый раскрытый ключ в консоли провайдера; новый — в EAS secrets.
5. **Seed:** после ротации admin-пароля убрать `SEED_BASELINE`/`SEED_ADMIN_PASSWORD` из production.
6. **Backup rehearsal** на изолированной копии с непустыми финансовыми таблицами — разрешить
   и согласовать расходы.
7. **Idram/юрист/бухгалтер:** MoR, фискальный чек, НДС, netting, credit limits — без решений
   prepaid/PSP/POS остаются выключенными.

---

## 10. Приоритеты и итог

- **P0 (до merge #64 в main):** нет открытых — D01–D04, D09, D10, D18 закрыты и доказаны на PostgreSQL.
- **P1 (до включения PSP/POS/prepaid):** контрольная доставка alert (D05, владелец); физический
  тест D07/D08 и D14 на телефоне; решение по вопросу 2 (версии округления).
- **P2:** alert outbox; SQL-гонка D04; screenshots новых состояний; §8.2–§8.10.

**Вердикт для scope «код PR #64 + исправления D01–D18, gated-off денежные пути»:**
**READY WITH EXTERNAL ACTIONS** — код и тесты закрыты; внешние действия: CI на итоговом SHA
(фиксируется в PR), owner-вопросы 2–3, телефонная проверка.

**Вердикт для scope «включение PSP/POS/prepaid в production»:** **NOT READY** — бизнес-решения §9,
договор Idram, alert-канал, APK и телефонная проверка отсутствуют. Это не изменилось.

**Вердикт для production сегодня (`369eda1`):** без изменений; D02/D03/D05/D13/D16 присутствуют
в production-коде, их пути (legacy payout, collections, admin) используются владельцем вручную;
исправления приедут с #64. Утверждений о фактических потерях денег нет: подтверждены только
контролируемые тесты.

---

## 11. Дополнение после полного прогона

- Полный integration-прогон: 125 suites, 1594/1594, exit 0 (раздел 5.1).
- Все локальные проверки из раздела 5 выполнены на коде `fbaf56a`.
- CI на PR #65 — см. PR (комментарий с результатом после завершения прогона).
- Ветка запушена без force push; PR #65 открыт на базу `claude/hybrid-payments-20260920`, не на `main`; merge — только по отдельному поручению.
