# Отчёт: деплой на staging не выполнен (OTP hardening, a9f9816)

Дата: 2026-09-01. Только подтверждённые факты.

## Деплой: заблокирован

```
$ curl -sS -m 25 https://tutak-staging-api.onrender.com/health
curl: (56) CONNECT tunnel failed, response 403

$ curl -sS "$HTTPS_PROXY/__agentproxy/status"
"recentRelayFailures": [{ "kind": "connect_rejected",
  "detail": "gateway answered 403 to CONNECT (policy denial or upstream failure)",
  "host": "tutak-staging-api.onrender.com:443" }]
```

Egress на `onrender.com` запрещён политикой окружения. Креденшелов Render в
сессии нет (`env | grep -i render` — пусто), `deploy.yml` в
`.github/workflows/` отсутствует (есть только `android-apk`, `ci`,
`demo-apk`, `docker-publish`). Деплой на Render идёт из его собственного
авто-деплоя по ветке — он не инициировался и подтверждён быть не может.

**Пункты 1 и 2 в этой сессии невыполнимы.**

Отдельно: даже при открытом egress пункт 1 через API не решается —
`/health` возвращает только `{status, demoMode}`
(`apps/api/src/modules/health/health.controller.ts:29`), SHA сборки не
отдаёт. Понадобится Render dashboard/API.

## Состояние ветки — расхождение

```
локальный HEAD:                          a9f9816
origin/claude/tutak-loyalty-mvp-e485jm:  8686c97
```

Поверх коммита другая сессия (`claude/tutak-staging-flow-check-hl97qh`)
запушила merge. Проверено:

```
$ git diff --name-only a9f9816 origin/claude/tutak-loyalty-mvp-e485jm
(пусто)
$ git merge-base --is-ancestor a9f9816 origin/... → да
```

Дерево `8686c97` побайтово идентично `a9f9816`. Что бы ни задеплоилось с
типа ветки — по содержимому это ровно коммит a9f9816.

## Пункт 3: модель хранения OTP — подтверждено

Только хэш. `schema.prisma`, модель `AuthOtpToken`: поля
`id, phone, purpose, codeHash, expiresAt, consumedAt, attempts, createdAt`.
Поля для кода нет; запись — `codeHash: sha256Hex(code)`
(`auth-otp.service.ts:55`).

- Postgres — тест `stores only a hash of the code, never the code`.
- Notifications — запись уведомления удалена; тесты
  `writes no notification at all`,
  `leaves the code out of every persisted notification row`,
  `never returns the code from /notifications/me`.
- API-ответ — тест `keeps the code out of the request-OTP API response`;
  ответ ровно `{success: true}`.
- Sentry — структурно недостижим. `sentry-sanitize.ts` работает по
  allowlist: целиком отбрасываются `request`, `message`, `exception.value`,
  breadcrumbs, `extra`, `contexts`, `vars`, `fingerprint`, `user`. Проходят
  только 5 тегов из `ALLOWED_TAG_KEYS`. Тест:
  `drops the whole request object, raw path included`.
- Логи — тест `never writes the code to the application log`.

## Пункт 4: два незакрытых вопроса

### 4a. TRUST_PROXY — критично

`render.yaml:53` объявляет `TRUST_PROXY` как `sync: false` — blueprint
значение не задаёт, оператор вводит вручную. Если не задан:
`configuration.ts:371` даёт пустую строку → `resolveTrustProxySetting`
возвращает `undefined` → Express остаётся на `false` → `req.ip` = TCP-peer.

На Render перед контейнером всегда стоит балансировщик.
`docs/DEPLOYMENT.md:163`: «every client behind it will otherwise appear to
rate-limit as one shared address».

Последствие нового лимита: все клиенты попадут в один бюджет. Не 60 выдач в
час на пользователя, а 60 выдач в час на весь сервис. Staging встанет после
60 запросов OTP суммарно.

Требуется до деплоя: задать `TRUST_PROXY` в CIDR исходящих адресов Render.
Значение в репозитории отсутствует — это к оператору.

### 4b. DEMO_MODE и ConsoleSmsProvider — требование не выполняется

Требование «DEMO_MODE cannot enable ConsoleSmsProvider in production» сейчас
не соблюдено. `sms.module.ts`: отказ загрузиться срабатывает при
`isProduction && !demoMode`. То есть в production с `DEMO_MODE=true`
консольный провайдер возвращается. Добавлена редакция тела
(`ConsoleSmsProvider(isProduction)`), но сам провайдер там по-прежнему
доступен.

Для staging это не срабатывает — `render.yaml:3` фиксирует «no DEMO_MODE»,
переменной в blueprint нет.

Отдельная находка по staging: `NODE_ENV=staging` (`render.yaml:29`), а не
`production`. Значит `isProduction === false`, и если `SMS_ENDPOINT` не задан
(в `render.yaml` его нет), то на staging ConsoleSmsProvider загружается и
редакция не применяется — коды попадут в логи Render открытым текстом. Либо
задать `SMS_ENDPOINT`, либо расширить редакцию на staging.

### 4c. Redis — подтверждено

Fail-open задокументирован (`otp-ip-rate-limit.service.ts`, докблок) и покрыт
тестом `keeps serving requests when Redis cannot answer`. При отказе Redis
лимиты по телефону (Postgres) продолжают действовать.

## Пункт 5: точные лимиты

| Ограничение | Значение | Источник |
|---|---|---|
| Выдача на телефон / час | 5 (скользящее окно) | `MAX_CODES_PER_WINDOW` |
| Выдача на телефон / сутки | нет отдельного лимита → ≤120 | — |
| Попыток на один код | 5, затем код сжигается | `MAX_ATTEMPTS` |
| Попыток на телефон / час | 15 | `MAX_ATTEMPTS_PER_WINDOW` |
| Выдача на IP / час | 60 | `MAX_OTP_ISSUANCE_PER_IP_PER_HOUR` |
| Проверок на IP / час | 120 | `MAX_OTP_VERIFICATION_PER_IP_PER_HOUR` |
| Burst на IP, request-otp | 5 / 5 мин | `auth.controller.ts:108,136` |
| Burst на IP, verify-otp | 10 / 5 мин | `auth.controller.ts:115,143` |
| TTL кода | 10 минут | `CODE_TTL_MS` |

Ботнет-сценарий — защиты по стоимости нет. Поиск по
`sms.*(quota|budget|cap|cost|limit)|maxSms|smsPerDay` в `apps/api/src` не дал
ни одного совпадения. Глобального потолка на количество SMS или расходы не
существует.

Потолок: `min(N × 60, P × 5)` SMS в час, где N — число исходных IP,
P — число атакуемых номеров. При достаточном числе номеров связывает первое
слагаемое: 1000 IP → до 60 000 SMS в час, счёт растёт линейно с размером
ботнета. Лимиты сужают одного отправителя, но суммарные расходы не
ограничивают.

Вне охвата изменения: SMS шлют также `verify-phone/request` (5/5 мин) и
`password-reset/request` (3/5 мин) — на них часового лимита по IP нет,
только у auth-OTP.

## Тесты (на текущем дереве)

```
Test Suites: 2 passed, 2 total
Tests:       45 passed, 45 total
  test/auth-otp-hardening.int-spec.ts   PASS (11.6 s)
  test/auth-otp.int-spec.ts             PASS (5.9 s)
typecheck: чисто     lint: чисто
```

Ранее на a9f9816: integration 1064/1064 (78 наборов), unit 405/405.

## Нерешённые блокеры

1. Деплой невозможен из этой сессии — egress к `onrender.com` заблокирован
   (403), креденшелов Render нет. Пункты 1 и 2 не выполнены.
2. `TRUST_PROXY` не задан в blueprint. Без него лимит по IP схлопнется в один
   общий бюджет на весь сервис. Нужен CIDR Render от оператора — до деплоя.
3. На staging `NODE_ENV=staging` и нет `SMS_ENDPOINT` → коды попадут в логи
   Render без редакции.
4. `DEMO_MODE=true` в production по-прежнему включает ConsoleSmsProvider —
   требование не выполнено, нужно решение владельца.
5. Нет глобального потолка на SMS/расходы — ботнет с большим числом IP не
   ограничен по стоимости.
6. Ветка ушла вперёд (`8686c97`), хотя дерево идентично коммиту a9f9816.
