# Жако как персонаж бренда: отчёт по брифу от 20.09.2026

## Задание

Бриф `CLAUDE_FINAL_TASK_RU.md` (архив `Jako.zip`, 14 изображений попугая
Жако + контактный лист). Требовалось, в отдельной ветке и PR:

1. один reusable-компонент `<JakoHero state=… />` со всеми 14 состояниями;
2. переработать auth-flow в единую premium-систему с Жако на каждом шаге
   (login, phone, otp-waiting, otp-entry, password, reset-password,
   verification, confirm, success, warning);
3. flow «Стать партнёром» в четыре состояния: welcome → details → offer →
   submitted, каждое со своим Жако;
4. premium-чистка по §8 (меньше рамок, card-in-card, квадратных иконок);
5. слоган через i18n: RU «Больше возможностей рядом», HY «Ավելի շատ
   հնարավորություններ՝ կողքիդ», EN «More possibilities, closer.»;
6. Google Play readiness в трёх колонках (READY IN CODE / OWNER ACTION /
   BLOCKED), черновики store-скриншотов, before/after evidence;
7. проверки: lint, typecheck, mobile tests, partner flow, keyboard/focus,
   demo parity, HY/RU/EN, `fontScale 1.3`, small Android, Samsung, Xiaomi,
   iOS;
8. запреты: логотип не менять; новых попугаев не генерировать; не ломать
   Android keyboard/focus; `+374` не трогать; не мержить в production.

Владелец, после моего анализа нестыковок брифа: «ты сам, пожалуйста,
исправь эти нестыковки и продолжай работу».

## База

| | |
| --- | --- |
| Ветка | `claude/jako-design` |
| PR | [#61](https://github.com/arman119090-cmyk/TuTak-Platform/pull/61) → база `claude/dark-theme` |
| Base SHA | `4c4827e` (`claude/dark-theme` = PR #60 `2eac071` + 9 коммитов: pinch на карте, тёмная тема, grace блокировки) |
| HEAD SHA | `ae791aa` |
| Коммиты | `7d1e44f` (компонент + auth/lock/status экраны), `0951a71` (партнёрский мастер), `ae791aa` (readiness, evidence, круглый warning-mark) |

Порядок слияния: PR #60 → `claude/dark-theme` (PR на неё не открыт) →
PR #61. PR #61 нельзя мержить в `main` отдельно: он покажет 74 коммита.

## Решения по нестыковкам брифа

| Нестыковка | Решение |
| --- | --- |
| 06 success и 09 confirm почти одинаковы; 10 partner-details и 14 verification тоже | Оставил все 14 как есть, семантически разведены: `confirm` только на экране удаления аккаунта, `success` на статусе покупки; `verification` на подтверждении телефона, `partner-details` в мастере. Новых попугаев не рисовал |
| PNG 2048×2048 ×14 ≈ 40 МБ в бандле | В бандле WebP 768×768 (14 файлов, 1,7 МБ). Оригиналы не в репозитории |
| «Hero уменьшается при открытии клавиатуры» против «не ломать Android focus» | Размер решается по устройству (`useCompactLayout`), а не по событию клавиатуры. Hero стоит в начале `KeyboardAwareScroll` и просто уезжает вверх |
| 4 экрана партнёрского flow против одного существующего экрана с draft | Один экран, три шага в state; четвёртый — `PartnerApplicationSentScreen`. Payload `POST /partners/apply` не изменился, закреплён тестом |
| EN-слоган с точкой в конце, RU/HY без | Все три без точки: под логотипом на экране входа точка выглядела ошибкой |
| 03 otp-waiting и 05 otp-entry — два состояния для одного экрана кода | `OtpLoginScreen`: 02 phone → 05 otp-entry. `OtpRegisterScreen`: 02 phone → 03 otp-waiting → 04 password. Так используются все 14 |
| «Отдельный PR» при том, что вся визуальная работа стоит на PR #60 | PR #61 открыт против `claude/dark-theme`, чтобы в диффе были только 3 коммита этой работы |

## Что сделано

### Компонент

`apps/mobile/src/presentation/components/JakoHero.tsx` (+ 18 тестов в
`JakoHero.test.tsx`): `state` из 14 значений → `require` WebP; `size`
`hero | compact | inline` с двумя высотами (обычный / компактный
экран); `align`; `contentFit="contain"`, `transition={0}`; обёртка
`accessible={false}`, `importantForAccessibility="no-hide-descendants"`,
`pointerEvents="none"`; `testID` по умолчанию `jako-<state>`. Экспорт
`JAKO_STATES` и `jakoAsset(state)`.

### Mapping экран → state → asset

| Экран | State | Asset (оригинал) | Размер |
| --- | --- | --- | --- |
| `LoginScreen` | `login` | 01_jako_login | hero |
| `OtpLoginScreen`, шаг телефона | `phone` | 02_jako_phone | hero |
| `OtpLoginScreen`, шаг кода | `otp-entry` | 05_jako_otp_entry | hero |
| `OtpRegisterScreen`, телефон | `phone` | 02_jako_phone | hero |
| `OtpRegisterScreen`, код | `otp-waiting` | 03_jako_otp_waiting | hero |
| `OtpRegisterScreen`, пароль | `password` | 04_jako_password | hero |
| `RegisterScreen` | `phone` | 02_jako_phone | hero |
| `ForgotPasswordScreen` | `reset-password` | 13_jako_reset_password | hero |
| `ResetPasswordScreen` | `password` | 04_jako_password | hero |
| `VerifyPhoneScreen` | `verification` | 14_jako_verification | compact |
| `DeleteAccountScreen` | `confirm` | 09_jako_confirm | compact |
| `PurchaseIntentStatusScreen` (успех) | `success` | 06_jako_success | compact |
| `ErrorBoundary` (RN `Image`, без темы) | `warning` | 07_jako_warning | 96 pt |
| `LockScreen`, `SetPinScreen` | `password` | 04_jako_password | compact |
| `BecomePartnerScreen`, шаг welcome | `partner-welcome` | 08_jako_partner_welcome | hero |
| `BecomePartnerScreen`, шаг details | `partner-details` | 10_jako_partner_details | compact |
| `BecomePartnerScreen`, шаг offer | `partner-offer` | 11_jako_partner_offer | compact |
| `PartnerApplicationSentScreen` | `partner-submitted` | 12_jako_partner_submitted | hero |

Использовано 14 из 14 assets. `JakoWingMark` (векторный знак крыла)
остался на кнопках и в навигации — это часть логотипа, не иллюстрация.

### Изменённые файлы (без `demo/`)

- `apps/mobile/assets/jako/*.webp` — 14 новых файлов.
- `apps/mobile/src/presentation/components/JakoHero.tsx`, `JakoHero.test.tsx` — новые.
- `apps/mobile/src/app/ErrorBoundary.tsx`.
- `apps/mobile/src/presentation/screens/auth/{Login,OtpLogin,OtpRegister,Register,ForgotPassword,ResetPassword}Screen.tsx`.
- `apps/mobile/src/presentation/screens/appLock/{Lock,SetPin}Screen.tsx`.
- `apps/mobile/src/presentation/screens/settings/{VerifyPhone,DeleteAccount}Screen.tsx`.
- `apps/mobile/src/presentation/screens/purchase-intent/PurchaseIntentStatusScreen.tsx`.
- `apps/mobile/src/presentation/screens/partner-application/BecomePartnerScreen.tsx` (переписан в мастер), `BecomePartnerScreen.test.tsx` (новый, 5 тестов), `PartnerApplicationSentScreen.tsx`.
- `packages/i18n/src/locales/{en,ru,hy}.json` — `auth.tagline`, `becomePartner.welcomeTitle/welcomeBody/welcomePoint1-3/start/stepOf/detailsTitle/detailsBody/offerTitle/offerBody`.
- `docs/GOOGLE_PLAY_READINESS_2026-09-20_RU.md`, `docs/screenshots/jako-before-after-{1,2}.jpg`, `docs/screenshots/store-draft/{01-home,03-partners,04-referral,06-login-jako}.png`.
- `demo/` перегенерирован скриптом (32 файла).

Итого 41 файл, +648/−103 без `demo/`. Миграций нет, API не тронут.

### Партнёрский flow

Welcome (заголовок, три пункта, «Начать») → Details (юрназвание,
вывеска, ՀՎՀՀ по желанию; «Далее» неактивна, пока оба названия короче
2 символов — минимум сервера) → Offer (категория пиллами, кэшбэк,
«Отправить») → `PartnerApplicationSentScreen`. Счётчик «Шаг 1 из 2» на
шагах с полями. Кнопка «Назад» на первом шаге уходит с экрана. 409 от
сервера по-прежнему переводится в «уже на рассмотрении». Тест закрепляет
payload и параметры `navigation.replace`.

### Premium refinements (§8) — минимально

- Пиллы категорий в мастере — та же геометрия, что фильтр на карте:
  `radius.full`, без рамки, выбранная — брендовый зелёный.
- Warning-плитка на экране удаления аккаунта — круг вместо квадрата
  (последний квадратный status-mark в приложении).
- Подзаголовок на входе заменён слоганом.
- `Surface`, `ListRow`, bottom navigation, `HomeHeader`, Button,
  TextField, quick actions, Home, Wallet, Partners **не менялись**: они
  прошли pass 1–3 premium-доводки в PR #59/#60, и я не нашёл там
  card-in-card или лишних hairline, которые стоило бы трогать в этой
  ветке.

### Слоган

`auth.tagline` в трёх языках, показывается под логотипом на
`LoginScreen`. Единственное место; в сплеш и в стор не встроен.

## Что НЕ сделано

- **Samsung / Xiaomi / small Android / iOS** — не проверено: в сессии нет
  устройства, эмулятора и iOS-симулятора. Всё визуальное подтверждение
  сделано на web-экспорте Expo (Chromium 390×844 и 360×740).
- **`fontScale 1.3`** — не проверено. Web-экспорт не эмулирует системный
  масштаб шрифта Android.
- **Keyboard/focus regression** — не воспроизведено на устройстве.
  Гарантия только конструктивная: hero не зависит от событий
  клавиатуры, `KeyboardAwareScroll`/`useCompactLayout` не тронуты,
  их тесты зелёные.
- **Premium cleanup §8** сделан в трёх точках, не по всему списку.
  Осознанно: без device review менять `Surface`/`ListRow`/навигацию
  «на глаз» рискованно, а в брифе «не менять структуру ради красоты».
- **Before/after для Home и Settings** — сделаны, но разницы там нет
  (эти экраны не менялись), пары в листе 1 показывают это.
- **Before/after лист 2 неполный**: «before» для Partner Details, Partner
  Offer и Delete confirm — пустые ячейки `not captured` (скрипт снял
  только те экраны старой сборки, до которых дошёл без ошибки, и я не
  переснял их). Единственный «before» старой партнёрской формы попал в
  пару 08 partner-welcome; а в паре 11 partner-sent слева по ошибке
  снова низ старой формы, а не старый экран «заявка отправлена».
- **AAB не собран** — нет `EXPO_TOKEN`/EAS-кредита; `android-apk.yml`
  собирает только APK.
- **Тексты листинга Play, feature graphic** — не делал без утверждения
  позиционирования.
- **Тёмная тема для Жако**: WebP с прозрачным фоном, на тёмном фоне
  контур не проверялся на устройстве (web-снимок в тёмной теме есть в
  `dark-theme-2026-09-20.jpg`, но без Жако).

### Собственные ошибки по ходу

- `BecomePartnerScreen.test.tsx` первые два прогона висели больше 3
  минут без вывода: TanStack `MutationCache` держал GC-таймер на 5
  минут. Исправлено `gcTime: 0` на `QueryClient` в тесте.
- Тесты `JakoHero` первой версией не находили элемент: RNTL прячет узлы с
  `importantForAccessibility="no-hide-descendants"`. Исправлено
  `includeHiddenElements: true`; второй `render` в одном тесте заменял
  дерево — рендерю оба в одном фрагменте.
- Скрипт before/after снимков: «before»-сборка не показывала демо-кнопку,
  потому что в CORS локального API не было порта 8098. Добавил порт,
  переснял.
- CI на `0951a71` (run 897): «Build the container images» упал на
  экспорте GHA-кэша (`not_found`) в шаге Admin image; все остальные
  jobs зелёные. Перезапуск не сделал: пуш `ae791aa` запустил run 898,
  результат ниже.
- В начале брифа §2 читал asset 05 как «OTP entry для регистрации», а 03
  как «для входа» — перепутал; исправил маппинг до коммита.

## Чем доказано

| Проверка | Результат |
| --- | --- |
| `pnpm exec tsc --noEmit` (apps/mobile) | exit 0 |
| `pnpm exec eslint` (изменённые файлы) | exit 0 |
| `pnpm exec jest` (apps/mobile) | 72 suites, 634 tests, 0 failed, 17,6 s |
| из них `JakoHero.test.tsx` | 18 |
| из них `BecomePartnerScreen.test.tsx` | 5 |
| `scripts/build-demo-app.sh` | exit 0, `demo/` совпадает с источником (CI-шаг «demo matches» зелёный на run 897) |
| CI run 897 (`0951a71`) | Lint/test/build ✓, Integration 1–3 ✓, Container images ✗ (GHA cache export `not_found`, инфраструктура) |
| CI run 898 (`ae791aa`) | в процессе на момент записи (run 35517301074); итог будет дописан |
| Android APK run 65 (`ae791aa`, preview, local) | в процессе на момент записи (run 35517304323); итог будет дописан |
| Before/after | 12 пар на web-экспорте: `docs/screenshots/jako-before-after-1.jpg` (login, OTP-телефон, регистрация, forgot, PIN, home — все 6 пар полные), `-2.jpg` (settings, partner welcome/details/offer/sent, delete confirm — 3 из 6 «before» не сняты, см. «Что НЕ сделано») |

## UNVERIFIED

- Рендер на физическом Android (Samsung, Xiaomi), на маленьком экране,
  на iOS.
- `fontScale 1.3`.
- Клавиатура/фокус на устройстве после добавления hero над полями.
- Контраст и прозрачность WebP на тёмной теме на устройстве.
- Пропорции Жако на планшетах/складных экранах.
- Что `expo-image` на Android отдаёт WebP с альфой без артефактов по
  краю (на web чисто).
- Play: target API уровня собранного AAB (нет AAB).

## Google Play

Полная таблица — `docs/GOOGLE_PLAY_READINESS_2026-09-20_RU.md`. Сводка:

- READY IN CODE: иконка, splash, `applicationId`, permissions, release
  profile (`eas.json production`, AAB), удаление аккаунта в приложении,
  три языка.
- OWNER ACTION: developer account, `version`, Play App Signing и бэкап
  keystore, Data safety, скриншоты с устройства, feature graphic,
  описания, IARC, тестовый доступ для ревью.
- BLOCKED / EXTERNAL: privacy policy URL (плейсхолдеры `[OPERATOR]`,
  `[ADDRESS]`, `[CONTACT EMAIL]`, флаг `LEGAL_PAGES_ENABLED` выключен).

## Известные риски

- Бандл вырос на 1,7 МБ (WebP). Если понадобится ещё меньше — 512 px
  хватит для compact/inline, но hero на 3× экранах станет мягче.
- Стек из трёх веток: конфликт при слиянии #60 → dark-theme → #61
  маловероятен (разные файлы), но проверять при каждом шаге.
- `ErrorBoundary` рисует Жако через RN `Image`, не `expo-image` (там нет
  темы и провайдеров) — при падении до инициализации expo-image это
  безопаснее, но WebP через RN `Image` на старых Android < 4.2 не
  поддерживается. Приложение целится выше.

## Что намеренно не трогал

- Логотип, `JakoWingMark`, иконки навигации.
- `+374`, поля телефона, `KeyboardAwareScroll`, `useCompactLayout`.
- API, Prisma, миграции, Railway, флаги (PSP, refunds, prepaid, Idram,
  live EV).
- `Surface`, `ListRow`, bottom navigation, `HomeHeader`, Home, Wallet,
  Partners.
- PR #60 и `claude/dark-theme` — не мержил.

## Вопросы владельцу

1. Device review: поставить `apk-preview-65`, пройти вход → код →
   партнёрский мастер → удаление аккаунта (до подтверждения) и сказать,
   где Жако мешает или обрезан.
2. Утвердить слоган без точки в EN (`More possibilities, closer`).
3. Открывать ли PR для `claude/dark-theme`, чтобы цепочка #60 →
   dark-theme → #61 была видна в GitHub?
4. Нужны ли feature graphic и тексты листинга сейчас (см. readiness).

## Финальный статус

`NOT COMPLETE — нет проверки на Samsung/Xiaomi/малом экране/iOS (нет устройств в сессии), нет проверки fontScale 1.3 и keyboard/focus на устройстве, premium cleanup §8 сделан в трёх точках, а не по всему списку`
