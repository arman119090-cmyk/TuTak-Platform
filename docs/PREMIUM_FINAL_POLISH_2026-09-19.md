# TUTAK — FINAL PREMIUM PRODUCT POLISH + NATIVE VERIFICATION (2026-09-19)

## Задание

«TUTAK — FINAL PREMIUM PRODUCT POLISH + NATIVE VERIFICATION». Цель —
`PREMIUM MOBILE READY FOR OWNER DEVICE REVIEW`. Без нового редизайна и без
«четвёртого прохода ради красоты»: решения pass 1–3 сохраняются.
Разделы задания: (1) база — main, PR #58, PR #59, конфликты, миграции, CI;
(2) промо на HY/RU/EN с явным fallback; (3) локализация дат одним
форматтером с тестами; (4) Spotlight ведёт на конкретного партнёра;
(5) E2E-тест реального artwork с негативами; (6) аналитика
Impressions/Opens; (7) нативный preview APK с видимым Spotlight;
(8) чек-лист для Samsung/Xiaomi; (9) fontScale 1.0/1.3 на 360/390;
(10) армянская подпись «Դրամապանակ» в tab bar; (11) System vs Inter vs
Manrope; (12) motion; (13) haptics; (14–15) Wallet/Settings native review;
(16) визуальные свидетельства для второстепенных экранов; (17) синхронизация
`TUTAK_PREMIUM_VISUAL_SYSTEM.md` с кодом; (18) классификация источников
референсов; (19) админка промо; (20) производительность Spotlight;
(21) доступность; (22) принятые решения владельца; (23) что не трогать;
(24) CI; (25) отчёт A–M и вердикт.

Принятые решения владельца (не переспрашивались): заголовок
«От партнёров TuTak»; Spotlight ведёт на конкретного партнёра; PR #52
(biometrics) — не в этом PR; haptics — не блокер пилота.

## База

- Ветка: `claude/premium-visual-refinement`, PR #59.
- Начало работы: `16d338a` (pass 3). Итоговый коммит: `8d07936`.
- `main`: `369eda1` — не двигался с начала pass 1.

---

## A. CURRENT MAIN / PR STATE

| Что | Состояние |
|---|---|
| `main` | `369eda1` |
| PR #58 (pilot readiness) | open, `mergeable_state: clean`, не смержен, head `2edfece` |
| PR #59 (эта ветка) | open, 6 коммитов, 0 позади `main`, `git merge-tree` с `main` — без конфликтов |
| Rebase | не нужен: `main` не двигался |
| Миграции | 74 в `prisma/migrations`, `migrate deploy` на чистую БД — 0 ошибок; `prisma migrate diff --from-url <мигрированная БД> --to-schema-datamodel` — «No difference detected» |
| CI на `4d18c3f` | зелёный: 10/10 check runs в двух прогонах (раздел L) |

Риск: PR #58 и PR #59 оба трогают `SettingsScreen.tsx` (строка «Политика
конфиденциальности» в #58). Кто смержится вторым — тому нужен rebase; по
`merge-tree` сейчас обе ветки сливаются с `main` чисто, но между собой не
проверялись.

## B. FIXES SINCE PASS 3

Помимо разделов C–F:

- `PartnerDetailScreen` принимает `{ partner }` (из карты) **или**
  `{ partnerId }` (из Spotlight); по id грузит `GET /partners/:id`,
  показывает имя, категорию, логотип, обложку, кешбэк, «как копить /
  тратить» и кнопку «Показать на карте»; расстояние, мини-карта, адрес и
  «Оплатить здесь» — только когда есть филиал (`partner`).
- Tab bar: подпись `minWidth 88`, `overflow: visible` у item,
  `letterSpacing −0.2`, `lineHeight 14`, `adjustsFontSizeToFit` +
  `minimumFontScale 0.9` (раздел H).
- `docs/TUTAK_PREMIUM_VISUAL_SYSTEM.md` — таблица иконок говорила «stroke
  2.6» при коде 2.2; исправлено (tab bar 24/2.2, Pay-диск 22/2.4, referral
  entry 26/2.6); добавлены разделы Dates, языки и загрузка Spotlight,
  правило армянской подписи, направление тапа по карточке.
- `docs/PREMIUM_REFERENCES_2026-09-19.md` — раздел 0 «Статус источников»:
  DESIGN.md Revolut и Airbnb из `awesome-design-md` помечены как
  **COMMUNITY REFERENCE**, а не официальные дизайн-системы; блог Revolut —
  OFFICIAL, но UNVERIFIED (сеть не пропустила); newsroom Airbnb —
  OFFICIAL; Creole/Lollypop/Wavespace/adjoe/Voucherify/9to5Mac — DESIGN
  ANALYSIS; Wise Figma kit — файл сообщества.

## C. PROMO HY / RU / EN

**Модель.** `PartnerPromo.title/subtitle/benefitLabel` → одна колонка
`translations JSONB NOT NULL DEFAULT '{}'` (`{ hy?, ru?, en? }`, каждый —
`{ title, subtitle?, benefitLabel }`), CHECK `jsonb_typeof = 'object'`.
Миграция `20260919120000_partner_promo_translations`: добавляет колонку,
переносит старые RU-поля в `translations.ru`, удаляет три колонки.

**Правило.** `resolvePromoCopy(translations, requested)`: запрошенный язык
→ `ru` → первый заполненный (`hy, ru, en`). «Заполненный» = непустые
`title` и `benefitLabel`. Карточка без единого заполненного языка **не
отдаётся** в `featured` и помечена в админке «No language filled».
Пустой перевод карточку не ломает — он просто не выбирается.

**API.** `GET /promos/featured?locale=hy|ru|en` (`PromoLocaleQueryDto`,
`IsIn`); ответ содержит `locale` — язык, в котором фактически отданы
тексты. Admin: `POST/PATCH /admin/promos` принимают `translations`
(`PromoTranslationsDto` → вложенные `PromoCopyDto`: title 1–80, subtitle
≤ 120, benefitLabel 1–24); при отсутствии заполненного языка — 400
«At least one language needs a title and a benefit label». Admin DTO
отдаёт `translations`, `availableLocales`, `live` (окно ∧ active ∧ партнёр
∧ ≥ 1 язык). Shared types обновлены.

**Админка** (`apps/admin/.../promos/page.tsx`): три fieldset HY/RU/EN с
бейджами Filled / Incomplete / Empty; сохранение отказывает частично
заполненному языку («Finish or clear: EN») и полному отсутствию; preview
карточки с переключателем языка; в таблице колонка Languages (бейджи
заполненных), статус «No language filled»; destination-опция «The partner's
page».

**Мобильное.** `promosApi.featured(locale)` → `params: { locale }`;
`PartnerSpotlight` берёт язык из `i18n.language` (иначе `DEFAULT_LOCALE`) и
кладёт его в `queryKey`, так что смена языка в настройках перезапрашивает
ленту. Mock-адаптер демо повторяет серверное правило (у промо №3 намеренно
нет `hy` — виден fallback на `ru`).

**Доказано.** `promo-translations.spec.ts` (unit); `promos.int-spec.ts` —
5/5, включая «answers in the interface language, falls back to ru, and
never serves an empty card»; admin `page.test.tsx` — 7/7; скриншоты
`final/09-home-hy.png`, `final-hy/h1-home-hy.png` («Սուրճ տանելու՝ 10%
հետ», «10% քեշբեք»).

## D. DATE LOCALIZATION

Один форматтер `apps/mobile/src/presentation/utils/format.ts`:
`formatDate` («19 сент. 2026 г.» / «19 սեպ, 2026 թ.» / «Sep 19, 2026»),
`formatDateTime` (24-часовой), `formatDayGroup` («Сегодня»/«Вчера»,
«Այսօր»/«Երեկ», «Today»/«Yesterday» — из словаря `common.today/yesterday`).
Локаль — `i18n.language` (глобальный экземпляр `i18next`, не модуль
приложения, чтобы не поднимать словари в каждом unit-тесте), не локаль ОС.

**Найдено по ходу.** Chromium из Playwright не имеет армянских данных
ICU: `Intl.DateTimeFormat.supportedLocalesOf(['hy'])` → `[]`, а `format`
**молча** отвечает по-английски («Sep 17, 2026») — первые HY-скриншоты
это показали. Добавлен fallback: если рантайм не знает `hy`, дата
собирается вручную из тех же коротких месяцев, что печатает ICU. Тест
подменяет `supportedLocalesOf` и сравнивает ручной вывод с настоящим ICU
для всех 12 месяцев (date и dateTime) — совпадение буква в букву. Hermes
на Android/iOS берёт данные у платформы, там `hy` есть; на устройстве это
проверяется по HY-датам в истории (раздел M).

Экраны с датами: Home (операции), Wallet (сгорание, история), история
операций (группы дней), уведомления, статус покупки, EV history —
все идут через эти три функции. Тесты `format.test.ts`: 30.

## E. PARTNER DESTINATION

Тап по карточке: `destination = PARTNER` → `navigate('PartnerDetail',
{ partnerId })` — страница **этого** партнёра, не случайный филиал;
`PARTNERS_MAP` → карта (без изменений). Для сети со страницы партнёра —
«Показать на карте» (`Partners` с `q: <имя>`), выбор филиала остаётся за
клиентом. Скриншот `final-secondary/e2-partner-detail-from-spotlight.png`
(Coffeeshop Company, «Кафе», 8 %, «Показать на карте»).

Ограничение: в id-режиме нет адреса и расстояния — у сети их нет «одного»;
это по заданию.

## F. ARTWORK E2E

`apps/api/test/promo-artwork.int-spec.ts` (PostgreSQL 16 + Redis, реальный
`sharp`, реальный `MediaImageService`, локальное хранилище — production
storage не тронут), 13 тестов:

- admin → create → `setArtwork(PNG 1600×1000)` → asset `PROMO_ARTWORK
  ACTIVE` 1024×640 + thumb 128×80; обложка партнёра не затронута;
  `featured('ru')` отдаёт URL; `MediaDeliveryController` отдаёт байты;
- замена artwork: старый asset `REPLACED`, карточка указывает на новый;
- несколько ACTIVE artwork у одного партнёра;
- отказы: owner партнёра и customer — 403 (роль, не permission), карточка
  не тронута; не-изображение, повреждённый файл, пустой файл — 400 и **ноль**
  строк `mediaAsset`; SVG и анимированное изображение — 400; oversized на
  границе pipeline — 400; несуществующая карточка — 404;
- карточка с artwork **не отдаётся**, когда: выключена, ещё не началась,
  истекла, партнёр SUSPENDED, партнёр `isActive=false` — asset при этом
  остаётся ACTIVE.

## G. NATIVE PREVIEW APK

Источник данных — **демо-профиль с mock-адаптером** (в нём 3 промо на
трёх языках, artwork, fallback, все состояния Spotlight), а не staging:
staging-деплой ветки дизайна не делался, production не трогался.
Workflow `demo-apk.yml` запущен вручную на ветке:

| Поле | Значение |
|---|---|
| Commit | `8d07936a3522f223134179736d3415bd3e3f354f` |
| Workflow run | https://github.com/arman119090-cmyk/TuTak-Platform/actions/runs/35444868849 |
| Профиль EAS | `preview` (demo/eas.json, `appVersionSource: remote`) |
| Пакет | `am.tutak.demo` («TuTak Demo», ставится рядом с боевым) |
| Версия | `0.1.0` (demo/app.json); versionCode назначает EAS (remote) — см. страницу сборки |
| Релиз | тег `demo-latest` → `releases/download/demo-latest/tutak-demo.apk` |
| SHA-256 | см. подраздел «Результат сборки» ниже |

APK по pass 2 (`apk-preview-59`, `172e4c3`) **устарел**: в нём нет pass 3,
языков промо, дат и перехода на партнёра.

### Результат сборки

Workflow `Build demo APK` #12 — **success** (13:08 → 13:28 UTC).

| Поле | Значение |
|---|---|
| Commit | `8d07936a3522f223134179736d3415bd3e3f354f` |
| Релиз | https://github.com/arman119090-cmyk/TuTak-Platform/releases/tag/demo-latest |
| Скачать (без входа) | https://github.com/arman119090-cmyk/TuTak-Platform/releases/download/demo-latest/tutak-demo.apk |
| Размер | 127 165 807 байт |
| SHA-256 | `db76fcd7b35450f0a1171e04f3554c0b3addfda876fff9da7070bf74003fc47b` (посчитан локально после скачивания; совпадает с digest ассета на GitHub) |
| Пакет / версия | `am.tutak.demo` / `0.1.0` (строки найдены в AndroidManifest APK) |
| versionCode | назначен EAS (`appVersionSource: remote`); в этой среде не прочитан — UNVERIFIED, виден на странице сборки EAS |
| Профиль / источник данных | `preview` / **mock** (демо без сервера: 3 промо HY/RU/EN, artwork, fallback, все состояния) |

Что показывает: Spotlight на Home, языки промо, даты HY/RU/EN, переход на
партнёра, все экраны pass 1–3. Что **не** показывает: реальный API,
реальные artwork из админки, счётчики, СМС.

## H. 360 / 390 + FONT SCALE

- 390 pt: `final/` (11 экранов), 360 pt: `final-360/` (те же 11).
  Page errors: 0 и 0. На 360 ничего не обрезано; hero, quick actions,
  Spotlight, referral, списки — без переполнений.
- **Армянская подпись «Դրամապանակ».** Измерено в Chromium: 90 px при
  11 px; ширина item — 78 pt (390) / 72 pt (360). Порядок по заданию:
  ширина раскладки (item без padding, `overflow: visible`) → раскладка
  подписи (`minWidth 88`, `letterSpacing −0.2`) → равномерное уменьшение
  ≤ 10 % (`minimumFontScale 0.9`) → и только потом перевод с владельцем.
  На 390 подпись помещается целиком без уменьшения. На 360 при
  уменьшении до 0.9 (81 pt в боксе 88) расчётный зазор до соседней
  «Գլխավոր» ≈ 5 pt — **web-рендер этого не показывает** (в браузере
  `adjustsFontSizeToFit` не работает, на `final-360/09-home-hy.png` подписи
  касаются друг друга). Нативная проверка на 360-устройстве — раздел M.
  Сокращение не выдумывал; если на устройстве FAIL — вопрос владельцу
  (раздел «Вопросы»).
- **fontScale 1.3** — в web-экспорте нет системного fontScale; на кнопках
  стоит `maxFontSizeMultiplier 1.3`, высоты через `minHeight`. Реальная
  проверка 1.3 на 360/390 — только на устройстве (раздел M). UNVERIFIED.

## I. SYSTEM / INTER / MANROPE

Скачаны TTF Inter и Manrope в том виде, в каком их отдаёт Google Fonts;
`fc-query` показал: **ни один не содержит армянских глифов U+0531–U+0556**.
Визуальное свидетельство `final-font/00-system-vs-inter-vs-manrope.png`
(Home HY: system / Inter / Manrope; Home RU: Inter): в HY весь армянский
текст во всех трёх вариантах рисуется системным шрифтом — меняются только
цифры и латиница, интерфейс становится **смешанным**; Manrope ещё и ломает
интервал в «Սկանավորել QR». В RU разница с системным — оттенок, не класс.

Вывод: **оставить системный шрифт** (SF / Roboto). Менять «чтобы было как
Revolut» нет оснований: чёткого улучшения нет, а армянский покрытия не
получает. Лицензии не проверялись — не понадобилось.

## J. SECONDARY SCREENS REVIEW

Скриншоты на web-экспорте демо (390 pt), `final-secondary/` и `final-all/`:

| Экран | Файл | Замечание |
|---|---|---|
| ResetPassword | `e1-reset-password.png` | — |
| ForgotPassword | `e0-forgot-password.png`, `a2-forgot.png` | — |
| PartnerDetail (из Spotlight, по id) | `e2-*.png` | «Показать на карте», без адреса — по дизайну |
| PartnerDetail (nearby, «Оплатить здесь») | `e2c-partner-detail-nearby.png` | карточка раскрывается на карте |
| CreatePurchaseIntent | `e3-create-purchase.png`, `e3b-*-filled.png` | — |
| PurchaseIntentStatus | `e4-purchase-status.png`, `e4b-*-later.png` | код кассира, таймер, отмена |
| PartnerApplicationSent | `e6-application-sent.png` | «ИНН (ՀՎՀՀ) — не указан» |
| ScanQr (web: нет камеры → состояние недоступности) | `final-all/b4-scan-qr.png` | permission-state на устройстве — раздел M |
| DeleteAccount | `final-all/d4-delete-account.png` | — |
| EV Session | `e5-ev-session.png`, `e5b-*.png` | — |
| Notifications (даты HY/RU) | `b2-notifications.png`, `h3-notifications-hy.png` | — |
| History HY | `h2-history-hy.png` | «Այսօր», «17 սեպ, 2026 թ.» |

Не получены (без визуального свидетельства):

- **VerifyPhone** — в демо `isPhoneVerified: true`, строка и баннер
  скрыты; экран есть только у неподтверждённого номера.
- **EV History** — у `EvHistoryScreen` **нет точки входа** в приложении:
  экран зарегистрирован в `RootNavigator`, но никто не делает
  `navigate('EvHistory')`. Это находка, не дизайн-дефект; решение —
  владельцу (добавить вход из EV/Wallet или убрать экран).

## K. PERFORMANCE

Spotlight — `useQuery` с `staleTime` 5 мин, `retry: 1`, параллельно
кошельку и операциям; Home не ждёт промо: пока данных нет или запрос
упал — секции нет, без скелетона. Impression только при видимости ≥ 60 %
в течение 500 мс и один раз за сессию (module-level Set). Web-экспорт:
0 page errors во всех сериях. Нативные метрики (TTI, jank) не измерялись.

## L. TESTS / CI

Локально на `8d07936`:

| Проверка | Результат |
|---|---|
| mobile jest | 64 suites, **542/542** |
| mobile tsc / eslint | 0 / 0 |
| API unit | 52 suites, **708/708** |
| API integration `promos` + `promo-artwork` (PG16 + Redis) | **18/18** (5 + 13) |
| API tsc (build + spec) / eslint (src + оба int-spec) | 0 / 0 |
| `prisma migrate deploy` (чистая БД) | 74 миграции, 0 ошибок |
| `prisma migrate diff` (как в CI) | No difference detected |
| admin jest / tsc / eslint | 16 suites, **112/112** / 0 / 0 |
| demo parity (`scripts/build-demo-app.sh`, закоммичен) | регенерирован, diff в коммите |
| Playwright web: 390, 360, sweep 15, secondary 12, HY 4, font 4 | page errors 0 |

CI GitHub на `4d18c3f` (= `8d07936` + этот отчёт), оба прогона — push
и pull_request — **зелёные целиком**: Lint, test and build; Integration
tests 1/3, 2/3, 3/3; Build the container images — 10 из 10 check runs
`success`. Прогоны: https://github.com/arman119090-cmyk/TuTak-Platform/actions/runs/35445064703
и https://github.com/arman119090-cmyk/TuTak-Platform/actions/runs/35445061754.

## M. REMAINING MANUAL DEVICE CHECK

Установить `tutak-demo.apk` (`am.tutak.demo`, рядом с боевым). Чек-лист
для Samsung (One UI) и Xiaomi (MIUI/HyperOS), по каждому пункту PASS/FAIL:

1. Home RU: hero, QR, quick actions, «От партнёров TuTak» — 3 карточки,
   вторая видна справа, snap по карточке, нет автопрокрутки.
2. Home HY: тексты промо на армянском; у третьей карточки — русский
   (fallback), не пусто.
3. Tab bar HY на устройстве шириной 360 dp (Xiaomi Redmi-класс) и 390+:
   «Դրամապանակ» целиком, одна строка, не касается «Գլխավոր», не крупнее
   соседей заметно. FAIL → раздел «Вопросы».
4. fontScale 1.3 (Настройки → Размер шрифта): Home, Wallet, Settings на
   360 и 390 — ничего не обрезано, кнопки растут по высоте.
5. Даты в HY: история операций — «Այսօր», «17 սեպ, 2026 թ.»; уведомления —
   «19 սեպ, 12:45»; не «Sep 17».
6. Тап по карточке Spotlight → страница партнёра → «Показать на карте».
7. Wallet: одна колонка, без 4 карточек; бар и легенда читаются.
8. Settings: группы без «коробок», секция «Аккаунт», язык переключается.
9. ScanQr: отказ в камере → понятное состояние с кнопкой.
10. Xiaomi: MIUI-оптимизации не режут тень tab bar; Samsung: жестовая
    навигация не перекрывает tab bar.
11. Тёмная тема системы: приложение остаётся светлым, без чёрных дыр.

Что чекнуть на **боевом** API позже (не в демо): реальные artwork через
админку; счётчики Impressions/Opens растут; язык промо с сервера.

---

## Что сделано (файлы)

- API: `prisma/schema.prisma`, миграция
  `20260919120000_partner_promo_translations`, `promos/promo-translations.ts`
  (+ spec), `dto/promo-copy.dto.ts`, `dto/promo-locale.query.dto.ts`,
  `dto/create-promo.dto.ts`, `dto/update-promo.dto.ts`, `promos.service.ts`,
  `promos.controller.ts`, `admin-promos.controller.ts`,
  `test/promos.int-spec.ts`, `test/promo-artwork.int-spec.ts` (новый).
- Shared types: `packages/shared-types/src/dto/promo.ts`.
- Admin: `promos/page.tsx`, `promos/page.test.tsx`.
- Mobile: `format.ts` (+ test), `PartnerSpotlight.tsx`, `promosApi.ts`,
  `mockAdapter.ts`, `mockData.ts`, `HomeScreen.tsx`, `navigation/types.ts`,
  `PartnerDetailScreen.tsx`, `MainTabNavigator.tsx`; i18n ru/hy/en
  (`partners.showOnMap`, `common.today/yesterday`).
- Demo: регенерирован (`demo/`).
- Docs: `TUTAK_PREMIUM_VISUAL_SYSTEM.md`, `PREMIUM_REFERENCES_2026-09-19.md`,
  этот отчёт; скриншоты `docs/screenshots/premium-visual-refinement/
  {final,final-360,final-all,final-secondary,final-hy,final-font}/`.

## Что НЕ сделано

- **Staging-деплой** ветки с реальным API — не делался; APK собран на
  mock-источнике. Реальная загрузка artwork через админку в prod/staging
  не проводилась.
- **Нативные скриншоты** — у автора нет устройства/эмулятора; всё
  визуальное — web-экспорт демо. Owner review на устройстве — раздел M.
- **fontScale 1.3** — не воспроизводится в web; только на устройстве.
- **VerifyPhone, EV History** — без скриншотов (причины в J). EV History
  вообще недостижим из UI — оставлено как находка владельцу.
- **Motion** — `react-native-reanimated` в зависимостях нет (только строка
  babel-плагина), новых нативных зависимостей не добавлял → анимации
  оставлены на `Animated` (press-scale, composition bar).
- **Haptics** — `expo-haptics` нет, не добавлял (решение владельца).
- **Полный premium-проход admin/partner** — отдельная будущая задача;
  сделана только страница промо.
- **Перевод «Դրամապանակ» для < 360 dp** — не выбран: решение владельца.

### Собственные ошибки по ходу

1. Первый прогон artwork-теста запустил из `apps/mobile` вместо
   `apps/api` — «0 tests found», результат прочитал не сразу.
2. В `PartnerDetailScreen` добавил `t(key, { defaultValue: category })` —
   сломал тест, ждущий сырой ключ; убрал defaultValue.
3. В artwork-тесте ожидал `rejects` от контроллера, который отказывает
   **синхронно** (`assertPlatformAdmin` до `return promise`) — 12/13; тест
   переписан на `toThrow`.
4. `format.ts` сначала импортировал модуль приложения `app/i18n/i18n` —
   инициализировал i18next во всех screen-тестах, 23 падения в 6 suites;
   перешёл на глобальный `i18next`.
5. Первые HY-скриншоты показали «Sep 17, 2026» — принял бы за
   готово, если бы не сравнил с ICU в Node; выяснилось, что Chromium
   Playwright без `hy`. Отсюда fallback в D.
6. Скрипт для второстепенных экранов: заполнил «Списать баллов» вместо
   «Сумма» (оба с placeholder «0»), кнопка отправки была disabled; гонял
   селекторы 5 раз (greps шли из неверного cwd).
7. Первое сравнение шрифтов через `* { font-family }` превратило
   Ionicons в «квадраты» — переделал, не трогая семьи icon-шрифтов.
8. Запустил `tsc -p tsconfig.json` вместо `tsconfig.build.json` — ложные
   TS6059; в репо typecheck идёт по build+spec, оба 0.

## Что осталось непроверенным (UNVERIFIED)

- Всё нативное: рендер на Samsung/Xiaomi, fontScale 1.3, армянская подпись
  на 360 dp с `adjustsFontSizeToFit`, ScanQr permission-state, тень tab bar.
- Hermes и `Intl` с `hy` на реальном Android (fallback покрывает худший
  случай, но сам путь на устройстве не наблюдался).
- Данные из настоящего API в Spotlight (языки, artwork, счётчики) —
  только integration-тесты и mock.
- Взаимный merge PR #58 ↔ PR #59 (оба меняют SettingsScreen).
- Страница блога Revolut (OFFICIAL) — не открылась из сети.
- versionCode APK (назначает EAS; страница сборки не читалась).

## Вопросы владельцу

1. Если «Դրամապանակ» на 360-устройстве FAIL: какой перевод/вариант
   подписи предпочесть? Варианты на выбор (не моё решение): «Հաշիվ»,
   «Բալանս», «Միավորներ» — все короче 60 px при 11 px.
2. `EvHistoryScreen` без точки входа: добавить вход (из EV-сессии или
   Wallet) или убрать экран?
3. Порядок мержа PR #58 и PR #59 — кто первым; второму нужен rebase.
4. Нужен ли staging с реальным API для проверки artwork/языков до
   мержа, или достаточно демо-APK + integration-тестов?

---

## FINAL VERDICT

**READY FOR OWNER DEVICE REVIEW** — с оговорками, которые не блокируют
установку и просмотр, но должны быть закрыты по чек-листу M:

- APK `demo-latest` (`8d07936`, mock-данные) собран, SHA-256 сверен,
  CI PR #59 зелёный 10/10, миграции и schema diff чистые.
- Открыто и проверяется только на устройстве: армянская подпись tab bar
  на 360 dp, fontScale 1.3, ScanQr permission-state, HY-даты в Hermes.
- Без ответа владельца: перевод «Դրամապանակ» на случай FAIL, судьба
  `EvHistoryScreen` без точки входа, порядок мержа PR #58/#59.

Визуальная доводка на этом остановлена; следующий шаг — установка
`tutak-demo.apk` и прогон чек-листа M на Samsung и Xiaomi.
