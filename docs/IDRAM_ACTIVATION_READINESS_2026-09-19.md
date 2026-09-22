# Post-merge production verification и пакет активации Idram

Дата: 19.09.2026
Задание: проверить состояние main/GitHub/Railway после merge #54; разобрать
follow-up PR из `claude/railway-connector-check-wy0ffq`; довести production
observability до доказуемой цепочки «ошибка PSP worker → dead-letter/alert →
человек получил сигнал» насколько это возможно без credentials; составить
`docs/IDRAM_PROVIDER_CONFIRMATION.md` (таблица подтверждений, письмо,
sandbox-план); не включать реальные деньги. Формат отчёта: CURRENT
PRODUCTION / FOLLOW-UP PR / OBSERVABILITY / IDRAM PACKAGE / BLOCKED BY ARMAN /
BLOCKED BY IDRAM / ACTIVATION READINESS.

База на старте: `main` = `ef710f3`. В конце: `main` = `98da0a4`
(merge #56). Изменения этой задачи — в PR #57 из ветки
`claude/railway-connector-check-wy0ffq` (перезапущена от `98da0a4`).

---

## CURRENT PRODUCTION

Railway project «TuTak», environment `production`, проверено в начале и в
конце задачи:

- `main` не менялся неожиданно: `ef710f3` на старте, единственное движение —
  мой merge #56 → `98da0a4`.
- Все три сервиса `SUCCESS`, replicas 1/1, `issues: 0`, `recentFailures: 0`
  за 6 ч: `tutak-api`, `tutak-admin`, `tutak-partner`; Postgres и Redis
  online. После merge #56 Railway пересобрал все три на `98da0a4`
  (api `bf4d5541`, SUCCESS 07:09:45) — деплой прошёл штатно, миграций новых
  нет.
- Логи API после старта: 0 строк уровня error/warn (кроме предупреждения
  Prisma об устаревшем `package.json#prisma`); «15 recurring job(s)
  scheduled», «Nest application successfully started».
- Список переменных `tutak-api`: `TUTAK_PSP_ENABLED`, `PSP_REFUNDS_ENABLED`,
  `CUSTOMER_PREPAID_TOPUP_ENABLED`, `IDRAM_*`, `ALERT_WEBHOOK_URL`,
  `SENTRY_DSN`, `METRICS_TOKEN` — **отсутствуют**. Деньги выключены; refund
  и prepaid выключены; наблюдаемости нет (см. OBSERVABILITY).
- HTTP-трафик к API: 0 запросов за час — живой нагрузки на production нет.
- Что фактически работает: обычный DIRECT-контур, EV, QR, бонусы,
  рефералы, Admin/Partner — по CI main (E2E на собранном стеке) и по
  локальному интеграционному набору; на самом production под живыми
  запросами не наблюдалось (трафика нет, доступа к боевому API из этой
  среды нет — прокси 403).

## FOLLOW-UP PR

**#56 — merged** (`98da0a4`, merge commit). Проверено перед merge:

- diff: ровно два файла, +446/−0 — `apps/api/test/money-disabled-routes.int-spec.ts`
  и `docs/POST_MERGE_PR54_2026-09-19.md`; production-кода, случайных и
  посторонних файлов нет;
- зачем: тест закрывает пробел доказательства (деньги были доказаны
  выключенными на уровне сервисов, не HTTP-маршрутов); отчёт — по docs/WORKING_AGREEMENT_RU.md;
- regression-тест в `main` отсутствовал — PR нужен;
- CI на `885fb10`: pull_request-run зелёный по всем 5 job (push-run тоже
  дошёл до зелёного).

После merge: CI main #786 на `98da0a4` — зелёный, все 5 job (включая E2E на собранном стеке и backup/restore); Railway deployment —
SUCCESS на всех трёх сервисах.

## OBSERVABILITY

**Что было.** Цепочка существует в коде и в основном правильная:

| Звено | Где | Состояние до задачи |
|---|---|---|
| PSP worker: строка inbox после 10 неудач → `DEAD` | `psp-callback-inbox.service.ts` `recordFailure` | `Sentry.captureException` + `alerts.fire('psp.callback-dead-letter:<id>', critical)` |
| Зависшая попытка (ageing) | `psp-attempt-ageing.service.ts` | `psp.attempt-unresolved`, warning → critical после 4 эскалаций, каждые `PSP_ESCALATE_EVERY_MS` |
| Сбой самого sweep-джоба | `sweeps.processor.ts`, heartbeat | `sweep.failed` |
| Reconciliation drift, outbox dead-letter, storage unreachable | соответствующие сервисы | есть |
| Канал | `AlertsModule` | `ALERT_WEBHOOK_URL` → `WebhookAlertChannel`; иначе **console** + warn при старте |
| Подавление повторов | `AlertsService.fire`, Redis, 15 мин на ключ | есть |
| Проверка канала | `pnpm --filter @tutak/api alert:verify` | есть |
| Ошибки | `SENTRY_DSN` → Sentry, иначе выкл.; `sentry:verify` | есть |
| Health | `/health/ready` — Postgres, Redis, storage | есть; Railway healthcheck на нём |

**Два дефекта, найденные и исправленные (код, без credentials):**

1. **Канал говорил «доставлено», когда получатель отказал.**
   `WebhookAlertChannel.send` логировал не-2xx и сетевую ошибку и возвращал
   `void`; `AlertsService.fire` возвращал `true` = «не подавлено»;
   `alert:verify` печатал «Sent through the webhook channel» для webhook,
   ответившего 500 или недоступного. Оператор поставил бы галочку на мёртвом
   канале. Исправление: `AlertChannel.send` возвращает `AlertDelivery
   { delivered, detail }` (delivered = только 2xx); `AlertsService.fire`
   возвращает `AlertOutcome { suppressed, delivered, channel, detail }`;
   console-канал всегда `delivered: false`; `alert:verify` завершается с
   ошибкой «receiver did not accept» на любом не-2xx/недоступности.
   Regression: `webhook-alert.channel.spec.ts` (3 кейса: 200 → delivered,
   500 → нет, сеть → нет и не бросает), `alert-verify.spec.ts` (+1 кейс),
   `alerting.int-spec.ts` (обновлены утверждения о подавлении).
2. **Денежный маршрут мог стартовать вслепую.** `TUTAK_PSP_ENABLED=true`
   требовал креды Idram, но не канал оповещения; dead-letter ушёл бы в
   консоль. Исправление: `assertProviderPaymentsConfigured` теперь требует
   `ALERT_WEBHOOK_URL` (https) при включённом флаге — приложение не
   стартует. Обычный маршрут по-прежнему только предупреждает (падение
   кассы из-за webhook — не безопасность). Regression: `env.validation.spec.ts`
   (+1 кейс, 4 утверждения); `production-boot.int-spec.ts` получил webhook в
   своей production-конфигурации.

Документация: `docs/DEPLOYMENT.md` §5a (семантика verify и новое boot-
требование), `docs/IDRAM_ACTIVATION_CHECKLIST.md` §3.

**Чем доказано (локально, ветка от `98da0a4`, коммит `f333f56`):**

| Проверка | Результат |
|---|---|
| `pnpm lint`, `pnpm typecheck`, `pnpm build` | чисто |
| Unit (api) | 691 тестов, 50 suites (+5: 3 webhook-канал, 1 alert:verify, 1 boot-guard) |
| Integration (api), `connection_limit=5`, один процесс | 1469 тестов, 111 suites, 397 с |
| CI на PR #57 | запущен после push; на момент записи отчёта не завершён |

**Чего конкретно не хватает — и это не код:**

- `ALERT_WEBHOOK_URL` в Railway `tutak-api` (входящий webhook Slack /
  Mattermost / Discord / любой JSON POST) — единственное звено, которое
  превращает «alert сработал» в «человек получил». Без него цепочка
  обрывается на консоли.
- Прогон `alert:verify` **с production-переменными** и подтверждение
  человеком, что сообщение пришло. Из этой среды это невозможно: нет
  webhook и нет production env.
- `SENTRY_DSN` — не блокирует денежный маршрут (решение: paging-канал —
  webhook, Sentry — диагностика), но без него stack trace dead-letter'а
  останется только в логах Railway.
- Не сделано в коде и осознанно отложено: gauge «канал оповещений =
  console» в `/metrics` (endpoint выключен без `METRICS_TOKEN`, а публичный
  `/health/ready` не место для «мониторинг выключен»); heartbeat-алерт
  «канал оповещений не проверен N дней» — идея, не требование.

## IDRAM PACKAGE

`docs/IDRAM_PROVIDER_CONFIRMATION.md`:

- §1 — таблица «Вопрос | Реализовано | Что подтвердить | Что изменится»,
  8 групп: checksum (порядок, разделитель, кодировка, hex/регистр, формат
  суммы и даты, пустые поля, контрольный вектор с дайджестом для сверки),
  `EDP_TRANS_ID`, pre-check, финальный коллбэк, status query, refund /
  reversal, сроки и комиссия, sandbox. Каждая строка привязана к файлу и
  функции, и говорит, что именно поменяется при другом ответе.
- §2 — письмо в поддержку Idram, русская и английская версии, 8 пунктов,
  без секретов и внутренностей; с контрольным вектором, чтобы Idram
  посчитал checksum сам.
- §3 — sandbox-план из 20 шагов, каждый с «ожидаемый результат →
  доказательство → критерий STOP»; правило: любое финансовое
  несоответствие останавливает платежи.

Какие ответы ждём прежде всего: (1) порядок полей checksum и дайджест
контрольного вектора; (2) уникальность/стабильность `EDP_TRANS_ID`;
(3) есть ли отрицательный коллбэк и retry policy; (4) есть ли status query
(если нет — явно); (5) есть ли refund API (если нет — ручной процесс);
(6) реальные сроки жизни счёта и окна доставки коллбэка; (7) sandbox-креды
и место регистрации callback URL.

## BLOCKED BY ARMAN

1. **Задать `ALERT_WEBHOOK_URL` в Railway → `tutak-api` → Variables.**
   Значение — URL входящего webhook канала, который люди читают ночью.
   Railway перезапустит сервис сам. Что прислать: ничего, кроме п. 2.
2. **Проверить канал:** локально с тем же `ALERT_WEBHOOK_URL` и
   `REDIS_URL` выполнить `pnpm --filter @tutak/api alert:verify`
   (после merge PR #57 — иначе скрипт ещё старой версии). Должно
   напечатать «accepted … webhook answered 200», и в канале появиться
   «TuTak alert channel test». Прислать: скриншот сообщения в канале.
3. **Отправить письмо Idram** из §2 `docs/IDRAM_PROVIDER_CONFIRMATION.md`,
   подставив имя мерчанта и хост API. Прислать: ответ Idram как есть.
4. **Смержить PR #57** после зелёного CI (кода денежного контура не
   меняет; меняет только alerting и boot-guard).
5. Опционально: `SENTRY_DSN` в Railway и `pnpm --filter @tutak/api
   sentry:verify`.

## BLOCKED BY IDRAM

Точный список — §2 письма (8 пунктов). Коротко:

1. Checksum: порядок полей, разделитель, кодировка, hex/регистр, формат
   `EDP_AMOUNT` и `EDP_TRANS_DATE`, допустимость пустого
   `EDP_PAYER_ACCOUNT`; дайджест контрольного вектора.
2. `EDP_TRANS_ID`: глобальная/мерчантская уникальность, стабильность при
   повторной доставке, возможность двойной оплаты одного `EDP_BILL_NO`.
3. Pre-check: тот же URL и `EDP_PRECHECK=YES`; обязательные поля;
   допустимые ответы; таймаут; retry; поведение без ответа.
4. Финальный коллбэк: достаточность `200 OK`; retry policy (интервалы,
   число, окно); поздние коллбэки; коллбэк при неуспехе/отмене; исходящие IP.
5. Status query: есть / официально нет.
6. Refund: full / partial / void — есть, или официальный ручной процесс.
7. Сроки: жизнь счёта, таймаут страницы оплаты, окно коллбэка; комиссия;
   выписка и периодичность перечислений.
8. Sandbox: URL формы, тестовые мерчант/ключ/кошелёк, лимиты, регистрация
   callback URL.

## ACTIVATION READINESS

**READY FOR IDRAM SANDBOX: NO.**
Недостающие доказательства:
- ответы Idram по §1–§8 (без них sandbox-прогон — угадывание, и первый же
  «checksum mismatch» ничего не объяснит);
- sandbox-креды и URL формы;
- `ALERT_WEBHOOK_URL` задан и `alert:verify` подтверждён человеком;
- отдельная не-production среда с `TUTAK_PSP_ENABLED=true`.

Что для sandbox **уже готово**: код в main, boot-guard'ы (креды, https,
webhook), контрактный тест с фиксированным вектором, HTTP-доказательство
выключенных денег, план из 20 шагов с критериями STOP.

**READY FOR REAL MONEY: NO.**
Всё из списка выше, плюс:
- пройденный sandbox-план (шаги 1–20) с доказательствами;
- реальный `FORM_POST` на Android-устройстве;
- письменно зафиксированные refund-процесс и status-query (или их
  отсутствие);
- два разных человека с `PSP_RECONCILE` и два с `CONTRIBUTION_RULE_APPROVE`;
- значения `PSP_TIMEOUT_POLICY` из ответа Idram вместо наших умолчаний;
- решение владельца о первом партнёре, первом кассире и лимите суммы.

---

## Что НЕ сделано / собственные ошибки

- Не проверено на живом production: `/health/ready`, DIRECT-покупка — нет
  доступа к боевому API из среды и нет трафика.
- Gauge о состоянии канала оповещений в `/metrics` не добавлен (см. выше).
- Первая версия правки `AlertChannel` упала на assert: я редактировал по
  отфильтрованному выводу (`grep -v` комментариев) и не совпал с реальным
  текстом файла; переделано по точному тексту.
- Полный локальный интеграционный набор для этой ветки прогнан целиком
  (1469/1469); CI на PR #57 на момент записи ещё шёл — итог смотреть на
  странице PR.
- Merge PR #57 — за владельцем: он меняет поведение alerting и boot-guard,
  автодеплой Railway подхватит `main` сразу после merge.
