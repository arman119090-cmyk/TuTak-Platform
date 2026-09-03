# Railway production — контракт переменных окружения

Составлено чтением кода на HEAD ветки `claude/tutak-loyalty-mvp-e485jm`.
**Ни одного значения здесь не выдумано.** Там, где значение неизвестно
(публичный домен, секреты Viva), стоит явный placeholder-маркер, который
нельзя случайно принять за готовую конфигурацию.

Основная платформа — **Railway**. Contabo VPS остаётся отдельным Viva
IPsec-шлюзом. Render — переходная инфраструктура, здесь не рассматривается.

---

## 1. Переменные, без которых production НЕ ЗАПУСТИТСЯ

Каждая строка — реальный `throw` при старте. Источник указан.

| Переменная | Требование | Где проверяется |
|---|---|---|
| `DATABASE_URL` | обязателен | Prisma |
| `REDIS_URL` | обязателен явно на публичном развёртывании | `redis.module.ts` → `assertRedisUrlConfigured` |
| `JWT_ACCESS_SECRET` | не placeholder, не низкоэнтропийный | `env.validation.ts:109` |
| `JWT_REFRESH_SECRET` | то же и **≠ access** | `env.validation.ts:109` |
| `CORS_ORIGINS` | непустой **и без localhost** | `main.ts` + `config/cors-origins.ts` |
| `MEDIA_STORAGE_DRIVER` | обязан быть `s3` | `media-storage.module.ts` |
| `MEDIA_STORAGE_S3_ENDPOINT` / `_BUCKET` / `_REGION` / `_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` | все пять | `media-storage.module.ts` |
| `MEDIA_PUBLIC_BASE_URL` | обязателен | `media-storage.module.ts` |
| SMS-транспорт | см. §2 — **иначе `throw`** | `sms-transport.ts:124` |
| `SEED_ADMIN_PASSWORD` | ≥ 12 символов, если `SEED_BASELINE=true` | `seed-baseline.ts` |
| `PUSH_ENABLED=true` | иначе `throw` в production | `push.module.ts` |

Взаимоисключающие (задать **ровно одно**, иначе `throw` в `main.ts`):
`TRUST_PROXY` **или** `CLIENT_IP_STRATEGY=xff-depth`. На Railway — второе.

---

## 2. SMS: главный блокер первого deploy

Логика выбора транспорта (`selectSmsTransport`, порядок важен):

1. `SMS_DRIVER=viva` → требует полный набор Viva (§3). Если чего-то нет —
   **`throw` в любом окружении**, не только в production.
2. иначе если `SMS_ENDPOINT` непуст → обычный HTTP-провайдер.
3. иначе если `APP_ENV=production` и `DEMO_MODE` не `true` →
   **`throw`: «SMS_ENDPOINT must be configured in production»**.

`SMS_DRIVER` по умолчанию `http`. Значит **production с пустым `SMS_ENDPOINT`
не стартует.** Это не баг, а намеренная защита: развёртывание, которое не
может доставить код подтверждения, не может никого впустить.

Следствие для текущего состояния Railway: пока Viva не выдала креды и
`SMS_ENDPOINT` не задан, первый deploy упадёт в цикл рестартов на этом месте.
Решение — за владельцем, вариантов три:

* задать `SMS_ENDPOINT` на Contabo-шлюз, когда он поднят (Viva-креды всё
  равно понадобятся для реальной отправки);
* временно поднять `APP_ENV=staging` — тогда вместо `throw` включается
  `UnavailableSmsProvider` (отправки честно падают, но сервис живёт);
* дождаться Viva и включить `SMS_DRIVER=viva` сразу.

**Заглушку `SMS_ENDPOINT` ставить нельзя**: она уберёт единственный сигнал
о том, что production не умеет отправлять SMS.

---

## 3. Viva — контракт (значения вводит владелец после получения от Viva)

Включается только `SMS_DRIVER=viva`. Обязательны все (`missingVivaSettings`):

| Переменная | Что это | Откуда значение |
|---|---|---|
| `SMS_ENDPOINT` | базовый URL Viva или Contabo-шлюза | владелец |
| `SMS_VIVA_CLIENT_ID` | **секрет** | ⛔ ТОЛЬКО от Viva |
| `SMS_VIVA_CLIENT_SECRET` | **секрет** | ⛔ ТОЛЬКО от Viva |
| `SMS_USERNAME` | **секрет** | ⛔ ТОЛЬКО от Viva |
| `SMS_TOKEN` | **секрет** | ⛔ ТОЛЬКО от Viva |
| `SMS_SENDER` | имя отправителя | согласовано: `TuTak` |
| `SMS_VIVA_TEMPLATE_NAME` | имя шаблона | ⛔ уточнить у Viva |
| `SMS_VIVA_NUMBER_FORMAT` | `national` \| `msisdn` \| `e164` | ⛔ уточнить у Viva — **умолчания нет намеренно** |

Необязательные, с умолчаниями:

| Переменная | Умолчание | Смысл |
|---|---|---|
| `SMS_VIVA_SEND_UTF` | вкл. (выкл. только при `0`) | кодировка |
| `SMS_VIVA_TOKEN_PLACEMENT` | `bearer` | где едет токен |
| `SMS_VIVA_GATEWAY_SECRET` | пусто | HMAC для Contabo-шлюза; пусто = шлюза перед Viva нет |

**Почему у `SMS_VIVA_NUMBER_FORMAT` нет умолчания** (комментарий в коде):
номер в форме, которую Viva не распознаёт, принимается в пакет и **никогда не
доставляется** — отказ без единого симптома, кроме «клиенту не пришёл код».
Поэтому формат надо получить от Viva, а не угадать.

⛔ **Ни один секрет из этой таблицы не должен попасть в git, в отчёт или в
лог.** Вводятся только в переменные Railway владельцем.

---

## 4. Cookie / SameSite — тихий блокер admin и partner

`AUTH_COOKIE_SAMESITE` по умолчанию `strict`.

`railway.app` — как и `onrender.com` — входит в **Public Suffix List**. Значит
API на `<a>.up.railway.app` и админка на `<b>.up.railway.app` — **разные
сайты**, и refresh-cookie при `strict` браузером не отправляется никогда.

Симптом: вход проходит, а через ~15 минут (истечение access-токена) сессия
умирает и пользователя выбрасывает на логин. В логах — ничего.

* На сгенерированных доменах `*.up.railway.app` → `AUTH_COOKIE_SAMESITE=none`
  (тогда автоматически включается `Secure`).
* На своих доменах под одним registrable-доменом (`api.tutak.am` +
  `admin.tutak.am`) → можно оставить `strict` и сохранить защиту от CSRF.

---

## 5. Порядок первого запуска (домена ещё нет)

Публичный URL Railway появляется **только после первого успешного deploy**, а
`NEXT_PUBLIC_API_BASE_URL` у admin/partner — **build-time** переменная
(инлайнится в бандл и в `connect-src` CSP). Отсюда обязательный порядок:

1. Поднять **API** (`TuTak-Platform`). Получить сгенерированный домен.
2. Задать на API: `MEDIA_PUBLIC_BASE_URL` = этот домен;
   `CORS_ORIGINS` = будущие домены admin и partner;
   `AUTH_COOKIE_SAMESITE=none` (если домены сгенерированные).
3. Задать `NEXT_PUBLIC_API_BASE_URL=<домен API>/v1` на admin и partner и
   **пересобрать их** — Railway пробрасывает переменные сервиса в `ARG`,
   которые объявлены в их Dockerfile.
4. Замерить `CLIENT_IP_TRUSTED_HOPS` и включить `CLIENT_IP_STRATEGY=xff-depth`
   (процедура — `RAILWAY_PRODUCTION_RUNBOOK_RU.md §9`).
5. Мобильный APK пересобрать с `API_BASE_URL=<домен API>/v1`.

`NEXT_PUBLIC_API_BASE_URL` не имеет fallback намеренно: сборка без него
**падает** (`ApiBaseUrlNotConfiguredError`), потому что тихо собранный бандл
получил бы CSP, запрещающий собственный API.

---

## 6. Что делает `SEED_BASELINE=true`

`docker-entrypoint.sh` → `dist/scripts/seed-baseline.js`. Создаёт **только**:

* все `Permission`;
* все `Role` с их грантами;
* одного супер-администратора `+37400000000` / `admin@tutak.am`
  с `mustChangePassword: true`.

**Не создаёт** партнёров, кошельков, покупок, скидок, рефералов, платежей —
ничего бизнесового. Демо-данные живут за отдельным флагом `DEMO_SEED`,
который в production **не должен появляться никогда**.

Идемпотентность: все записи через `upsert`, у пользователя `update: {}` —
существующему администратору пароль **не перезаписывается**. Повторный запуск
безопасен.

После первого успешного входа и смены пароля `SEED_BASELINE` можно выключить.

---

## 7. Миграции

`docker-entrypoint.sh` выполняет `prisma migrate deploy` на **каждом** старте,
до запуска процесса. Команда применяет только неприменённые миграции по
порядку и отказывается при drift — не генерирует и не диффит. Безопасна при
rolling deploy: второй инстанс не находит ничего и выходит сразу.
