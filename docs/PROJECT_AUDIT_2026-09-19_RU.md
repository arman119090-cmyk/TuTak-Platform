# Аудит проекта TuTak — 19.09.2026

## Задание

«Сделай аудит всего проекта: всех надписей, всего кода, Railway, всего,
что возможно. Найди проблемы, нестыковки, изъяны и, если можешь, исправляй».

## База

- Ветка аудита: `claude/project-audit` от `main` `369eda1`.
  Коммиты: `43266c5` (исправления), `8d19cd9` (tsconfig).
- Production: Railway, проект TuTak, окружение `production`, регион `sfo`.
- Параллельно открыты PR #58 (pilot readiness), PR #59 (premium visual),
  ветка `claude/ios-bootstrap` (iOS). Аудит смотрел на `main`; где дефект
  уже закрыт в одной из веток — сказано явно.

## Что проверено и как

| Область | Метод | Итог |
|---|---|---|
| Надписи мобильного (RU/HY/EN, 408 ключей × 3) | скрипт паритета ключей и плейсхолдеров; чтение всех 1224 строк глазами | ключи и `{{плейсхолдеры}}` совпадают во всех трёх; **7 дефектов армянского** — исправлены |
| Надписи admin/partner (425 строк UI) | извлечение JSX-текста; чтение | 1 разнобой орфографии (favor/favour) — исправлен; типовых опечаток нет |
| Строки вне i18n в мобильном | grep по кириллице/армянскому в .tsx | только названия языков в переключателе — норма |
| Код: typecheck / lint / тесты всех пакетов | `pnpm -r typecheck`, `pnpm -r lint`, jest mobile/api-unit/admin/partner, design tests, sentry-parity | всё зелёное (числа ниже) |
| Секреты в репозитории | grep по сигнатурам ключей, `.env` в git | **чисто**: только `.env.example`; совпадения — тест-фикстуры |
| TODO/FIXME, `console.log` в коде приложений | grep | 1 TODO (бизнес-решение по верификации домена партнёра); `console.log` только в CLI-скриптах |
| Соответствие путей клиент ↔ API | скрипт: 179 маршрутов API против вызовов admin/partner/mobile | расхождений нет (5 ложных срабатываний проверены руками) |
| Переменные окружения | имена из `configuration.ts` против `.env.example` | **42 настройки нигде не были описаны** — добавлены в `.env.example`; `REDIS_PASSWORD` в примере не читается кодом |
| Уязвимости зависимостей | `pnpm audit --prod` | было 23 high / 7 moderate → **стало 4 high / 1 moderate** (детали ниже) |
| Railway | сервисы, конфиг, домены, имена переменных, логи за 14–19.09 | см. раздел Railway |
| Живой стек | workflow «Check the deployed stack» (из этой среды `*.up.railway.app` закрыт прокси) | API `/health` 200, `/health/ready` 200 (db/redis/s3 ok), admin 200, partner 200 |
| Миграции / схема | `migrate deploy` на чистую БД, `migrate diff` | 71 миграция на `main`, diff чистый (проверялось сегодня в CI PR #59 — 74) |

## Что исправлено (в ветке `claude/project-audit`)

### 1. Армянские надписи (`packages/i18n/src/locales/hy.json`, демо перегенерировано)

| Ключ | Было | Стало | Почему |
|---|---|---|---|
| `qr.expiresIn` | Ավարտվում է {{time}}-ից | Կավարտվի {{time}} հետո | «-ից» = «от/с», а нужно «через» |
| `becomePartner.ratePreview` | …{{points}} բալ | …{{points}} միավոր | везде «միավոր», здесь одиноко «բալ» |
| `evStatus.SUSPENDED` | Դադարեցված | Կասեցված | «остановлено» ≠ «приостановлено» |
| `bonusEntryType.REVERSAL` | Հետ շրջված | Չեղարկված | калька «повёрнуто назад»; статус рядом уже «Չեղարկված» |
| `auth.otpSubtitle`, `auth.verifyPhoneSubtitle` | Մուտքագրեք {{phone}} ուղարկված 6 նիշանոց կոդը | Մուտքագրեք {{phone}} համարին ուղարկված 6-նիշանոց կոդը | не хватало «համարին» («на номер»); третья такая же строка была правильной |
| `settings.deleteAccountConfirmTitle` | Ջնջե՞լ հաշիվը։ | Ջնջե՞լ հաշիվը | вопросительный знак и точка одновременно |

Не трогал: `becomePartner.taxId` = «ՀՎՀՀ» во всех трёх языках на `main` —
уже исправлено в PR #59 («ИНН (ՀՎՀՀ)» / «Tax ID (ՀՎՀՀ)»).

### 2. Панель партнёра

`earnings/page.tsx`: «in their favor» → «favour» (остальной текст панелей
британский: centre, cancelled, itemised).

### 3. Prisma: устаревший `package.json#prisma`

Первая строка **каждого** запуска production-контейнера — предупреждение
«`package.json#prisma` is deprecated and will be removed in Prisma 7».
Добавлен `apps/api/prisma.config.ts` (schema, путь миграций, seed),
блок из package.json удалён, файл копируется в runtime-образ
(`Dockerfile`), исключён из build-typecheck (`tsconfig.build.json`).
Особенность: с конфигом Prisma CLI перестаёт сам читать `.env` — файл
подгружает `apps/api/.env`, если он есть (ноутбук), без новой зависимости
(`process.loadEnvFile`, Node ≥ 20.12; в Docker `node:20-alpine`).
Проверено локально: `prisma validate` пишет «Loaded Prisma config»,
`generate`, `migrate deploy`, `migrate diff`, `db seed` (доходит до
штатного отказа без `SEED_ADMIN_PASSWORD`) — предупреждения нет.

### 4. Уязвимые зависимости (`package.json` → `pnpm.overrides`, lockfile)

| Пакет | Где | Было → стало | Риск |
|---|---|---|---|
| `qs` | express 5 → **API в production** | 6.15.3 → 6.16.0 | DoS через разбор query (moderate) — закрыт |
| `@xmldom/xmldom` | `@expo/plist` (инструменты сборки, не рантайм) | 0.8.13/0.9.10 → 0.8.15/0.9.12 | 8 advisories — закрыты |
| `image-size` | metro (инструмент сборки) | 1.2.1, **патча нет** | high, DoS на ICNS/JXL — только dev-инструмент |
| `decode-uri-component` | query-string 7 ← react-navigation (рантайм mobile) | 0.2.2; патч 0.5.0 — другая мажорная линия, `query-string` его не поддерживает | moderate, DoS на deep-link с испорченным percent-encoding; ждать обновления react-navigation |

После правок API unit 691/691, typecheck 0.

### 5. `.env.example` API

Добавлен блок «Everything else configuration.ts reads» — 42 имени с
дефолтами (retention, purchase pool bps, OCPI, OTEL, PSP, SMS/Viva…).

## Что найдено и НЕ исправлено (решение владельца или отдельная задача)

### Railway / production

1. **Sentry не подключён ни к одному сервису.** В переменных `tutak-api`,
   `tutak-admin`, `tutak-partner` нет `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`.
   Код готов (см. `docs/SENTRY_SETUP.md`), но ошибки production сейчас
   никуда не уходят — только логи Railway.
2. **«Wait for CI» не включён**: `checkSuites: false` у `tutak-api` (и,
   судя по всему, у панелей). Деплой из `main` идёт сразу после push, не
   дожидаясь зелёного CI. PR #58 об этом просил — не сделано.
3. **`SEED_BASELINE` и `SEED_ADMIN_PASSWORD` по-прежнему заданы в
   production** — известный долг из отчёта 10.09: после первого входа
   пароль ротировать, флаг снять.
4. **Регион `sfo` (Сан-Франциско)** для всех сервисов и бакет `tutak-media`
   в `sjc` при аудитории в Армении: +150–200 мс на каждый запрос. Railway
   даёт `europe-west4` (Амстердам) — перенос данных отдельная операция.
5. **SMS**: с 16.09 14:30 UTC шлюз отвечает `tunnel_down`, отправок с тех
   пор не было (`docs/SMS_STATUS_CHECK_2026-09-19.md`). Мониторинга
   туннеля нет.
6. Резервные копии Postgres: workflow `backup.yml` есть только в PR #58 и
   требует `RAILWAY_API_TOKEN` — пока не работает.
7. Один инстанс каждого сервиса, `restartPolicy: ALWAYS`, healthcheck
   `/health/ready` (120 с) — для пилота нормально.

### Нестыковки в репозитории

8. `apps/mobile/eas.json`: профиль **`staging` указывает на production API**
   (`tutak-api-production…`). Staging-окружения нет; профиль вводит в
   заблуждение — либо удалить, либо завести staging.
9. Демо-приложение генерируется с `userInterfaceStyle: 'dark'` и тёмным
   splash `#0A0A0F`, тогда как основное приложение light-only. Владелец
   ставит демо-APK и видит тёмный splash, которого в продукте нет.
10. `EvHistoryScreen` зарегистрирован в навигаторе, но ни один экран на
    него не ведёт (из отчёта по финальной доводке).
11. 57 ключей i18n не используются мобильным приложением (например,
    `admin.*`, `partner.*`, часть `ev.*`, `qr.*`); часть из них читает
    партнёрская панель через `@tutak/i18n` (`unitOfMeasure.*`), поэтому
    удалять пакетно нельзя — нужна ручная чистка.
12. `common.amd` = «AMD» по-русски и по-английски, «դրամ» по-армянски —
    ключ нигде не используется; при использовании стоит унифицировать.
13. `.env.example`: `REDIS_PASSWORD` описан, но кодом не читается (Redis
    берётся из `REDIS_URL`).
14. Ветка по умолчанию репозитория — `claude/tutak-loyalty-mvp-e485jm`
    (245 коммитов позади `main`); она нужна только как «реестр» workflow
    для `workflow_dispatch`. Это работает, но каждый новый workflow надо
    копировать туда отдельным коммитом (сегодня так зарегистрированы
    iOS-workflow). Переключить default branch на `main` — одно действие в
    настройках GitHub, и костыль исчезнет.
15. Единственный `TODO` в коде — `partner-integrations.service.ts`:
    метод верификации домена партнёра не выбран (DNS TXT / файл / ручная).

### Код (наблюдения без изменений)

- Глобальные guard'ы API: throttling по IP, JWT, роли, permissions,
  ротация пароля — все пять через `APP_GUARD`; `@Public()` только на 24
  ожидаемых маршрутах (auth, PSP callback, публичная раздача медиа).
- `ValidationPipe` с `whitelist` + `forbidNonWhitelisted`; два `@Body()`
  без DTO — PSP callback (сырой payload провайдера, проверяется подписью)
  и customer-balance (проверить отдельно).
- Helmet, CORS по списку из `CORS_ORIGINS` с отказом в production при
  пустом списке, `trust proxy` по `CLIENT_IP_STRATEGY` — на месте.

## Чем доказано

| Проверка | Результат |
|---|---|
| `pnpm -r typecheck` (после `prisma generate` под `main`) | 0 (первый прогон падал из-за Prisma-клиента от другой ветки — среда, не код) |
| `pnpm -r lint` | 0 |
| mobile jest | 64 suites, 530/530 |
| API unit (после overrides) | 50 suites, 691/691; tsc build+spec 0 |
| admin jest | 112/112 (сегодня, PR #59) |
| partner jest | 13 suites, 92/92 |
| design tests, sentry-parity | ok |
| demo parity | перегенерирован, закоммичен |
| `pnpm audit --prod` | 4 high / 1 moderate (было 23 / 7) |
| Deployed stack check (workflow run 35447934221) | 4 × HTTP 200 |
| CI на ветке аудита | см. конец отчёта |

## Что осталось непроверенным (UNVERIFIED)

- Значения переменных Railway (только имена видны): корректность
  `CORS_ORIGINS`, `MEDIA_PUBLIC_BASE_URL`, лимитов SMS.
- Заголовки безопасности и CORS живого API — из этой среды недоступны.
- Функциональный прогон панелей admin/partner руками.
- Поведение `prisma.config.ts` в Docker-сборке на Railway (локально
  проверено CLI; образ не собирался).
- `image-size`/`decode-uri-component` — влияния на production нет по
  анализу путей зависимостей, но не проверено эксплуатационно.
- Документы в `docs/` (более 100 файлов) на актуальность не проходились.

## Собственные ошибки по ходу

- Первый typecheck показал 3 ошибки в API — это был Prisma-клиент,
  сгенерированный от ветки #59; после `prisma generate` под `main` — 0.
  Полчаса не потерял, но мог принять за дефект.
- Скрипт «пути клиент ↔ API» дал 5 ложных срабатываний (второй
  `@Controller` в файле, localStorage-ключи, focus-trace) — проверил руками.
- `prisma.config.ts` сначала сломал build-typecheck (TS6059) — исправлено
  отдельным коммитом; заметил только при финальном прогоне.
- Часть команд запускалась из неверного каталога (cwd среды «плавает»);
  один прогон регенерации демо прошёл впустую.

## Вопросы владельцу

1. Подключить Sentry DSN к трём сервисам? (бесплатный тариф достаточен для
   пилота.)
2. Включить «Wait for CI» в Railway для трёх сервисов?
3. Переключить default branch на `main`?
4. Профиль `staging` в `eas.json`: удалить или поднять staging-API?
5. Демо: перевести на светлую тему, как продукт?
6. Регион Railway: оставить `sfo` на пилот или переехать в Европу до
    запуска?
