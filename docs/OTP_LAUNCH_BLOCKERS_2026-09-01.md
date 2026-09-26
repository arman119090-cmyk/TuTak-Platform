# Закрытие OTP launch blockers — отчёт

**SHA `5d86ff8`**, ветка `claude/tutak-loyalty-mvp-e485jm`. **Не задеплоено.**

## 1. Классификация окружения

`NODE_ENV` теперь `production` для всего развёрнутого; `APP_ENV` говорит, какое
это развёртывание. Два предиката (`config/app-environment.ts`) заменили
разрозненные сравнения строк: `isPublicDeployment` (staging или production) —
сетевые контроли, `isProductionDeployment` — коммерческие требования.

### Аудит: что меняется на staging

| Охранник | Было | Стало | Эффект на staging |
|---|---|---|---|
| SMS-оператор | production | публичное | **теперь отказ вместо консоли** |
| `REDIS_URL` обязателен | production | публичное | **теперь обязателен** (в blueprint есть) |
| Регистрация по паролю | production | публичное | **теперь запрещена**, как в проде |
| CORS / Swagger выкл. | prod\|staging | публичное | без изменений |
| PSP (эквайер) | production | **только production** | без изменений |
| Push-credentials | production | **только production** | без изменений |
| Media S3 + base URL | production | **только production** | без изменений |
| Метка окружения в алертах | `NODE_ENV` | `APP_ENV` | пишет `staging`, а не `production` |
| JSON-логи | `NODE_ENV` | `NODE_ENV` | **теперь включены** на staging |
| `sentry-verify` | `NODE_ENV` | не тронут | без изменений |

## 2. Утечка через ConsoleSmsProvider закрыта

Консольный транспорт — только dev и тесты. Для публичного развёртывания он
**недостижим ни при какой конфигурации, включая `DEMO_MODE=true`** — это была та
самая дыра. Без оператора публичное развёртывание получает
`UnavailableSmsProvider`: любая отправка падает с одинаковым «temporarily
unavailable», в лог идёт факт отсутствия оператора, не тело сообщения.
Production по-прежнему отказывается стартовать без оператора.

Выбор транспорта вынесен в чистую `selectSmsTransport()` и проверен для всех
комбинаций окружения и `DEMO_MODE`.

Покрыты **все** отправители SMS: они инжектят один токен `SMS_PROVIDER` —
регистрация, вход, верификация телефона, сброс пароля (последние два проверены
по идентичности инстанса провайдера).

## 3. Клиентский IP

`render.com` и `community.render.com` заблокированы egress-политикой —
первоисточник прочитать не удалось. Из доступных источников подтверждено:
**Render не вырезает входящий `X-Forwarded-For`, а дописывает свой хоп**, то есть
левое значение пишет атакующий.

- `TRUST_PROXY` не применяется — он называет адрес прокси, который сам вычищает
  заголовок; Render так не делает.
- **`CF-Connecting-IP` не используется** — не подтверждено, что каждый запрос
  обязательно идёт через Cloudflare с перезаписью заголовка. Неподтверждённый
  заголовок хуже адреса сокета: выглядит авторитетно, а подделывается.
- `CLIENT_IP_STRATEGY=xff-depth` + измеренное число хопов, отсчёт справа. Число
  **отвергается, а не подставляется по умолчанию**: завышение на единицу выбирает
  адрес атакующего.

Тесты (`config/client-ip.spec.ts`, против реального Express): отсутствующий
заголовок, подделанный, валидный и завышенный счётчик. **Тесты поймали ошибку на
единицу в моей собственной модели** — Express считает сокет первым доверенным
хопом, поэтому за одним балансировщиком значение равно 1, а не числу записей в
заголовке; исправлены и код-комментарии, и ожидания.

Без настройки лимиты по IP **отключаются**, а не схлопываются в один общий
бюджет — это устраняет самоблокировку, которую создал бы предыдущий коммит на
Render.

## 4. Глобальный бюджет SMS

`SmsBudgetService` — в слое отправки, атомарные счётчики Redis (pipeline,
`INCR` + `EXPIRE NX`), часовое и суточное окна, лимиты из конфигурации.
**Падает закрыто**: без Redis отправка запрещена. Это осознанно противоположно
лимитеру по IP — там ослабленный контроль, здесь неограниченный счёт от
оператора связи.

### Переменные для Render

```
NODE_ENV=production            # значение фиксировано в render.yaml
APP_ENV=staging                # значение фиксировано в render.yaml
SMS_GLOBAL_MAX_PER_HOUR=500    # оператор
SMS_GLOBAL_MAX_PER_DAY=5000    # оператор
SMS_ENDPOINT=<...>             # оператор; без него отправка отдаёт 503
CLIENT_IP_STRATEGY=xff-depth   # оператор, только после измерения
CLIENT_IP_TRUSTED_HOPS=<N>     # оператор, измеренное значение
REDIS_URL / DATABASE_URL       # из blueprint
CORS_ORIGINS                   # оператор
```

## 5. Результаты проверки

```
typecheck   чисто
lint        чисто
unit        421/421 (29 наборов)
integration 1075/1075 (79 наборов)
```

### Изменённые файлы

**Новые:**
- `apps/api/src/config/app-environment.ts`
- `apps/api/src/config/client-ip.ts`
- `apps/api/src/config/client-ip.spec.ts`
- `apps/api/src/infrastructure/sms/sms-budget.service.ts`
- `apps/api/src/infrastructure/sms/budgeted-sms.provider.ts`
- `apps/api/src/infrastructure/sms/unavailable-sms.provider.ts`
- `apps/api/src/infrastructure/sms/sms-transport.ts`
- `apps/api/test/sms-budget.int-spec.ts`

**Изменённые:**
- `apps/api/src/config/configuration.ts`
- `apps/api/src/main.ts`
- `apps/api/src/infrastructure/sms/sms.module.ts`
- `apps/api/src/infrastructure/sms/console-sms.provider.ts`
- `apps/api/src/infrastructure/push/push.module.ts`
- `apps/api/src/infrastructure/redis/redis.module.ts`
- `apps/api/src/infrastructure/media/media-storage.module.ts`
- `apps/api/src/infrastructure/alerts/alerts.module.ts`
- `apps/api/src/modules/payments/payments.module.ts`
- `apps/api/src/modules/auth/auth.service.ts`
- `apps/api/src/modules/auth/otp-ip-rate-limit.service.ts`
- `apps/api/test/auth-otp.int-spec.ts`
- `apps/api/test/auth-otp-hardening.int-spec.ts`
- `apps/api/test/setup/jest-setup.ts`
- `render.yaml`
- `apps/api/.env.example`
- `docs/RENDER_STAGING_RU.md`

## Чеклист Render

1. Задать в дашборде: `SMS_ENDPOINT` (+ учётные данные), `CORS_ORIGINS`,
   `SMS_GLOBAL_MAX_PER_HOUR`, `SMS_GLOBAL_MAX_PER_DAY`.
   `CLIENT_IP_STRATEGY` пока **не задавать**.
2. Задеплоить. Проверить в логах строку
   `Neither CLIENT_IP_STRATEGY nor TRUST_PROXY is set` — на этом шаге ожидаемо.
3. Измерить хопы по процедуре в `docs/RENDER_STAGING_RU.md` (запрос с
   подделанным `X-Forwarded-For`, посмотреть, что реально дошло до приложения).
4. Задать `CLIENT_IP_STRATEGY=xff-depth` и измеренный `CLIENT_IP_TRUSTED_HOPS`.
   Убедиться, что подделка заголовка не даёт свежий лимит.
5. Проверить живьём:
   - `request-otp` не содержит кода;
   - `/notifications/me` не содержит кода;
   - ответ для существующего и несуществующего номера идентичен;
   - без `SMS_ENDPOINT` приходит 503, а не код в логе.

## Статус

**Staging остаётся непроверенным.** Деплой из сессии невозможен: egress к
`onrender.com` заблокирован (403 на CONNECT), креденшелов Render нет.
Пункты 1–2 отчёта `docs/STAGING_VERIFICATION_OTP_2026-09-01.md` закрытыми не
считаются.
