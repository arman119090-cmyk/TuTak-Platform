# Карточка создания сервиса API в Railway

Дополняет прежние документы. **Ничего не создано и не развёрнуто.**
Секретов здесь нет: три значения вводите вы, они в чат и в git не попадают.

---

## Сначала — исправление в моём же плане

Я предлагал `APP_ENV=production` вместе с `MEDIA_STORAGE_DRIVER=local`.
**Так первый деплой упал бы.** Проверил код хранилища:

```ts
if (isProduction && media.driver !== 's3') {
  throw new Error(
    'MEDIA_STORAGE_DRIVER is "local" in production. Partner logos and customer '
    + 'avatars must live in durable object storage …');
}
```

`DEMO_MODE` от этой проверки **не освобождает** — в отличие от эквайринга и
push, здесь это указано в коде отдельно. То есть при `APP_ENV=production`
хранилище обязано быть `s3`, а значит нужен бакет и пять переменных к нему.

### Что предлагаю вместо этого

**`APP_ENV=staging` + `NODE_ENV=production` + `DEMO_MODE=true`.**

Что при этом **сохраняется**:

| | чем обеспечено |
| --- | --- |
| Строгая проверка JWT-секретов | привязана к `NODE_ENV=production`, а не к `APP_ENV`. Не ослабляется |
| Коды не пишутся в журнал | `isPublicDeployment` покрывает и staging, и production. Консольный транспорт недостижим |
| Реальные списания невозможны | боевого адаптера эквайринга в коде нет вовсе, есть только песочный |
| Это объявлено вслух | `DEMO_MODE=true` → в журнале при старте и в `/health`: `{"status":"ok","demoMode":true}` |
| Вход без кода закрыт | `DEMO_PASSWORD` не задаём → `POST /auth/demo-session` отвечает 404 |
| Лимиты запросов | не отключаются: 5 кодов на номер в час, 15 попыток, глобальный бюджет |

Что **отпускается** и почему это приемлемо здесь:

* проверка долговечности медиа — мы сознательно берём `local`; медиа в
  проверяемые сценарии не входит, а цена честная: **логотипы и аватары
  пропадут при каждом передеплое**;
* проверка CORS на localhost — приложение нативное, CORS ему не нужен, панелей
  не развёрнуто.

**Если хотите строгий `production`** — тогда дополнительно нужен бакет
(`MEDIA_STORAGE_DRIVER=s3` и пять `MEDIA_STORAGE_S3_*`). Это лишний ресурс и
лишние деньги ради того, что сейчас не проверяется. Скажите, если всё же так —
подготовлю.

---

## Форма создания сервиса

Проект `TuTak` → окружение `production` → **New** → **GitHub Repo**.

| поле | значение |
| --- | --- |
| Репозиторий | `arman119090-cmyk/TuTak-Platform` |
| Ветка | `deploy/railway-api-df1fd99` |
| Имя сервиса | `tutak-api` |

Dockerfile указывать не нужно: в корне репозитория лежит `railway.json`, и
Railway возьмёт `apps/api/Dockerfile`, `healthcheckPath: /health`,
`healthcheckTimeout: 120` оттуда.

**Если предложит развернуть сразу — откажитесь.** Сначала адрес и переменные,
иначе первый деплой упадёт на проверках, которые ещё нечем удовлетворить.

---

## Порядок. Он важен

### 1. Сгенерировать адрес

Сервис `tutak-api` → **Settings** → **Networking** → **Public Networking** →
**Generate Domain**. Порт — **4000**.

Получится `что-то.up.railway.app`, HTTPS Railway выдаёт и продлевает сама.

### 2. Проверить, что адрес появился

В **Variables** сервиса должна быть переменная `RAILWAY_PUBLIC_DOMAIN` с
непустым значением вида `tutak-api-production-xxxx.up.railway.app`.

**Пусто — дальше не идти.** При пустом домене `MEDIA_PUBLIC_BASE_URL` станет
`https://`, а проверка это пропустит: `new URL('https://')` бросает исключение
внутри `isLoopbackOrigin`, `catch` возвращает `false`. Приложение поднимется
молча с нерабочим адресом.

### 3. Проверить, что база чистая

Сервис `Postgres` → вкладка данных / query:

```sql
SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at;
```

Ошибка «relation does not exist» → база чистая, идём дальше.
Есть строки → **остановиться и сказать мне**: одна из 52 миграций удаляет
строки, и я сверю, что именно применится, до того как это произойдёт.

### 4. Вписать переменные — целиком, как есть

Variables → **Raw Editor**, вставить блок:

```
NODE_ENV=production
APP_ENV=staging
DEMO_MODE=true
PORT=4000
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
QUEUE_PREFIX=tutak-test
CORS_ORIGINS=https://${{RAILWAY_PUBLIC_DOMAIN}}
MEDIA_PUBLIC_BASE_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}
MEDIA_STORAGE_DRIVER=local
SMS_GLOBAL_MAX_PER_HOUR=50
SMS_GLOBAL_MAX_PER_DAY=200
SEED_BASELINE=true
```

Фигурные скобки — это ссылки Railway, они так и вписываются. Если имена
сервисов баз у вас отличаются от `Postgres` и `Redis`, подставьте свои.

**Не задавать ничего из этого:** `DEMO_PASSWORD`, `DEMO_SEED`, `TRUST_PROXY`,
`CLIENT_IP_STRATEGY`. Первые два открыли бы вход без кода и насыпали бы
выдуманных клиентов и платежей; вторые два вместе дают отказ на старте, а по
отдельности требуют измерения на живом сервисе.

### 5. Добавить три секрета — вы, значения не сюда

| переменная | требование |
| --- | --- |
| `JWT_ACCESS_SECRET` | случайное, не короче 32 символов |
| `JWT_REFRESH_SECRET` | случайное, не короче 32 символов, **другое** |
| `SEED_ADMIN_PASSWORD` | не короче 12 символов |

При `NODE_ENV=production` приложение откажется стартовать, если секреты
совпадают или выглядят заглушкой. Это и есть та защита, которую не ослабляем.

### 6. Первый деплой — **без Viva**

Deploy. Дальше смотрим журнал и `/health`.

---

## Что должно получиться

| проверка | ожидание |
| --- | --- |
| `https://<адрес>/health` | `{"status":"ok","demoMode":true}`, замок в браузере |
| Журнал старта | `prisma migrate deploy` применил миграции, `SEED_BASELINE` отработал |
| Журнал, строка транспорта | `[SMS] SMS transport: unavailable — …` уровня error |
| `POST /v1/auth/demo-session` | **404** — вход без кода закрыт |
| Строки `SMS codes are written to this log` | не должно быть вовсе |

`unavailable` на этом шаге — правильно: карьер ещё не подключён, но теперь
приложение об этом **пишет**, а не молчит.

**Отмена первого запуска — остановка или удаление сервиса `tutak-api`.**
Rollback недоступен: предыдущего деплоя нет. Postgres, Redis, их переменные,
тома и данные при этом не трогаются.

---

## Шаг 2, после успешного первого запуска

Добавить переменные Viva:

```
SMS_DRIVER=viva
VIVA_API_BASE_URL=https://businesshubapi.viva.am/api/v1
VIVA_SENDER_NAME=Tu-Tak
VIVA_OTP_TEMPLATE_NAME=Tu-Tak2
SMS_VIVA_NUMBER_FORMAT=national
```

плюс четыре секрета от вас: `VIVA_CLIENT_ID`, `VIVA_CLIENT_SECRET`,
`VIVA_USERNAME`, `VIVA_PASSWORD`.

`SMS_VIVA_GATEWAY_SECRET` **не задавать** — идём напрямую. Шлюз Contabo
остаётся запасным путём, если Viva не примет исходящий адрес Railway.

После перезапуска в журнале должно стать `[SMS] SMS transport: viva`. Затем —
один запрос кода **только на ваш согласованный номер**, и читаем журнал по
таблице из поправки №4: она различает «не достучались», «не приняли ключи»,
«отказ по существу» и «приняли, но не доставили».

---

## Про новый APK

Собираю **после** того, как адрес известен и `/health` отвечает — из ветки
`claude/android-keyboard-diagnostics-20260908`, коммит
`1993e1bad215a3c065d4f097175c3ab67221a135` (410 тестов, 49 наборов). Не из
`apps/mobile` в ветке API: там код без правок фокуса и формы.

APK42 до этого момента продолжает работать с Render и не трогается.
