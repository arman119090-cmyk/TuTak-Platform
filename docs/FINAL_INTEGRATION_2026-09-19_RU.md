# TUTAK — FINAL INTEGRATION, CONSOLIDATION & RELEASE CANDIDATE (19.09.2026)

## Задание

Собрать доказанно полезные изменения четырёх потоков (PR #58, PR #59,
`claude/project-audit`, `claude/ios-bootstrap`) в одно согласованное
состояние на отдельной интеграционной ветке, устранить конфликты, закрыть
продуктовые пробелы из брифа, собрать Android/iOS release candidate для
device/pilot verification, подготовить один PR в `main` и не менять
production. Полный текст брифа — сообщение владельца от 19.09.2026
(36 разделов).

## База

- `main` `369eda1` (= production на Railway, все три сервиса).
- Интеграционная ветка `claude/final-integration-20260919`:
  `bb32cb3` (PR #58) → `70c879c` (PR #59) → `c7370b6` (audit) → `68e5cea`
  (iOS) → `954b02b` (demo) → `cf87f72` (интеграционные правки) →
  `073a043` (js-yaml). RC-сборки — с `cf87f72`; `073a043` меняет только
  lockfile тест-инструментов.

---

## A. CURRENT STATE

| | SHA / состояние |
|---|---|
| `main` | `369eda1`; Railway production api/admin/partner — тот же SHA, `checkSuites: false` у всех трёх |
| PR #58 head | `2edfece`, 16 коммитов, CI зелёный (run 35437678676), mergeable clean |
| PR #59 head | `cd49537`, 10 коммитов, CI зелёный (run 35446690613) |
| `claude/project-audit` | `c10b6f2`, 4 коммита, CI зелёный |
| `claude/ios-bootstrap` | `c68e99b`, 5 коммитов, CI зелёный |
| Другие открытые PR | #52 (biometrics, вне этого RC по решению владельца), #29 (design handoff, draft, база — старая ветка) |
| Default branch GitHub | `claude/tutak-loyalty-mvp-e485jm` (245 позади `main`) |
| Branch protection на `main` | **нет** (`protected: false`) |
| PITR / backups | **не доказаны**: workflow `backup.yml` только в этой ветке, требует secret `RAILWAY_API_TOKEN`; restore не репетировался |
| Alert channel | **не настроен**: в переменных api нет `ALERT_WEBHOOK_URL` / `ALERT_TELEGRAM_*` |
| Sentry | **нет DSN** ни у одного сервиса |
| Money flags | `TUTAK_PSP_ENABLED`, `PSP_REFUNDS_ENABLED`, `CUSTOMER_PREPAID_TOPUP_ENABLED` отсутствуют → выключены |
| Интеграционная ветка | `073a043`, CI на `cf87f72` зелёный (run 35450056493); CI на `073a043` — в процессе |

Граф:

```
main 369eda1
 ├── PR58  claude/railway-connector-check-wy0ffq  2edfece  (+16)
 ├── PR59  claude/premium-visual-refinement       cd49537  (+10)
 ├── claude/project-audit                         c10b6f2  (+4)
 ├── claude/ios-bootstrap                         c68e99b  (+5)
 └── claude/final-integration-20260919  ← 58 → 59 → audit → ios → fixes
```

Файлы, изменённые более чем в одной ветке (без docs/screenshots):
`apps/api/src/app.module.ts` (58, 59); `SettingsScreen.tsx` (58, 59);
`packages/i18n/src/locales/{en,hy,ru}.json` (58, 59; hy ещё audit);
`apps/api/Dockerfile` (58, audit); `.github/workflows/ios-build.yml`,
`apps/mobile/app.config.js`, `apps/mobile/eas.json` (58, ios);
`MainTabNavigator.tsx` (59, ios); зеркала в `demo/`.

## B. INTEGRATED

| Источник | Что вошло |
|---|---|
| PR #58 (`2edfece`, merge `bb32cb3`) | readiness-алерты, Telegram/webhook alerting с честной семантикой delivered, uptime probe + тесты, backup workflow, `verify-restored-db.sh`, `pilot-verify.sql`, runbooks (DR, incidents, roles), launch-load, refund adversarial, legal package и `/legal/*` за флагом, OTP per-IP ceilings, Sentry release для панелей, Android device test, iOS prep, Wait-for-CI experiment doc — **целиком** |
| PR #59 (`cd49537`, merge `70c879c`) | Premium PASS 1–3, Partner Spotlight, promo Prisma-модель + 3 миграции, promo API (`/promos/featured?locale=`, events, admin CRUD + artwork), admin promo UI HY/RU/EN, media pipeline PROMO_ARTWORK, вторичные экраны, ИНН/Tax ID, локализация дат, Spotlight → PartnerDetail по id, artwork E2E (13 тестов), demo parity, скриншоты и документы — **целиком** |
| `claude/project-audit` (`c10b6f2`, merge `c7370b6`) | 7 армянских строк, favour, `prisma.config.ts` + удаление `package.json#prisma` + Docker COPY + tsconfig exclude, overrides `qs`/`xmldom`, `.env.example` (42 настройки), отчёт — **целиком** |
| `claude/ios-bootstrap` (`c68e99b`, merge `68e5cea`) | `preview-ios-simulator`, `demo-ios.yml`, Build iOS с MAP_TILE и артефактом/SHA, ATS по профилю, `usesNonExemptEncryption:false`, purpose-строки, микрофон убран (iOS+Android), tab bar geometry, `useTabBarSpace`, разведка и отчёт — **целиком** |

Разделы брифа 8–12 (promo HY/RU/EN, даты, destination, artwork E2E,
analytics Impressions/Opens/Open rate) — **уже реализованы в PR #59**
(коммит `8d07936`), в интеграции проверены: API integration 1494/1494
включая `promos` и `promo-artwork`; admin показывает Impressions / Opens /
Open rate и не считает уникальных пользователей.

## C. CONFLICTS RESOLVED

| Файл | Решение |
|---|---|
| `apps/mobile/src/presentation/screens/settings/SettingsScreen.tsx` | premium-раскладка групп (PR #59) + строка «Политика конфиденциальности» из PR #58 как обычный `ListRow` после переключателя персонализации; скрыта без `LEGAL_BASE_URL` |
| `apps/mobile/src/app/navigation/MainTabNavigator.tsx` | визуал PR #59 (белый бар без линии, тень вверх, кастомные подписи, Pay-диск, paddingTop 6) + геометрия iOS-ветки (`height = tabBarHeight + insets.bottom`, `paddingBottom = max(20, inset)`, без `Platform`); тесты: Android 0/16/34, iOS 34/0, «то же правило» — 39/39 в `MainTabNavigator.test` |
| `apps/mobile/eas.json` | версия iOS-ветки (содержит профили PR #58 + simulator); затем удалён ложный `staging` |
| `.github/workflows/ios-build.yml` | версия iOS-ветки (надмножество PR #58: simulator, MAP_TILE, артефакт+SHA) |
| `apps/mobile/app.config.js` | автослияние: `legalBaseUrl` (58) + iOS infoPlist/config/плагины (ios) |
| `packages/i18n/src/locales/*.json` | автослияние: ключи 58 (`settings.privacyPolicy`) + 59 (`partners.showOnMap`, `common.today/yesterday`, ИНН) + правки hy из audit |
| `apps/api/Dockerfile`, `app.module.ts` | автослияние |
| `docs/IOS_RELEASE_PREP_2026-09-19.md` | версия iOS-ветки |
| `demo/*` | не разрешался руками — регенерирован `scripts/build-demo-app.sh` после всех слияний |

## D. NEW DEFECTS (найдены и закрыты в процессе интеграции)

1. `eas.json`: профиль `staging` указывал на production API — удалён;
   тест `appConfigGuards` теперь проверяет инвариант «ничего с именем
   staging не смотрит на production»; `android-apk.yml` больше его не
   предлагает.
2. Демо генерировалось тёмным (`userInterfaceStyle: dark`, splash
   `#0A0A0F`) при light-only продукте — переведено на light и `#F8F9FB`.
3. `EvHistoryScreen` без точки входа — добавлена ссылка «История зарядок»
   в заголовке секции на карте в режиме «Станции» (регрессионный тест:
   есть там, нет над списком партнёров). Экран нужен: у него есть API
   (`evApi.myHistory`) и словарь.
4. `.env.example` не описывал настройки PR #58 (`ALERT_TELEGRAM_*`,
   `LEGAL_PAGES_ENABLED`, `OTP_IP_*`) — добавлены. `REDIS_PASSWORD`
   оставлен: его читает `docker-compose.yml` (аудит ошибся).
5. Новый advisory `js-yaml` (3.15.1/4.3.1, тест-инструменты istanbul) —
   overrides на 3.15.2/4.3.2; аудит production: 2 high (`image-size`, metro,
   патча нет) + 1 moderate (`decode-uri-component`, react-navigation; в
   приложении **нет** linking-конфига, deep links не разбираются → путь
   недостижим; тест не добавлен, тестировать нечего).
6. `customer-balance` `@Body() body: Record<string, unknown>` — это
   `POST /customer-balance/topup/webhook`, `@Public()`, вход провайдера
   банка; подпись проверяет адаптер (`verifyTopUpWebhook`), No-op-адаптер
   отвергает всё; покрыт `customer-balance-disabled.int-spec` (отказ) и
   `customer-balance.int-spec` (замена/идемпотентность). Оставлен сырым
   осознанно, как PSP callback.
7. `prisma.config.ts` в «контейнерных» условиях (нет `.env`, `DATABASE_URL`
   из окружения, cwd `apps/api`): `Loaded Prisma config from
   prisma.config.ts`, `migrate deploy` без предупреждения, seed guard
   отказывает без `SEED_ADMIN_PASSWORD`. Docker-образ здесь собрать
   нельзя (нет daemon) — образ собирает CI («Build the container images»,
   зелёный); старт контейнера на Railway — UNVERIFIED до первого деплоя.

## E. SMS STATUS

**VIVA SMS: BLOCKED.** Шлюз Contabo опрошен с GitHub-runner'а в 14:43 UTC
(run 35449605699): `https://217.76.49.94/health` →
`{"status":"ok","tunnel":"down"}`. Процесс шлюза жив, IPsec-туннель до
Viva лежит. Последние попытки отправки — 16.09 14:30–14:34 UTC, все
`tunnel_down`; с тех пор попыток нет (логи Railway до 15:00 19.09). Бюджет
SMS не исчерпан (счётчики не задействованы). Нужен человек на VPS
`217.76.49.94`: `sudo swanctl --initiate --child viva && sudo swanctl
--list-sas`, затем повторить опрос `/health` (workflow «Check the deployed
stack» с `api=https://217.76.49.94`). Если туннель не поднимается — Viva
support (их сторона `217.76.0.20`). Тестовую OTP не отправлял: без туннеля
она заведомо не уйдёт.

## F. ANDROID RC

Демо-сборка (mock-данные; production API промо-маршрутов ещё не имеет,
поэтому Spotlight виден только здесь):

| Поле | Значение |
|---|---|
| Commit | `cf87f7226cb1432ed993fa73ca6e1a4a10128ebe` |
| Workflow | Build demo APK #13, run 35450067709, EAS `preview`, FINISHED |
| Релиз / файл | https://github.com/arman119090-cmyk/TuTak-Platform/releases/tag/demo-latest → `tutak-demo.apk` |
| Пакет / версия | `am.tutak.demo` / `0.1.0` |
| Размер | 127 166 487 байт |
| SHA-256 | `5bfaa13adeb010e7fae05dd3d598e98c9eb6a1652d103b9db073ca1200a06555` (digest ассета GitHub) |
| Показывает | Premium PASS 3, Partner Spotlight (3 промо HY/RU/EN, fallback), локализованные даты, финальную навигацию, светлый splash |

Сборка против production API (`android-apk.yml`, `preview`/`production-apk`)
не запускалась в этой задаче: она не покажет Spotlight (нет эндпоинта на
`main`) и потратит EAS-кредит; после мержа PR — `production-apk` с SHA
`main`.

## G. iOS SIMULATOR RC

Демо (light, с промо):

| Поле | Значение |
|---|---|
| Commit | `cf87f72` |
| Workflow | Build demo iOS (simulator) #3, run 35450066574, EAS build `272f7d71-cbe0-48bb-aa50-b6dc4b019da0`, FINISHED |
| Артефакт GitHub | https://github.com/arman119090-cmyk/TuTak-Platform/actions/runs/35450066574/artifacts/10586925172 (`tutak-demo-ios-simulator.tar.gz` + `.sha256`, 30 дней) |
| Размер | 31 488 628 байт |
| SHA-256 | `b637df0872a1cb509232852db973ca0a946e6352dda6a434c0cd8dee86c04f82` |

Приложение (`preview-ios-simulator`, production API, Premium + Spotlight
client): run 35450065455 — **см. дополнение в конце отчёта**.

## H. CI

| Проверка | Результат на интеграционной ветке |
|---|---|
| GitHub CI (`cf87f72`, run 35450056493) | **success**: lint/test/build, integration 1–3/3, container images |
| API unit / tsc build+spec / eslint | 733/733 · 0/0 · 0 |
| API full integration (PG16 + Redis, локально) | 114 suites, **1494/1494** (включая `promos`, `promo-artwork`, `launch-load`) |
| Миграции на чистую БД / upgrade path / diff | 74 применены на `tutak_fresh`, 0 ошибок; `tutak_test` (была на 74) — No pending; `migrate diff` — No difference |
| Mobile jest / tsc / eslint | **549/549** · 0 · 0 |
| Demo parity | регенерирован, закоммичен, проверка в CI и в `demo-*` workflow зелёная |
| Admin jest / tsc / eslint | 112/112 · 0 · 0 |
| Partner jest / tsc / eslint | 92/92 · 0 · 0 |
| `pnpm audit --prod` | 2 high (image-size, metro) · 1 moderate (decode-uri-component) — остальное закрыто overrides |
| Secret scan / `.env` в git | 0 / 0 |
| Sentry sanitizer parity | OK |
| `expo config --type introspect` (preview) | ATS `NSAllowsArbitraryLoads:false`, `ITSAppUsesNonExemptEncryption:false`, микрофона нет, camera/photos/location purpose-строки, Light; Android без `RECORD_AUDIO` (только CAMERA, LOCATION×2, STORAGE×2 от image-picker, INTERNET); development — localhost-исключение |
| Android demo APK / iOS demo simulator / iOS app simulator | FINISHED / FINISHED / см. дополнение |

## I. PRODUCTION MANUAL GATES (владелец, до мержа PR)

1. **Railway → Wait for CI**: tutak-api, tutak-admin, tutak-partner →
   Settings → Source → «Wait for CI» (сейчас `checkSuites:false` у всех).
   Через API это staged-изменение с redeploy — не делал, чтобы не трогать
   production.
2. **GitHub → default branch = `main`** (Settings → General → Default
   branch), затем **branch protection на `main`**: PR required, required
   checks «Lint, test and build», «Integration tests (1/3…3/3)», «Build the
   container images». После смены default branch workflow_dispatch видит
   workflow из `main`; старую ветку не удалять до проверки.
3. **Backup → restore → verify**: secret `RAILWAY_API_TOKEN` → workflow
   `backup.yml` (после мержа) → восстановить в новую БД →
   `scripts/verify-restored-db.sh` PASS, imbalance 0. Не поверх production.
4. **Alert channel**: задать `ALERT_WEBHOOK_URL` или `ALERT_TELEGRAM_BOT_TOKEN`
   + `ALERT_TELEGRAM_CHAT_ID`, прогнать `pnpm --filter @tutak/api alert:verify`
   → сообщение получено человеком. Sentry DSN — если есть, добавить в три
   сервиса (`SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`); не блокер пилота.
5. **Viva-туннель**: поднять на VPS, повторить `/health` → `tunnel: up`,
   затем один реальный OTP на телефон владельца.
6. **Seed-переменные**: baseline создан (admin `+37400000000` есть; скрипт
   идемпотентен — `upsert` с `update: {}`, пароль существующему админу не
   перезаписывает). После ротации пароля админа: удалить `SEED_BASELINE`
   и `SEED_ADMIN_PASSWORD` в Railway → tutak-api → Variables. Данные не
   удаляются, boot не ломается (entrypoint просто пропускает seed),
   миграции не зависят.
7. **Device review** демо-APK по `docs/OWNER_DEVICE_TEST_RU.md` (Samsung +
   Xiaomi), 14 пунктов.

## J. FINAL STATUS

**INTEGRATION COMPLETE — READY FOR OWNER DEVICE/INFRA GATES.**

Одна кодовая база (`claude/final-integration-20260919`), из которой
собираются Android и iOS (simulator), работает Premium PASS 3 и Partner
Spotlight, сохранены pilot-safety инструменты PR #58 и правки аудита,
миграции согласованы (74, diff чистый), CI зелёный, production не менялся.
PR в `main` остаётся **READY TO MERGE AFTER OWNER ACTION** до закрытия
gates I.1–I.7. Не PUBLIC LAUNCH READY; Idram/EV/PSP выключены.

---

## Что НЕ сделано

- Railway Wait for CI, branch protection, default branch — только
  инструкции (нет инструмента/права; staged-деплой на production не делал).
- Backup/restore evidence, human alert evidence, Sentry — нет учётных
  данных; owner gates.
- Реальный iPhone — нет Apple-аккаунта (`docs/APPLE_DEVELOPER_ACCOUNT_RU.md`).
- Android APK против production API из интеграционной ветки — не собирал
  (объяснение в F).
- Font comparison (раздел 28) — не повторял: свидетельство из PR #59
  (`final-font/00-system-vs-inter-vs-manrope.png`): Inter/Manrope с Google
  Fonts без армянских глифов → системный шрифт остаётся. Новые экраны
  (Wallet/Settings/Spotlight отдельно) не снимал.
- Полный premium-проход admin/partner — post-pilot по брифу.
- PR #58 и #59 не закрыты: закрыть как superseded **после** мержа
  интеграционного PR.

### Собственные ошибки по ходу

- Первый прогон мобильных тестов на интеграции упал (2) — тест на профиль
  `staging`, который я же удалил; переписан на инвариант.
- Docker-образ не собрался локально (нет daemon) — заметил после запуска.
- В аудите написал, что `REDIS_PASSWORD` не читается — его читает
  docker-compose; исправлено здесь.
- ESLint предупредил о лишней директиве в тесте — второй прогон.

## UNVERIFIED

- Старт контейнера с `prisma.config.ts` на Railway (локально —
  эквивалент без `.env`; Docker build — CI).
- Всё нативное на устройствах: Samsung/Xiaomi, iPhone.
- Поведение RC против production API после мержа (промо-таблицы появятся
  с миграциями; Spotlight пуст, пока admin не создаст промо).
- Значения переменных Railway (только имена).

## Вопросы владельцу

Только gates I.1–I.7; архитектурных вопросов нет.

---

## Дополнение: результат сборки приложения для iOS Simulator

_Заполняется по завершении run 35450065455._
