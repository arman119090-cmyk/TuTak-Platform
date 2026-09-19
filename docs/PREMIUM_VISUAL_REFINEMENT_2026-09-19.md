# TuTak Mobile — Premium Visual Refinement. Отчёт 2026-09-19

**FINAL VERDICT: NOT COMPLETE — код, тесты и документ визуальной системы
готовы и лежат в PR; не выполнена проверка на реальных устройствах (§30
задания) и screenshot matrix снят с web-рендера demo, а не с нативной
сборки (§27). Всё, что можно было проверить без телефона, проверено.**

Ветка: `claude/premium-visual-refinement` (отдельная от PR #58).
База: `369eda1` (`origin/main`, 2026-09-19).
Документ системы: `docs/TUTAK_PREMIUM_VISUAL_SYSTEM.md`.
Скриншоты: `docs/screenshots/premium-visual-refinement/{before,after}/`.

---

## 0. Задание (пересказ)

Владелец: «наш дизайн выглядит очень дёшево… мне нужен очень хороший,
очень богатый дизайн»; место рефералов не нравится, «но не в этом суть».
Спецификация «TUTAK MOBILE — PREMIUM VISUAL REFINEMENT» (32 пункта):

- Это **не редизайн**: сохранить архитектуру экранов, флоу, бренд,
  Jako / African Grey, светлую тему, IA, цвета бренда, функциональность.
- Premium = меньше шума: меньше рамок и hairline, меньше «коробка в
  коробке», меньше декоративных цветов, точная типографика, контролируемый
  воздух, строгая система размеров, единые иконки, лёгкая глубина без
  дешёвых теней, консистентность.
- Сначала визуальный аудит (не верить словам «premium» в названиях).
  Аудиты: рамок, иконок, tab bar, типографики (включая армянский),
  отступов, радиусов, Surface (blur iOS vs flat Android), glow,
  градиентов, кнопок, инпутов (не ломать keyboard/focus fix), Home как
  композиция, hero баланса, Settings спокойнее, Wallet/операции —
  «значения первыми», Partners, Auth, пустые/loading состояния, motion,
  haptics, accessibility.
- Написать `docs/TUTAK_PREMIUM_VISUAL_SYSTEM.md` по факту реализации.
- Reference-экраны: Home, Login, Settings; затем остальные.
- Screenshot matrix before/after.
- Без изменений API, финансов, QR, auth, маршрутов навигации.
- Тесты: unit, typecheck, lint, demo parity, keyboard/focus регрессия.
- Отдельная ветка/PR от PR #58; без money/infra изменений.
- Финальный отчёт с разделами A–J и вердиктом.

Ограничения прошлых задач остаются в силе (PSP, refunds, top-up, Idram,
live EV, банковские операции, prod DB, load test, секреты — не трогал).

---

## A. WHY IT LOOKED CHEAP — что именно и в каких файлах

Аудит по коду и по before-скриншотам (`shots-before`, web-рендер demo,
390×844 @2x). Всё ниже — реальные причины, а не вкусовщина:

| # | Причина | Где было |
|---|---|---|
| 1 | **Рамка + тень на каждой карточке** одновременно (hairline `glass.border` + `glow.sm`), плюс `BlurView` на iOS и плоский фон на Android — два разных приложения | `components/Surface.tsx` |
| 2 | **Зелёный цветной glow** (`lightPremiumGlow` = brand-tinted тень) под hero, кнопками, аватаром — «светящиеся» элементы читаются как дешёвый шаблон | `packages/design/src/tokens/light-premium.ts`, `Button.tsx`, `HomeHeader.tsx`, `BalanceCard.tsx` |
| 3 | **Градиентные кнопки** (`LinearGradient` primary) и **коралловый градиент** referral-карточки — второй акцентный цвет без причины | `Button.tsx`, `ReferralEntryCard.tsx`, `MainTabNavigator.tsx` (градиентная pill у центральной кнопки) |
| 4 | **Header Home в стеклянной карточке** с аватаром в glow-кольце: карточка над карточкой над карточкой | `HomeHeader.tsx` |
| 5 | **Тонированные квадраты под каждой иконкой** (синий под молнией, зелёный под картой, зелёный под referral, иконки в Settings в плитках) — 4–5 декоративных цветов на одном экране | `QuickAction.tsx`, `SettingsScreen.tsx (SettingIcon)`, `ReferralEntryCard.tsx`, `TransactionIcon` в `HomeScreen.tsx` |
| 6 | **Разделители на всю ширину** внутри карточек + рамка карточки = сетка из линий | `ListRow.tsx` |
| 7 | **Tab bar**: верхняя hairline, градиентная pill, разный stroke иконок active/inactive | `MainTabNavigator.tsx` |
| 8 | **Типографика**: 700 везде, tracking до −1, `overline` uppercase с letterSpacing в заголовках дней — «кричащая» иерархия | `packages/design/src/tokens/premium.ts (premiumTextWeights)`, `TransactionHistoryScreen.tsx` |
| 9 | **Радиусы 8/14/20/24/32** без правила: hero 32, карточки 20, кнопки 14, чипы full | `premium.ts (premiumRadius)` |
| 10 | **Легенда баланса ломалась**: «В ожидании» переносилось на две строки, «Зарезервировано» обрезалось; pill «Моя сеть» на referral-карточке переносил заголовок | `BonusComposition.tsx`, `ReferralEntryCard.tsx` (видно на before `02-home`, `03-wallet`) |
| 11 | **StatePill с рамкой** и заливкой одновременно; Skeleton на сером с рамкой | `StatePill.tsx`, `Skeleton.tsx` |
| 12 | **Pressed scale 0.96** на кнопках — заметный «прыжок» | `Button.tsx` |

## B. Design system — до / после

| Слой | Было | Стало |
|---|---|---|
| Радиусы | 8 / 14 / 20 / 24 / 32 / full | `sm 10` (контролы) / `md 14` (компактные карточки, кнопки, инпуты) / `lg 20` (основные карточки) / `xl 24` (hero) / `2xl 28` (резерв) / full |
| Веса | 700 для balance/title/headline, tracking до −1 | всё `600`; tracking balance −0.8, balanceSm −0.4, titleLg −0.3, title −0.2, headline −0.1 (армянский не «слипается») |
| Тени | brand-green glow: sm 0.18 / md 0.24 / lg 0.32 | нейтральный ink `#101828`: sm 0.06/10/y3, md 0.10/20/y8, lg 0.14/28/y12; elevation 1/3/6 |
| Glass | `rgba(255,255,255,0.72)` + blur (iOS) | `rgba(16,24,40,0.03)`, без blur; токен оставлен для карты (`TileMap`) |
| Рамки | hairline на каждой Surface, tab bar, чипах, инпутах, pill | только: инпут в покое `neutral[200]`, фокус `brand[600]`, выбранный чип partner |
| Разделители | full-width `color.border` | inset-hairline `neutral[100]` внутри текстовой колонки, скрыт у `last` |
| Градиенты | primary-кнопки, referral coral, tab pill | только scrim на фото hero и fallback hero без фото (`gradients.primary` = brand 500→700); `secondary` (coral) в токенах остался, в UI не используется |
| Иконки | Ionicons + Jako v2 + тонированные плитки | Ionicons outline 22 для строк/утилит, Jako v2 (`V2NavIcon`, stroke 2.6) для tab bar и referral, плитки только у Quick actions (нейтральные `neutral[50]`) и referral (белая) |
| Кнопки | gradient, glow, scale 0.96, высоты 54/46/38 | solid `brand[600]`/pressed `brand[800]`, secondary `neutral[100]`/200, tertiary прозрачная, destructive `danger[50]`; scale 0.98; высоты 52/44/36; disabled 0.45 |
| Инпуты | белые с рамкой `glass.border`, label 600 | покой `backgroundSubtle` + `neutral[200]`; фокус белый + `brand[600]` + тень 0.08; label caption/500; высота 52; `selectionColor` brand |
| Surface | один вид (белая, рамка, тень, blur) | `raised` (белая, тень sm/md, без рамки) / `subtle` (`neutral[50]`, плоская) / `plain` |
| Tab bar | hairline сверху, gradient pill, stroke меняется | белый, без линии, тень 0.06 вверх, подписи 11/500, иконки stroke 2.6 всегда, Pay — диск 46 solid `brand[600]` |
| Switch | on `availableSurface` (бледный), off `surfaceSunken` (невидим на сером) | on `brand[600]`, off `neutral[300]`, thumb белый |

Токены: `packages/design/src/tokens/premium.ts` (`premiumRadius`,
`premiumTextWeights`), `packages/design/src/tokens/light-premium.ts`
(`lightPremiumGlass`, `lightPremiumGlow`, `gradients`).

## C. Экран за экраном: проблема → изменение → почему

**Home** (`HomeScreen.tsx`, `HomeHeader.tsx`, `BalanceCard.tsx`,
`BonusComposition.tsx`, `QuickAction.tsx`, `ReferralEntryCard.tsx`)
- Header-карточка со стеклом и glow-аватаром → плоская строка: аватар 44,
  caption «С возвращением» + имя `title`, колокольчик в нейтральном круге
  44. Причина: header не должен конкурировать с hero.
- Hero: радиус 32 → 24; scrim глубже слева (0.92→0.02, locations
  0/0.42/0.78/1) — цифры читаются, Jako остаётся справа; число 44/50
  tabular вместо 56/62 (шестизначный баланс переносился на компактных).
- Легенда hero: три колонки с переносом/обрезкой → строчные «● метка
  значение» с `flexWrap` (RU и HY — на двух строках, ничего не обрезано).
  Первая версия использовала `adjustsFontSizeToFit` — на web-рендере он не
  работает, «Зарезерви…» обрезалось; заменил на перенос.
- Кнопка «Сканировать QR»: gradient+glow → solid.
- Quick actions: синяя/зелёная плитки → нейтральные `neutral[50]` 52×52,
  иконка brand, подпись `label` основным цветом.
- Referral entry: карточка с рамкой, зелёной плиткой и pill «Моя сеть»,
  заголовок переносился → одна строка на серой группе: белая плитка 44 с
  Jako-иконкой, headline + caption, chevron; вся строка — кнопка. Место
  (после quick actions, перед операциями) **не менял** — владелец сказал
  «не в этом суть»; вынесено в Owner review.
- Transaction rows: цветные плитки → нейтральная плитка `backgroundSubtle`,
  сумма tabular справа, inset-разделители.

**Login** (`LoginScreen.tsx`, `TextField.tsx`, `Button.tsx`)
- Марка 56 (была 64), заголовок `titleLg`, подзаголовок `body`.
- Инпуты: серый покой без «двойной рамки», label 13/500; фокус — белое
  поле с brand-рамкой. `collapsable={false}`, `ring`, диагностика,
  `traceId` — не тронуты (diff по этим строкам: 0 изменений, только
  комментарий).
- Primary без градиента; disabled 0.45 вместо 0.5.
- «Забыли пароль?» с pressed-opacity 0.5.

**Settings** (`SettingsScreen.tsx`, `AvatarControl.tsx`, `ListRow.tsx`)
- Identity-блок из белой карточки → без рамки: аватар 64, имя `title`,
  телефон.
- Убран SectionHeader «Мои данные» над одной строкой и SectionHeader
  «Стать партнёром», дублировавший заголовок строки под ним.
- Все группы — `Surface tone="subtle"` без тени, строки с inset-hairline,
  иконки Ionicons 22 без плиток, chevron `neutral[300]`.
- `AvatarControl` остался `raised` (внутри secondary-кнопка и switch — на
  сером они пропадали; проверено на скриншоте и откачено), между ним и
  следующей группой отступ 12.
- Switch: видимая дорожка (см. B).

**Wallet** (`WalletScreen.tsx`)
- Баланс — `raised elevated`; легенда — построчно, значения справа
  tabular (было: три колонки, «В ожидании» в две строки).
- «Всего начислено / потрачено» — `subtle`; expiring/history — серые
  группы с inset-разделителями; иконка лота — белая плитка, без оранжевой
  заливки.

**Transactions** (`TransactionHistoryScreen.tsx`)
- Заголовок дня: `overline` UPPERCASE → `label` `textSecondary`.
- Группы `subtle`, иконка — белая плитка, сумма tabular.

**Partners** (`PartnersScreen.tsx`)
- Поиск: рамка → `backgroundSubtle` без рамки.
- Чипы: неактивные без рамки (`backgroundSubtle`), активный solid brand.
- Карточки партнёров — `raised` без hairline (через Surface).

**Referral** (`ReferralScreen.tsx`)
- Градиент → solid `brand[600]` карточка кода, радиус 24, тень md, код
  tracking 1.5 tabular; статистика/уровни — `subtle`; блок «пока
  недоступно» — белая вставка.

**Notifications**, **EmptyState**, **Skeleton**, **StatePill**, **Screen**
- Карточки уведомлений `subtle`; EmptyState марка 48 @0.45, воздух 36;
  Skeleton `neutral[100]`; StatePill без рамки; back-chevron в круге 36 с
  pressed-фоном, header paddingTop 12.

Экраны, получившие изменения только через общие компоненты (Surface,
Button, ListRow, TextField, SectionHeader): PartnerDetail, Purchase intent
(3 экрана), ProviderPayment, ScanQr, MyQr, EV (History, Session),
BecomePartner, EditProfile, DeleteAccount, Otp/Register. Их я **не
просматривал на скриншотах** (см. UNVERIFIED).

## D. Удалённый визуальный шум (список)

1. Hairline-рамка на всех `Surface` (≈40 карточек по приложению).
2. `BlurView` (iOS-only стекло) в Surface и HomeHeader.
3. Brand-green glow под hero, кнопками, аватаром, tab-pill.
4. Градиент primary-кнопок (все экраны) и коралловый градиент referral.
5. Glow-кольцо аватара и стеклянная карточка header на Home.
6. Тонированные квадраты под иконками: Settings (6), Quick actions (2),
   referral, транзакции, expiring lots.
7. Верхняя линия tab bar и градиентная pill центральной кнопки.
8. Full-width разделители в ListRow (заменены на inset).
9. Рамка у StatePill, Skeleton, чипов Partners, поля поиска.
10. Uppercase overline в заголовках дней истории.
11. Pill-кнопка «Моя сеть» внутри referral-карточки.
12. Два дублирующих SectionHeader в Settings.

## E. Icon system — что сделал

- **Jako v2 (`V2NavIcon`/`JakoWingMark`)** — tab bar (5), referral entry,
  иконка в кнопках (`JakoWingMark` 16). Stroke 2.6 одинаковый для active
  и inactive, состояние — цветом.
- **Ionicons outline 22** — строки Settings, chevron, back, колокольчик,
  утилиты. Chevrons `neutral[300]`/`[400]`.
- **Плитки** оставлены только там, где они держат ритм: Quick actions
  (нейтральные), referral (белая на сером), транзакции/лоты (белая или
  `backgroundSubtle`). Цвет плитки больше не кодирует «тип».
- **Логотип-фото** (`logo-mark.png`) — Login, EmptyState, аватар-фолбэк;
  не менял по требованию владельца от 2026-08-23.
- **PartnerMark** — не трогал.
- Не сделано: единый набор Jako-иконок для строк Settings (сейчас
  Ionicons) — это отдельная работа по отрисовке, не refinement.

## F. Android vs iOS

- Surface, HomeHeader: раньше iOS получал blur, Android — плоский фон.
  Теперь один рендер: белая/серая плоскость + тень (`shadow*` на iOS,
  `elevation` на Android — из одного токена `lightPremiumGlow`).
- Tab bar: `borderTopWidth: 0` на обеих; тень вверх — iOS shadow / Android
  elevation.
- Switch: явные `trackColor`/`thumbColor` — одинаковый вид на обеих.
- Легенда hero: убран `adjustsFontSizeToFit` (разное поведение
  платформ) в пользу переноса.
- **Не проверено на устройствах** (см. UNVERIFIED): тени Android
  `elevation` могут выглядеть плотнее, чем iOS `shadowOpacity 0.06`.

## G. Accessibility

- Все `accessibilityRole`/`accessibilityLabel` сохранены (15 строк в
  diff — только переиндентация, ни одна не удалена).
- Touch targets: кнопки 52/44/36 (мин. 36 только для `sm`), back 36 +
  hitSlop 16, аватар/колокольчик 44, tab Pay 46, ListRow ≥ 48.
- Контраст: подписи tab `neutral[400]` на белом ≈ 3.5:1 (для 11 px это
  ниже AA 4.5:1 для мелкого текста; was `textTertiary` — не хуже, чем
  было; вынесено в Owner review).
- Легенда hero: label `rgba(255,255,255,0.72)` на тёмно-зелёном — ок.
- `maxFontSizeMultiplier` в кнопках не менялся.

## H. Регрессии — что могло сломаться и что проверено

- **TextField / keyboard-focus fix**: структурно не тронут; `KeyboardAwareScroll.test.tsx`
  и `TextField`-тесты зелёные (изменил только ожидание minHeight 54→52).
- **Button.test.tsx**: обновлены высоты 54/46/38 → 52/44/36.
- **Тесты, которые я сломал и починил**: 5 (4 в Button.test, 1 в
  KeyboardAwareScroll.test) — ожидания старых размеров.
- **ESLint**: 2 unused-переменные после правок (`focused` в tab-иконке,
  `glass` в PartnersScreen) — удалены.
- **Demo parity**: `scripts/build-demo-app.sh` прогнан 4 раза; итоговый
  `demo/` = регенерация из текущего `apps/mobile` (CI-проверка «The demo
  app matches…» пройдёт при условии, что lockfile принят — см. ниже).
- **demo/package-lock.json**: `npm ci` в demo падал (в lock не было
  `expo-location` и `react-native-webview`, которые есть в
  `demo/package.json`) — `npm install` добавил их (+32/−4 строки).
  Это не мой регресс, а найденный stale-lock; включил в PR.
- Навигация/API: в diff по `apps`+`packages` 0 строк с
  `navigation.navigate/replace`, `*Api.`, `queryKey`.

## I. Screenshots

`docs/screenshots/premium-visual-refinement/before/` (8 файлов) и
`after/` (11 файлов), web-рендер demo (Expo web export, Chromium 390×844
@2x, demo-сессия на моках):

| Файл | Before | After |
|---|---|---|
| 01-login | ✓ | ✓ |
| 02-home, 02b-home-scrolled | ✓ | ✓ |
| 03-wallet | ✓ | ✓ |
| 04-partners | ✓ | ✓ |
| 05-settings, 05b-settings-scrolled | ✓ | ✓ |
| 06-history | ✓ | ✓ |
| 07-referral | — (шаг скрипта падал на `goBack`) | ✓ |
| 08-settings-hy, 09-home-hy | — (то же) | ✓ |

Сравнение (по пунктам §27): выравнивание — единая левая кромка 20 pt на
всех экранах; иерархия — один hero, одна primary-кнопка, заголовки 600;
плотность — Home стал короче на ~120 pt при том же содержимом; рамки —
0 hairline на Home/Settings/Wallet (было 6–9 на экран); иконки — два
семейства с ясными ролями; типографика — без 700 и uppercase;
воздух — секции 32/12 вместо разнобоя 16–24.

## J. Owner review — 5 решений (не больше)

1. **Место referral-блока на Home.** Оставил как есть (после quick
   actions). Варианты: перенести в Settings/Profile как строку; или в
   конец Home после операций. Нужно ваше слово — это IA, не визуал.
2. **Haptics.** В проекте нет `expo-haptics`; предлагаю не добавлять до
   пилота (новый нативный модуль = новая сборка и риск). Да/нет?
3. **Подписи tab bar 11 pt.** Армянское «Դրամապանակ» всё равно
   обрезается на 390 pt (было так же). Варианты: короче слово в `hy.json`
   («Դրամ.») или скрыть подписи, оставив только иконки.
4. **Hero-фото.** Оставил фото Jako с более глубоким scrim. Альтернатива —
   solid brand-карточка без фото (fallback уже есть, `gradients.primary`).
   Сравнить на устройстве.
5. **Коралловый `gradients.secondary` и `glass` токены** — оставлены в
   `packages/design` (не используются в UI, кроме `TileMap`). Удалить в
   следующем PR или оставить для админки?

---

## Что сделано (файлы)

Токены: `packages/design/src/tokens/premium.ts`, `light-premium.ts`.
Компоненты (`apps/mobile/src/presentation/components/`): Surface, ListRow,
SectionHeader, Button (+test), TextField, Skeleton, StatePill, HomeHeader,
QuickAction, BalanceCard, BonusComposition, ReferralEntryCard, EmptyState,
Screen, AvatarControl, KeyboardAwareScroll.test.
Навигация: `app/navigation/MainTabNavigator.tsx`.
Экраны: Home, Login, Settings, Wallet, TransactionHistory, Referral,
Notifications, Partners.
Документы: `docs/TUTAK_PREMIUM_VISUAL_SYSTEM.md` (новый, 190 строк),
этот отчёт, скриншоты.
Demo: `demo/` регенерирован, `demo/package-lock.json` дополнен.
Миграций нет. API/бэкенд не тронуты.

## Что НЕ сделано

- **Проверка на устройствах Samsung/Xiaomi (§30)** — нет сборки APK в
  этой сессии и нет устройства. Тени `elevation`, Switch на Android,
  перенос легенды на 360 pt — не видел.
- **Нативные скриншоты (§27)** — только web-рендер demo. Web не рисует
  тени/elevation так же, как native; blur/haptics не оцениваются.
- **Экраны без скриншотов**: PartnerDetail, Purchase intent, ProviderPayment,
  ScanQr, MyQr, EV, BecomePartner, EditProfile, DeleteAccount, Otp/Register,
  ForgotPassword — изменены только через общие компоненты, глазами не
  проверял.
- **Единый набор Jako-иконок для Settings** — не рисовал (E).
- **Haptics (§22)** — только оценка, без реализации.
- **Тёмная тема** — не в задании, не трогал (`premium.ts` dark-схема
  осталась).
- **Собственные ошибки по ходу работы:**
  1. Первая версия легенды hero на `adjustsFontSizeToFit` — на web
     обрезала «Зарезервировано»/армянский; переделал на перенос.
  2. Перевёл `AvatarControl` на серую `subtle`-поверхность — secondary-
     кнопка и switch стали невидимы; откатил на `raised`, добавил отступ.
  3. Switch с `surfaceSunken` off-дорожкой на серых группах пропадал —
     заметил только по скриншоту Settings, а не при аудите кода.
  4. Tab label 12 pt резал армянский сильнее, чем 11; вернул 11 (проблема
     осталась, см. J.3).
  5. Скрипт скриншотов: `page.goBack()` не работал с react-navigation на
     web — referral/hy before-кадры не сняты; в after использую кнопку
     Back по `accessibilityLabel`. Before для referral/hy отсутствуют.
  6. Первый запуск regen-скрипта из `apps/mobile` упал (относительный
     путь) — перезапустил с абсолютным.
  7. Сломал 5 тестов размерами кнопок/поля — обновил ожидания (это
     намеренное изменение размеров, не баг тестов).

## Чем доказано

| Проверка | Результат |
|---|---|
| `pnpm exec jest` (apps/mobile) | 64 suites / 530 tests passed, 0 failed |
| `pnpm exec tsc --noEmit -p tsconfig.json` (apps/mobile) | exit 0 |
| `pnpm exec eslint src` (apps/mobile) | 0 ошибок, 0 предупреждений |
| `scripts/build-demo-app.sh` | 4 запуска, последний = содержимое `demo/` |
| `expo export --platform web` (demo) | 4 экспорта, exit 0 |
| Playwright screenshot run (after) | 11 кадров, `pageerror` = 0 |
| Diff `apps`+`packages` | 28 файлов, +496/−528; 0 строк навигации/API |
| a11y-атрибуты в diff | 15 строк, все — переиндентация |

## UNVERIFIED

1. Вид на реальных Android (Samsung One UI, Xiaomi MIUI) и iOS.
2. Тени `elevation` 1/3/6 на Android — плотность относительно iOS.
3. Легенда hero и tab-подписи на 360 pt ширине и при `fontScale` 1.3.
4. Экраны из списка «без скриншотов» выше.
5. CI-проверка demo parity на GitHub (запустится после push PR).
6. Поведение фокуса/клавиатуры на устройстве после визуальных правок
   TextField (unit-тесты зелёные, устройство — нет).
7. Работоспособность `npm ci` в `demo/` с обновлённым lock на чистой
   машине (локально `npm install` прошёл; `npm ci` после него не гонял).

## Вопросы владельцу

См. раздел J (5 решений). Дополнительно: нужен ли rebuild APK из этой
ветки для проверки на устройстве до merge, или сначала merge в `main`?
