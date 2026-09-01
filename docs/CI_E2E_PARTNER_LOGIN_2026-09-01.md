# Зелёный CI: почему падал вход партнёра и что исправлено

Дата: 2026-09-01. Ветка `claude/tutak-loyalty-mvp-e485jm`.

## Итог

**CI полностью зелёный** на SHA `6fe89b4`.
Run **33543390698** — https://github.com/arman119090-cmyk/TuTak-Platform/actions/runs/33543390698

Оба job'а и все шаги — success, включая `End-to-end tests`,
`Drive the built mobile app against the stack` и `Backup and restore rehearsal`.

## 1. Первопричина: политика безопасности запрещала дашборду его собственный API

Проблема была **не** в логике входа.

`apps/partner/next.config.ts` считал строку `http://localhost:4000/v1` признаком
«API никто не настроил» — потому что ровно это значение стояло по умолчанию в
`ARG NEXT_PUBLIC_API_BASE_URL` в Dockerfile, а сборка на Render (где
`NEXT_PUBLIC_API_BASE_URL` — runtime-переменная и до Docker как build-arg не
доходит) иначе получала бы её как «настоящую».

Следствие: сборка, которой localhost был нужен по-настоящему (демо-стек
`docker-compose`, и CI, который этот стек поднимает и водит по нему браузер),
получала `Content-Security-Policy` с адресом Render-staging, тогда как runtime-конфиг
той же страницы указывал на localhost. Браузер отказывал приложению в его же
запросе на вход:

```
Refused to connect to 'http://localhost:4000/v1/auth/login' because it violates
the following Content Security Policy directive:
"connect-src 'self' https://tutak-staging-api.onrender.com"

[requestfailed] POST http://localhost:4000/v1/auth/login :: csp
final url: http://localhost:3001/login
form error: "Cannot reach the staging API. This is a deployment configuration
             issue, not a password error."
```

**Воспроизведено локально**, не по догадке: production-сборка партнёрского
приложения (`NODE_ENV=production`, `NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/v1`),
поднятый локально API + Postgres + Redis с демо-сидом, реальный Chromium.
Заголовок отданной страницы:

```
connect-src 'self' https://tutak-staging-api.onrender.com
```

**Почему падал только партнёр, а админка проходила:** `apps/admin/next.config.ts`
берёт переменную как есть (`process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/v1'`).
Механизм «localhost = не настроено» существовал только в партнёрском приложении.

### Как исправлено

«Не задано» теперь означает «не задано»:

- `ARG NEXT_PUBLIC_API_BASE_URL` в `apps/partner/Dockerfile` по умолчанию **пустой**;
- разрешение адреса вынесено в один модуль `apps/partner/api-base-url.mjs`,
  которым пользуются обе половины (CSP в `next.config.ts` и клиент в `httpClient.ts`);
- CI **явно передаёт** build-arg с адресом API, к которому он же и подключает
  образы;
- Render, который build-arg не передаёт, по-прежнему уходит на staging-API —
  поведение не изменилось.

Регрессионный тест `apps/partner/api-base-url.test.mjs` (запускается в
`pnpm --filter @tutak/partner test`, то есть в существующем шаге CI): явно
заданный URL — включая localhost — используется как есть; пустое значение в
production-сборке даёт staging; пустое в dev-сборке даёт localhost.

## 2. Второй дефект: тест читал токен из localStorage, которого больше нет

`tokenFrom(PARTNER_STATE, 'tutak-partner-auth')` читал access-токен из
`localStorage` внутри `storageState`. Дашборды перестали его туда писать: токен
живёт только в памяти, refresh-токен — в httpOnly-cookie. Тест проверял модель
хранения, от которой приложения намеренно отказались, и упал бы даже после
починки редиректа.

Теперь токен возвращается из ответа `POST /v1/auth/login` внутри setup-процесса и
пишется прямо в `TOKENS_FILE`. Refresh-cookie переносится через `storageState`.
Зависимости от `tutak-admin-auth` / `tutak-partner-auth` в тестах не осталось.

## 3. Третий дефект: повтор одной refresh-cookie между тестами

После починки первых двух три сценария в `money-movement` всё ещё падали:
контексты Playwright предъявляли одну и ту же сохранённую cookie. Ротация
refresh-токена расценивает второе использование как кражу и отзывает всё
семейство устройства (`refresh_token_reuse`) — **это контроль работает как
задумано**. Файл состояния теперь «катится вперёд»: каждый тест дописывает
cookie, которую получил его собственный refresh (`tests/e2e/fixtures.ts`).

## 4. Четвёртый дефект: проверка готовности мобильного бандла искала старый заголовок

Шаг `Drive the built mobile app against the stack` не выполнялся с 30 августа —
он стоит за упавшим e2e. Когда e2e позеленел, шаг запустился и упал.

Промежуточный коммит `2131a06` объяснил это медленным бандлером и поднял
таймаут до 15 минут — **это было неверно**, и следующий прогон истратил все 15.
Лог, который шаг печатает при сдаче, начинается с того, что ему отдавали всё это
время:

```
<title>TuTak (development)</title>
...
Web Bundled 17948ms apps/mobile/index.ts (1570 modules)
```

Проверка искала буквальное `<title>TuTak</title>`. `app.config.js` намеренно
добавляет суффикс окружения любой не-production сборке, а `mobile-web-serve.sh`
экспортирует с `APP_ENV=development`, чтобы был разрешён loopback-API. Приложение
поднималось за 18 секунд, а цикл ждал заголовок, которого больше нет.

Исправлено: проверка допускает суффикс окружения (`<title>TuTak( (...))?</title>`),
бюджет возвращён к пяти минутам. Защита от того, ради чего проверка написана,
сохранена — когда-то на этом порту отвечал листинг каталога с заголовком
`Index of /`.

## Изменённые файлы

**Новые:**
- `apps/partner/api-base-url.mjs`
- `apps/partner/api-base-url.test.mjs`
- `tests/e2e/fixtures.ts`

**Изменённые:**
- `apps/partner/next.config.ts`
- `apps/partner/src/lib/httpClient.ts`
- `apps/partner/Dockerfile`
- `apps/partner/package.json`
- `.github/workflows/ci.yml`
- `tests/e2e/helpers.ts`
- `tests/e2e/auth.setup.ts`
- `tests/e2e/loyalty-loop.e2e.ts`
- `tests/e2e/money-movement.e2e.ts`

Итого: 12 файлов, +333 / −84.

## Коммиты

```
6fe89b4  Look for the title the mobile bundle actually serves
2131a06  Wait long enough for the mobile bundle to actually finish   (ошибочная гипотеза, исправлена в 6fe89b4)
ff3f047  Let the partner dashboard talk to the API it was built for
```

Финальный SHA: **`6fe89b4`**.

## Результаты

### Локально (реальный стек: Postgres + Redis + API + обе production-сборки дашбордов)

```
npx playwright test --config tests/e2e/playwright.config.ts
  1 setup + 11 e2e passed, 1 skipped (mobile-demo — нужен MOBILE_WEB_URL,
                                      в CI он запускается отдельным шагом)
  12 passed (18.3s)
```

Ключевые строки: вход админа и вход партнёра проходят, экран `/ledger` и
`/earnings` рендерятся с данными.

```
eslint apps packages tests scripts        чисто
tsc --noEmit (apps/partner)               чисто
tsc --noEmit (tests/e2e)                  чисто
@tutak/admin test                          9 наборов / 60 тестов
@tutak/partner test                        9 наборов / 62 теста + 3 node --test
```

### CI — run 33543390698, SHA `6fe89b4`

Job **Lint, test and build** — success:

```
Lint                                              ✓
Typecheck                                         ✓
Sentry sanitizer parity                           ✓
Dependency audit (advisory only)                  ✓
Unit tests                                        ✓
Integration tests                                 ✓  (7 мин 37 с)
Migration drift check                             ✓
Mobile tests                                      ✓
The demo app matches the app it was generated from ✓
Admin dashboard tests                             ✓
Partner dashboard tests                           ✓
Build all applications                            ✓
```

Job **Build the container images** — success:

```
API image / Admin image / Partner image           ✓
Boot the whole stack and seed it                  ✓
End-to-end tests                                  ✓  (57 с)
Drive the built mobile app against the stack      ✓  (44 с — 13-й сценарий)
Backup and restore rehearsal                      ✓
```

Все 13 сценариев Playwright пройдены: 12 в шаге `End-to-end tests`
(`mobile-demo` там пропускается по своему `test.skip`, как и задумано) и
13-й — `mobile-demo` — в шаге `Drive the built mobile app`, с поднятым бандлом.

Ни один существующий шаг не удалён и не ослаблен. `continue-on-error`, `|| true`
и пропуски тестов не использовались. Единственный уже существовавший
`continue-on-error` — на шаге `Dependency audit (advisory only)` — не трогался.

## Production-авторизация не ослаблена — отдельно

- В `apps/api` не изменено **ни одной строки**. Логика логина, ротация
  refresh-токенов, обнаружение повторного использования, rate limit, RBAC,
  branch-scoping — не тронуты.
- Rate limit `/auth/login` (5 попыток в минуту с адреса) сохранён. Более того,
  тест теперь **тратит меньше** попыток: повтор делается только на 429, а не на
  любой ошибке — раньше неверный ответ повторялся четырежды и съедал четыре из
  пяти попыток.
- Обхода авторизации в тестах не добавлено: вход по-прежнему идёт через
  настоящую форму в настоящем браузере, токен берётся из ответа сервера, а не
  подставляется в хранилище.
- Ротация refresh-токена и отзыв семейства при повторном использовании остались
  как есть — под них подстроился тест, а не наоборот.
- В партнёрском приложении изменено только то, **какой адрес API считается
  настроенным**. CSP не ослаблена: `connect-src` по-прежнему называет ровно один
  API — тот, к которому сборка обращается.
- Диагностика при падении входа печатает HTTP-статус, видимый текст ошибки и
  URL. Пароль, cookie и токены не печатаются никогда.
