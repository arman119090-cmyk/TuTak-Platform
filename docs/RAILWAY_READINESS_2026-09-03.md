# Railway production readiness — отчёт ПЕРЕД deploy

Commit **`838ef48d59ca7773f0c51a0f84fbdefb6b4dd34c`** (`838ef48`),
ветка `claude/tutak-loyalty-mvp-e485jm`.

**Ничего не задеплоено. 46 Railway changes не применены. Contabo/Viva не
тронуты. Render-конфигурация не удалена. Ни один секрет не выведен.**

---

## 1. Railway readiness: **NOT READY**

Код к Railway готов. Не готова **конфигурация окружения**: два блокера
гарантированно роняют первый deploy, третий тихо ломает вход в кабинеты.

Причём это не оценка «на глаз» — оба блокера воспроизведены на реальном
startup path собранного образа (§6).

---

## 2. Найденные blockers

### B-1. SMS: production не стартует без `SMS_ENDPOINT` — КРИТИЧНО

`selectSmsTransport` (`sms-transport.ts:124`), порядок:
1. `SMS_DRIVER=viva` → нужен полный набор Viva, иначе `throw` **в любом** окружении;
2. иначе непустой `SMS_ENDPOINT` → HTTP-провайдер;
3. иначе `APP_ENV=production` и не `DEMO_MODE` → **`throw`**.

`SMS_DRIVER` по умолчанию `http`. В вашем списке Railway есть
`SMS_AUTH_SCHEME`, `SMS_ENCODING`, `SMS_SENDER`, но **`SMS_ENDPOINT` не
указан**. Если его действительно нет — контейнер падает при старте, Railway
healthcheck не проходит, сервис уходит в рестарт-цикл.

Воспроизведено:
```
SMS_ENDPOINT must be configured in production — verification and password
reset codes cannot be delivered without a car…
```

Это защита, а не баг: развёртывание, которое не может доставить код
подтверждения, не может никого впустить. Варианты (решение за вами):
* задать `SMS_ENDPOINT` на Contabo-шлюз, когда он поднят;
* временно `APP_ENV=staging` — тогда `UnavailableSmsProvider`, сервис живёт,
  отправки честно падают;
* дождаться Viva и сразу включить `SMS_DRIVER=viva`.

⛔ **Заглушку ставить нельзя** — она уберёт единственный сигнал, что
production не умеет слать SMS.

### B-2. CORS: localhost в production — ИСПРАВЛЕНО в коде, требует правки env

Раньше это проходило молча. Теперь — отказ при старте (§3). Ваш текущий
`CORS_ORIGINS` с localhost-адресами **не даст сервису подняться**, пока не
будет заменён на реальные домены admin и partner.

Так лучше: со старым поведением сервис бы поднялся, `/health` был бы зелёный,
а кабинеты просто не смогли бы обратиться к API — самая дорогая форма
поломки, когда ничего не горит.

### B-3. Cookie/SameSite на `*.up.railway.app` — тихо ломает сессии

`AUTH_COOKIE_SAMESITE` по умолчанию `strict`. `railway.app` — в **Public
Suffix List**, как и `onrender.com`. Значит API на одном
`*.up.railway.app` и админка на другом — **разные сайты**, refresh-cookie не
отправляется никогда.

Симптом: вход проходит, через ~15 минут сессия умирает, пользователя
выбрасывает на логин. В логах — ничего.

Нужно `AUTH_COOKIE_SAMESITE=none` (тогда `Secure` включается сам). Либо свои
домены под одним registrable-доменом (`api.tutak.am` + `admin.tutak.am`) —
тогда `strict` работает и сохраняет защиту от CSRF.

### B-8. `NEXT_PUBLIC_SENTRY_ENVIRONMENT` по умолчанию `staging` — ИСПРАВЛЕНО

В Dockerfile admin и partner значение по умолчанию было `staging`. Пока из
этого файла собирался только Render staging, это было правдой; как только тот
же файл стал собирать **Railway production**, это стало ложью: каждая ошибка
кабинета в production попадала бы в окружение `staging`, где production-правило
алертинга её не ищет. Ошибка, положенная не туда, хуже непомеченной — метка
создаёт впечатление, что её обработали.

`production` был бы зеркальной ложью для staging-сборки, поэтому ни одно
окружение не является безопасной догадкой. Умолчание теперь **`unknown`** —
тот же идиом, который репозиторий уже использует для неуказанного релиза
(`GIT_COMMIT_SHA`), и он заметно неверен в Sentry, что и приводит к починке.
На Railway передавайте реальное значение переменной сервиса — она доходит до
`ARG`.

### B-4. `MEDIA_PUBLIC_BASE_URL` — курица и яйцо (усилено проверкой)

**Дополнено:** раньше проверялась только непустота, а умолчание —
`http://localhost:${PORT}`. Любая заглушка проходила, и каждый URL логотипа и
аватара, который API отдаёт мобильному приложению и обоим кабинетам, указывал
на машину самого зрителя — молча, при зелёном `/health`. Это ровно та же
болезнь, что была у CORS, и именно тот параметр, который вероятнее всего
заполнят заглушкой: настоящий ответ — публичный адрес API, а его до первого
успешного деплоя не существует.

Теперь loopback-значение в production отклоняется при старте
(`config/public-base-url.ts`, 10 тестов). Проверено на реальном startup path.

### B-4 (исходное). Курица и яйцо остаётся

Обязателен в production (`media-storage.module.ts`), и на нём строится каждый
URL логотипа и аватара. Но правильное значение — **публичный домен API**,
которого до первого deploy не существует. Значит после появления домена его
надо переустановить и передеплоить (§11).

### B-5. Порядок сборки admin/partner

`NEXT_PUBLIC_API_BASE_URL` — **build-time** переменная: инлайнится в бандл и в
`connect-src` CSP. Fallback намеренно отсутствует — сборка без неё **падает**
(`ApiBaseUrlNotConfiguredError`), чтобы не выпустить бандл с политикой,
запрещающей собственный API. Значит admin и partner нельзя корректно собрать
раньше, чем у API появится домен.

### B-7. `DEMO_SEED` в production не был ничем защищён — ИСПРАВЛЕНО

Найдено при проверке §5. `seed-demo` требовал подтверждения `TUTAK_DEMO=1`,
но **`docker-entrypoint.sh` подставлял эту переменную сам**, так что внутри
образа проверка не могла сработать. Единственным барьером перед боевой базой
оставалось то, что `DEMO_SEED` не равен строке `true` — а он стоит вплотную к
`SEED_BASELINE`, который production законно включает.

Что записала бы одна опечатка: партнёров, клиентов и платежи, созданные через
**настоящие money-движки** (то есть реальные проводки в ledger), логины с
одним общим паролем и **снятым** флагом `mustChangePassword`. Отличить это
потом от данных, созданных клиентами, невозможно.

Закрыто двумя барьерами, по образцу существующего
`RESET_STAGING_ADMIN_PASSWORD`:
* в `seed-demo.ts` — решает **окружение**, а не флаг, который может задать
  вызывающий;
* в `docker-entrypoint.sh` — отказ до того, как появятся процесс Node,
  Prisma-клиент и соединение с БД.

Проверено запуском: `APP_ENV=production` → отказ (exit 1); только
`NODE_ENV=production` → отказ; `APP_ENV=staging` → по-прежнему разрешено
(для этого `DEMO_SEED` и нужен).

Попутно `seed-demo.ts` получил `require.main === module`: раньше простой
`import` этого модуля поднимал Nest и сеял базу, на которую указывает
`DATABASE_URL`.

### B-9. ⚠️ Поправка к варианту «поднять как staging»

Если для первого запуска выбрать `APP_ENV=staging` (чтобы обойти B-1), надо
знать цену точно. **Обе мои новые проверки замолкают** — они намеренно
привязаны к `isProductionDeployment`, то есть только к `production`:

* `CORS_ORIGINS` с localhost **пройдёт** — и кабинеты снова молча не достучатся
  до API. Проверено запуском: со `staging` и localhost-списком сервис
  поднимается и работает;
* `MEDIA_PUBLIC_BASE_URL` с localhost тоже **пройдёт** — все картинки будут
  ссылаться на машину зрителя.

Это не дефект проверок: для staging localhost законен, там разработчик
подключает локальную панель. Но для «staging как способ поднять production»
это ловушка, и я обязан назвать её прямо, потому что сам предложил этот путь.

**Вывод: при варианте A всё равно задайте реальные `CORS_ORIGINS` и
`MEDIA_PUBLIC_BASE_URL` вручную.** Автоматика вас там не подстрахует.

Что снимается со `staging` дополнительно: требование s3-хранилища, требование
push, и блокировка `DEMO_SEED` (убедитесь, что он не задан). Что **остаётся**:
CORS обязателен, Swagger выключен, коды подтверждения в лог не пишутся,
регистрация по паролю закрыта, Redis обязателен.

### B-10. Staging-fallback CORS подставлял домены Render — ИСПРАВЛЕНО

В `main.ts` при пустом `CORS_ORIGINS` и `appEnv === 'staging'` подставлялись
два фиксированных `*.onrender.com`-имени из первого блюпринта Render. Пока
Render был единственным staging — правда; с Railway как основной платформой это
стало откровенно неверным: сервис Railway в режиме `staging` с незаданной
переменной молча разрешал бы запросы с учётными данными от **предыдущего
провайдера**, инфраструктуры, которую выводят из эксплуатации.

Догадка, называющая чужую платформу, хуже отсутствия догадки. Fallback удалён —
теперь staging подчиняется тому же правилу, что и production: назови домены.
Проверено запуском: пустой `CORS_ORIGINS` на staging даёт
`CORS_ORIGINS must list the allowed origins outside development`.

⚠️ **Для живого Render staging:** `render.yaml` объявляет `CORS_ORIGINS` как
`sync: false`, то есть значение вводится в дашборде вручную. Если там оно
**не** задано и держалось на этом fallback — после этой правки сервис не
поднимется, пока переменную не проставят. Ошибка громкая и называет переменную;
чинится за полминуты. Render объявлен переходным, поэтому счёл размен верным,
но предупреждаю явно.

### B-6 (не блокер, к сведению). `CLIENT_IP_*` не заданы

Лимиты по IP стоят в сторонке (F-1 из прошлого аудита). Не мешает запуску;
замер по `RAILWAY_PRODUCTION_RUNBOOK_RU.md §9` после получения домена.

---

## 3. Что конкретно исправлено (коммит `838ef48`)

| Изменение | Файл | Зачем |
|---|---|---|
| Отказ при localhost в production-CORS | `config/cors-origins.ts` (новый) + `main.ts` | B-2: превращает тихую поломку кабинетов в громкий отказ с именем переменной |
| 14 тестов на этот guard | `config/cors-origins.spec.ts` (новый) | фиксируют поведение, включая `*.up.railway.app` как валидный домен |
| Railway в руководстве по cookie | `auth/refresh-cookie.ts` | B-3: механизм уже поддерживал `none`, но инструкция называла только Render |
| Полный env-контракт | `docs/RAILWAY_ENV_CONTRACT_RU.md` (новый) | все boot-guards, SMS-порядок, контракт Viva без секретов, порядок запуска |

Выдуманных URL нет. `*.up.railway.app` нигде не захардкожен. Секретов-заглушек
нет.

---

## 4. Что осталось Render-specific (ничего не удалено)

**A — полезно независимо от платформы:**
* `docker-entrypoint.sh` — fallback `RENDER_GIT_COMMIT` → `GIT_COMMIT_SHA`;
  рядом уже есть `RAILWAY_GIT_COMMIT_SHA`, обе ветки безвредны.

**B — нужно адаптировать под Railway:**
* `apps/admin/api-base-url.mjs:39`, `apps/partner/api-base-url.mjs:39` —
  константа `STAGING_API_BASE_URL` на onrender (используется только для
  проверки hostname в `httpClient.ts`, **не** как fallback сборки);
* `apps/admin/src/lib/httpClient.ts:17`, `apps/partner/.../httpClient.ts:30` —
  проверка hostname `*-staging-*.onrender.com`;
* `apps/api/src/main.ts:79-80` — staging-fallback CORS на onrender-домены;
  **на production не влияет** (сработает только при `APP_ENV=staging`, а
  production требует явный `CORS_ORIGINS`);
* `apps/mobile/eas.json:34` — `API_BASE_URL` staging-профиля на onrender;
* `.github/workflows/android-apk.yml:48` — onrender в тексте примера;
* `NEXT_PUBLIC_SENTRY_ENVIRONMENT` по умолчанию `staging` в Dockerfile
  admin/partner — на Railway передавайте `production`.

**C — больше не нужно как основное (но НЕ удалено до вашего подтверждения):**
* `render.yaml`, `render.demo.yaml`, `render.production.yaml`;
* `docs/RENDER_STAGING_RU.md` — как справочник по staging.

Тесты `appConfigGuards.test.ts` и `BuildInfo.test.ts` закрепляют
onrender-значения staging-профиля. Менять константы без правки этих тестов
нельзя — поэтому классифицировал, но не трогал.

---

## 5. Безопасно ли применять текущие 46 changes

**Применять можно, деплоить — нет.** Сами по себе изменения переменных ничего
не запускают. Но если применить и задеплоить как есть, произойдёт §6.

Перед deploy обязательно поправить: `SMS_ENDPOINT` (B-1) и `CORS_ORIGINS`
(B-2), плюс `AUTH_COOKIE_SAMESITE` (B-3), иначе кабинеты будут выбрасывать
пользователей.

Отдельно проверьте, что **`DEMO_SEED` отсутствует** — это другой флаг, не
`SEED_BASELINE`, и он создаёт выдуманных партнёров, клиентов и платежи.
В production он не должен появляться никогда.

---

## 6. Что произойдёт при первом deploy (проверено на startup path)

1. Образ соберётся (`nest build` прошёл, `dist/main.js` и
   `dist/scripts/seed-baseline.js` на месте).
2. `docker-entrypoint.sh` выполнит `prisma migrate deploy` — **успешно**.
3. При `SEED_BASELINE=true` выполнится baseline seed — **успешно**.
4. Запустится `node dist/main.js` и **упадёт** на первом же несоответствии:
   * с текущим `CORS_ORIGINS` (localhost) →
     `CORS_ORIGINS contains http://localhost:3000, http://localhost:3001 in production…`
   * если CORS починить, а `SMS_ENDPOINT` не задать →
     `SMS_ENDPOINT must be configured in production…`
5. Healthcheck `/health` не ответит, Railway уйдёт в рестарт-цикл.

Важно: **пункты 2 и 3 успевают отработать до падения.** То есть база будет
мигрирована и засеяна, даже если процесс потом не поднимется.

---

## 7. Выполнятся ли migrations автоматически

**Да.** `docker-entrypoint.sh` запускает `./node_modules/.bin/prisma migrate
deploy` на каждом старте, до старта процесса.

Безопасно: применяет только неприменённые миграции по порядку, отказывается
при drift, не генерирует и не диффит. При rolling deploy второй инстанс не
находит ничего и выходит сразу. Всего в истории 52 миграции; на локальной
чистой БД они применились полностью.

---

## 8. Выполнится ли baseline seed

**Да, при `SEED_BASELINE=true`** — `dist/scripts/seed-baseline.js`.

Создаёт **только**: все `Permission`, все `Role` с грантами, одного
супер-администратора. **Не создаёт** партнёров, кошельков, покупок, скидок,
рефералов, платежей — проверено чтением кода.

Идемпотентен: всё через `upsert`, у пользователя `update: {}` — существующему
администратору пароль **не перезаписывается**. Повторный запуск безопасен.

Требует `SEED_ADMIN_PASSWORD` ≥ 12 символов, иначе бросает.

⚠️ **Считать базу засеянной пока нельзя** — успешного запуска на Railway не
было. Доказательством будет строка `Baseline seed complete…` в логах Railway.

---

## 9. Чем логиниться после первого deploy

* телефон **`+37400000000`**
* пароль — тот временный `SEED_ADMIN_PASSWORD`, что вы задали в Railway
* роль `SUPER_ADMIN`, флаг `mustChangePassword: true` — система потребует
  сменить пароль сразу

После смены пароля `SEED_BASELINE` можно выключить.

Обычных клиентов не будет: регистрация по паролю на публичном развёртывании
закрыта намеренно, нормальный путь — OTP, а он требует рабочего SMS (B-1).

---

## 10. Какие env отсутствуют

**Блокирующие старт:**
* `SMS_ENDPOINT` (или полный набор Viva) — B-1;
* `CORS_ORIGINS` с реальными доменами вместо localhost — B-2.

**Ломающие функциональность тихо:**
* `AUTH_COOKIE_SAMESITE=none` (на сгенерированных доменах) — B-3;
* `MEDIA_PUBLIC_BASE_URL` = реальный домен API — B-4;
* `NEXT_PUBLIC_API_BASE_URL` на admin и partner (build-time) — B-5.

**Viva (ждут кредов):** `SMS_VIVA_CLIENT_ID`, `SMS_VIVA_CLIENT_SECRET`,
`SMS_USERNAME`, `SMS_TOKEN`, `SMS_VIVA_TEMPLATE_NAME`,
`SMS_VIVA_NUMBER_FORMAT`, при шлюзе — `SMS_VIVA_GATEWAY_SECRET`.

**Желательные:** `CLIENT_IP_STRATEGY` + `CLIENT_IP_TRUSTED_HOPS` (после
замера), `NEXT_PUBLIC_SENTRY_ENVIRONMENT=production`.

---

## 11. Действия после получения Railway public domain

1. Задать на API: `MEDIA_PUBLIC_BASE_URL` = домен API;
   `CORS_ORIGINS` = реальные домены admin и partner;
   `AUTH_COOKIE_SAMESITE=none` (если домены сгенерированные).
2. Передеплоить API.
3. Задать `NEXT_PUBLIC_API_BASE_URL=<домен API>/v1` на admin и partner и
   **пересобрать их** (Railway пробрасывает переменные сервиса в `ARG`).
4. Замерить `CLIENT_IP_TRUSTED_HOPS` (`RAILWAY_PRODUCTION_RUNBOOK_RU.md §9`)
   и включить `CLIENT_IP_STRATEGY=xff-depth`.
5. Пересобрать мобильный APK с `API_BASE_URL=<домен API>/v1`.
   **До этого APK не пересобираю** — выдуманный URL хуже отсутствующего.

---

## 12. Действия после получения Viva client credentials

1. Ввести в переменные Railway (только владелец, не в git):
   `SMS_VIVA_CLIENT_ID`, `SMS_VIVA_CLIENT_SECRET`, `SMS_USERNAME`,
   `SMS_TOKEN`, `SMS_VIVA_TEMPLATE_NAME`.
2. Уточнить у Viva и задать **`SMS_VIVA_NUMBER_FORMAT`**
   (`national` | `msisdn` | `e164`). Умолчания нет намеренно: номер в
   нераспознанной форме принимается в пакет и **никогда не доставляется** —
   отказ без симптомов, кроме «клиенту не пришёл код».
3. `SMS_ENDPOINT` — на Contabo-шлюз, `SMS_VIVA_GATEWAY_SECRET` — HMAC шлюза.
4. Переключить `SMS_DRIVER=viva`. При неполном наборе сервис откажется
   стартовать — это ожидаемо и правильно.
5. Проверить доставку на реальный номер до анонса.

Contabo остаётся Viva-шлюзом и в этой задаче не менялся.

---

## 13. Точный commit SHA

```
838ef48d59ca7773f0c51a0f84fbdefb6b4dd34c
```

---

## 14. Результаты всех проверок

| Проверка | Результат |
|---|---|
| typecheck API (`tsconfig.build.json`) | ✅ 0 ошибок |
| typecheck API (`tsconfig.spec.json`) | ✅ 0 ошибок |
| lint (изменённые файлы) | ✅ 0 замечаний |
| unit API | ✅ **495 / 495** (33 сюиты; +14 CORS, +7 DEMO_SEED) |
| integration API | ✅ **1075 / 1075** (79 сюит), `INT_EXIT=0` |
| entrypoint-guard `DEMO_SEED` | ✅ production отказ (exit 1), staging разрешён |
| mobile | ✅ **330 / 330** (39 сюит) |
| production build API | ✅ `dist/main.js` + `dist/scripts/seed-baseline.js` |
| production build admin | ✅ 15 маршрутов |
| production build partner | ✅ 13 маршрутов |
| startup path (production-like env) | ✅ оба guard'а сработали как ожидалось |

Интеграционный набор в этот раз включает `production-boot` — прошлый прогон
ронял его артефактом стенда (экспорт `APP_ENV` затекал в тесты). Здесь
`APP_ENV` не экспортировался, и все 79 сюит зелёные.

---

## Что дальше

Жду вашего подтверждения. Ничего не деплою.

Минимальный набор перед первым deploy: решить вопрос по **`SMS_ENDPOINT`**
(B-1) и заменить **`CORS_ORIGINS`** на реальные домены (B-2). Остальное можно
доводить после того, как домен появится.
