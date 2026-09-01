# Render staging: безопасный первый деплой

Корневой `render.yaml` описывает staging без `DEMO_MODE` и `DEMO_SEED`.
Никакого deploy этой задачей не выполняется.

## 1. Sentry для первого staging

Первый staging должен собираться и запускаться **без `SENTRY_AUTH_TOKEN` и без
загрузки source maps**.

Для API используется runtime-переменная `SENTRY_DSN`. Для admin и partner
оставлены `NEXT_PUBLIC_SENTRY_DSN` и `NEXT_PUBLIC_SENTRY_ENVIRONMENT=staging`.
DSN не является секретом. Если build-система не передаст `NEXT_PUBLIC_*` во
время `docker build`, образ всё равно должен успешно собраться: DSN по
умолчанию пустой, а environment в Dockerfile по умолчанию `staging`.

Не считать подтверждённым механизмом предположение, что runtime env Render
автоматически становится Docker `ARG`. Поэтому критические условия первого
деплоя не зависят от такого поведения.

`GIT_COMMIT_SHA` остаётся build-time входом в Dockerfile и используется для
Sentry release, когда сборочная система действительно передаёт его. При его
отсутствии release будет `unknown`; это не должно ломать сборку или запуск.
Для API `docker-entrypoint.sh` отдельно умеет взять runtime
`RENDER_GIT_COMMIT`, если `GIT_COMMIT_SHA` не задан.

`SENTRY_AUTH_TOKEN`, `SENTRY_ORG` и `SENTRY_PROJECT` отсутствуют в
`render.yaml` для admin/partner. Source maps в `next.config.ts` явно отключены
через `sourcemaps.disable: true`.

Будущая безопасная реализация source maps вынесена в
`docs/SENTRY_SOURCEMAPS_FUTURE_RU.md`.

## 2. Baseline seed

`SEED_BASELINE=true` разрешён только как bootstrap свежей staging-базы.
Он создаёт:

- permissions;
- roles и связи role-permission;
- одного временного super admin;
- связь этого admin с ролью SUPER_ADMIN.

Он **не должен** создавать партнёров, wallet, referral code, покупки,
скидки, рефералы, платежи, settlements или любые иные бизнес-данные.
Это дополнительно покрыто unit-тестом `seed-baseline.spec.ts`.

`SEED_ADMIN_PASSWORD` должен быть не короче 12 символов. Администратор
создаётся с `mustChangePassword=true`.

После первого успешного входа обязательно:

1. сменить пароль временного администратора;
2. установить `SEED_BASELINE=false` в Render;
3. только после этого считать bootstrap завершённым.

Повторный запуск baseline не меняет пароль уже существующего администратора,
но после bootstrap флаг всё равно должен быть выключен.

## 3. Переменные Render

### API

- `NODE_ENV=staging`
- `PORT=4000`
- `DATABASE_URL` из staging Postgres
- `REDIS_URL` из staging Redis
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` — generated
- `SEED_BASELINE=true` только до завершения bootstrap
- `SEED_ADMIN_PASSWORD` — generated
- `CORS_ORIGINS` — `sync: false`
- `TRUST_PROXY` — `sync: false`
- `SWEEPS_ENABLED=true`
- `QUEUE_PREFIX=tutak-staging`
- `SENTRY_DSN` — `sync: false`
- `RESET_STAGING_ADMIN_PASSWORD` — **в `render.yaml` отсутствует намеренно**.
  Оператор добавляет её вручную только на время восстановления доступа и
  удаляет сразу после (§4). Переменная, живущая в blueprint, пережила бы
  восстановление и сбрасывала бы пароль при каждом рестарте.

### Admin / Partner

- `NODE_ENV=production` — режим `next start`, не название среды
- `APP_ENV=staging`
- `PORT=3000` / `3001`
- `NEXT_PUBLIC_API_BASE_URL` — значение нужно при сборке для рабочего клиента
- `NEXT_PUBLIC_SENTRY_DSN` — значение нужно при сборке для Sentry клиента
- `NEXT_PUBLIC_SENTRY_ENVIRONMENT=staging`
- `SENTRY_VERIFY_ENABLED` — runtime opt-in
- `SENTRY_VERIFY_TOKEN` — generated

Запрещено добавлять в runtime Render для этих сервисов:

- `SENTRY_AUTH_TOKEN`
- любые будущие upload credentials для source maps

## 4. Восстановление доступа super-admin (staging)

Нужно только тогда, когда войти временным администратором больше нельзя:
пароль потерян, скомпрометирован или аккаунт заблокирован после неудачных
попыток. Обычный `SEED_BASELINE=true` эту проблему не решает **намеренно**:
повторный baseline не переписывает пароль уже существующего администратора,
и это правильно — сид, который сбрасывал бы учётные данные при каждом
рестарте, был бы постоянным чёрным ходом размером ровно с доступ к
переменным окружения.

Поэтому существует отдельный путь: `apps/api/src/scripts/reset-staging-admin-password.ts`,
который запускается из `docker-entrypoint.sh` и только при выполнении **всех**
условий:

| Условие | Значение |
|---|---|
| `NODE_ENV` | ровно `staging` |
| `RESET_STAGING_ADMIN_PASSWORD` | ровно `true` |
| `SEED_ADMIN_PASSWORD` | задан, не короче 12 символов |
| Аккаунт | только `+37400000000`, никакой другой |

Если флаг включён, а `NODE_ENV` не `staging` — контейнер **отказывается
стартовать** и пишет причину в лог. Проверка стоит дважды: в самом
`docker-entrypoint.sh` и внутри скрипта.

Скрипт меняет только состояние аутентификации: `passwordHash`,
`mustChangePassword=true`, `failedLoginCount=0`, `lockedUntil=null` — и
отзывает действующие refresh-токены этого пользователя, чтобы сессия,
открытая скомпрометированным паролем, не пережила его замену. Партнёров,
кошельков, реферальных кодов, покупок, платежей, расчётов и любых иных
бизнес-строк он не создаёт и не изменяет; за этим следит
`reset-staging-admin-password.spec.ts`, который падает при обращении к любой
другой таблице. Ни пароль, ни его хеш никогда не попадают в лог.

### Процедура

1. **Оператор вручную меняет `SEED_ADMIN_PASSWORD`** в Render, у сервиса
   `tutak-staging-api`, на новое случайное значение (не короче 12 символов).
   Старое считается скомпрометированным.
2. **Ставит `RESET_STAGING_ADMIN_PASSWORD=true`** там же.
3. **Deploy.** В логах должно появиться:
   `Bootstrap administrator (+37400000000) recovered: … N refresh token(s) revoked.`
4. **Сразу же удаляет `RESET_STAGING_ADMIN_PASSWORD`** (или ставит `false`).
   Флаг не должен пережить восстановление.
5. **Ещё один deploy** — чтобы сервис работал уже без флага.
6. **Вход** новым временным паролем.
7. **Смена пароля** через приложение: аккаунт помечен `mustChangePassword`,
   система потребует этого сама.
8. **`SEED_BASELINE=false`**, если он ещё включён.

Шаги 4–5 не косметические: пока флаг стоит, каждый рестарт контейнера снова
сбрасывает пароль администратора на значение `SEED_ADMIN_PASSWORD` — то есть
смена пароля из шага 7 будет молча отменена следующим перезапуском.

## 5. Перед Apply

Проверить, что:

- в `render.yaml` нет `SENTRY_AUTH_TOKEN`;
- в admin/partner `next.config.ts` стоит `sourcemaps.disable: true`;
- Dockerfile не содержит `ARG SENTRY_AUTH_TOKEN`;
- baseline seed не пишет в business tables;
- после bootstrap есть операционная инструкция выключить `SEED_BASELINE` и
  сменить пароль;
- `RESET_STAGING_ADMIN_PASSWORD` отсутствует в `render.yaml` и не задан ни
  одному сервису, пока восстановление доступа реально не понадобится.

Эта задача не выполняет Apply/Deploy и не меняет настройки Render.

## Клиентский IP на Render и как измерить CLIENT_IP_TRUSTED_HOPS

Render **не вырезает** входящий `X-Forwarded-For` — он дописывает свой хоп к
тому, что прислал клиент. Поэтому:

- **Левое значение подделывается кем угодно.** Брать его нельзя.
- `TRUST_PROXY` здесь неприменим: он называет адрес прокси, который сам
  вычищает заголовок. Render так не делает.
- `CF-Connecting-IP` не используется: не подтверждено из первоисточника, что
  каждый запрос обязательно проходит через Cloudflare и что заголовок
  перезаписывается на этом пути. Неподтверждённый заголовок хуже адреса
  сокета — выглядит авторитетно, а подделывается.

Используется `CLIENT_IP_STRATEGY=xff-depth` с числом доверенных хопов,
которое Express отсчитывает **справа**. Express считает сам сокет первым
хопом, поэтому за одним балансировщиком значение равно **1**, а не числу
записей в заголовке (это зафиксировано тестами в
`apps/api/src/config/client-ip.spec.ts`).

### Порядок измерения (обязателен до включения)

1. Оставить `CLIENT_IP_STRATEGY` **не заданным**. В этом состоянии лимиты по
   IP отключаются сами (иначе они схлопнутся в один общий бюджет и заблокируют
   всех), а расходы удерживает глобальный бюджет SMS.
2. С двух разных внешних адресов отправить запрос, подделав заголовок:
   `curl -H 'X-Forwarded-For: 9.9.9.9' https://<сервис>/health`.
3. Посмотреть в логах Render, какой `X-Forwarded-For` реально дошёл до
   приложения, и сколько записей в нём справа от `9.9.9.9`.
4. `CLIENT_IP_TRUSTED_HOPS` = это число (для одного балансировщика — 1).
5. Включить `CLIENT_IP_STRATEGY=xff-depth` и проверить: запрос с подделанным
   `X-Forwarded-For` **не должен** получать свежий лимит.

**Ошибка на единицу вверх опаснее, чем отсутствие настройки:** завышенный
счётчик выбирает адрес, который написал атакующий. Значение измеряют, а не
угадывают.
