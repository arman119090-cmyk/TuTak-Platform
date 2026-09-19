# TuTak Mobile — Premium Visual System

Дата: 19.09.2026. Документ описывает **фактическую реализацию** после
premium refinement (ветка `claude/premium-visual-refinement`), а не
желаемую систему. Источник токенов — `packages/design/src/tokens/*`,
компонентов — `apps/mobile/src/presentation/components/*`.

Принцип: premium = меньше шума. Один цвет действия, одна семья иконок,
три уровня глубины, четыре радиуса, шесть уровней текста. Всё, что не
попадает в эти списки, — не используется.

## Typography (`typography.ts` + `premiumTextWeights` в `premium.ts`)

Системный шрифт (SF / Roboto). Веса: 400 / 500 / 600. 700 не используется.

| Уровень | Стиль | Размер/интерлиньяж | Вес | Tracking | Где |
|---|---|---|---|---|---|
| Hero value | `text.balance` (в `BalanceCard` переопределён до 44/50) | 44/50 | 600 | −0.8 | баланс на Home, один на экран |
| Value | `text.balanceSm` | 30/38 | 600 | −0.4 | сумма на Wallet, реферальный код |
| Page title | `text.titleLg` | 26/32 | 600 | −0.3 | заголовок `Screen`, auth |
| Section / card title | `text.title` (22/30, −0.2) и `text.headline` (17/24, −0.1) | | 600 | | заголовки секций, имя в Settings, значения в строках |
| Primary content | `text.body` 17/24, `text.bodySm` 15/22 | | 400 | 0 | строки, подписи полей |
| Secondary / metadata | `text.label` 15/22 (500), `text.caption` 13/18 (400) | | | 0 | подзаголовки, даты, статусы |

Правила: цифры — `fontVariant: ['tabular-nums']` (значения в `ListRow`,
hero, код). Отрицательный tracking не ниже −0.8 и только ≥ 26 px; для
армянского этого достаточно, отдельных override нет (проверено на
`hy` в скриншотах). `overline` (11 px uppercase) больше не используется в
mobile.

## Spacing (`layout.ts`, сетка 4 pt)

| Роль | Значение |
|---|---|
| Page gutter | 20 (`layout.screenPaddingX`) |
| Card padding | 20 (`space[5]`), hero 24 |
| Section top → header | 32 (`SectionHeader.marginTop`), header → content 12 |
| Row vertical padding | 14 (`ListRow`), разделитель inset |
| Card-to-card | 12–16 |
| Element inside row (icon → text) | 12 |
| Bottom clearance | `useTabBarSpace()` (tab bar + safe area + 24) |

## Radius (`premiumRadius`)

| Токен | Значение | Применение |
|---|---|---|
| `sm` | 10 | чипы, маленькие плитки |
| `md` | 14 | **все controls**: кнопки, поля, поиск, иконка-плитка |
| `lg` | 20 | карточки и группы (`Surface`) |
| `xl` | 24 | hero (`BalanceCard`), брендовая карточка кода |
| `full` | pill | аватары, центральная QR-кнопка, StatePill |

`2xl` (28) остаётся в токенах, в mobile не используется.

## Borders

Разрешены только: поле ввода в покое (`neutral[200]`, 1 px) и фокус
(`brand[600]`, 1 px). **Не разрешены**: рамки на карточках, на tab bar,
на пилюлях состояния, вокруг иконок, на кнопках. `glass.border` остался
в токенах для map-chips и sheet'ов, `Surface` его не рисует.

## Separators

Только внутри группы строк (`ListRow`): 1 px hairline `neutral[100]`,
**inset** — начинается от текстовой колонки, не от края; на последней
строке (`last`) не рисуется. Между секциями — воздух, не линии.

## Shadows (`lightPremiumGlow`, нейтральный ink #101828)

| Уровень | Где | Native |
|---|---|---|
| `sm` | `Surface tone="raised"` | opacity 0.06, radius 10, y 3, elevation 1 |
| `md` | hero, `Surface elevated`, карточка кода | 0.10 / 20 / y 8 / elevation 3 |
| `lg` | зарезервировано для sheet / floating control | 0.14 / 28 / y 12 / elevation 6 |

Glow (цветная тень) не используется нигде. Кнопки, tab bar, аватары —
без тени (tab bar — только 0.06 вверх).

## Gradients

Один: scrim поверх hero-фото (`BalanceCard`), от `rgba(7,60,38,0.92)` слева
до 0.02 справа — это не декор, а контраст для текста. Fallback hero без
фото — `gradients.primary` (два шага бренда). Кнопки — **solid**
`brand[600]`. Коралловый `gradients.secondary` из UI убран (реферальная
карточка — solid `brand[600]`).

## Icons

| Семья | Где | Размер / stroke |
|---|---|---|
| Jako v2 (`V2NavIcon`) | tab bar, referral entry | 24–26 px, stroke 2.6 (одинаковый для active/inactive; состояние — цветом) |
| Ionicons outline | всё остальное (settings rows, quick actions, поиск, уведомления, chevrons, back) | 22 px в строках/кнопках, 18 px chevron, 26 px back |
| `JakoWingMark` | подпись на primary/secondary CTA | 14–16 px |

Цвета: active `brand[600]`, inactive `neutral[400]`, в строках
`textSecondary`, chevron `neutral[300]`. **Контейнеры под иконкой** только
там, где иконка — самостоятельная цель нажатия (QuickAction 52 px
`neutral[50]`, HomeHeader bell 44 px `neutral[100]`, тип транзакции без
партнёра 40 px `backgroundSubtle`). В Settings-строках контейнеров нет —
иконка в колонке 28 px.

## Cards / Surfaces (`Surface`)

| `tone` | Вид | Где |
|---|---|---|
| `raised` (default) | белая, shadow `sm`, без рамки | Wallet-баланс (`elevated` → md), карточки контента |
| `subtle` | `neutral[50]`, без тени и рамки | группы строк (Settings, History, Wallet history), referral entry, статистика |
| `plain` | без фона | контент прямо на странице |

Blur не используется — iOS и Android рисуют одно и то же.

`AvatarControl` (фото в Settings) остаётся `raised`: внутри него кнопка
`secondary` (`neutral[100]`) и переключатель — на сером `subtle` они
сливаются с фоном. Между ним и следующей серой группой — отступ 12.

## Switch

`trackColor` — on `brand[600]`, off `neutral[300]`; thumb белый. Раньше
off-дорожка была `surfaceSunken`, что на серых группах Settings делало
переключатель невидимым (оставался один кружок).

## Balance legend (`BonusComposition`)

На hero (`tone="onBrand"`) — строчные элементы «● метка значение»,
`flexWrap` на вторую строку, когда язык требует («Зарезервировано»,
армянский). Ничего не сжимается (`adjustsFontSizeToFit` не работает
одинаково на всех платформах) и ничего не обрезается. Везде, кроме hero —
одна строка на состояние, значение справа, tabular.

## Buttons (`Button`)

Высоты 52 / 44 / 36, radius `md`, текст `headline`. `primary` — solid
`brand[600]`, pressed `brand[800]`; `secondary` — `neutral[100]`, pressed
`neutral[200]`; `tertiary` — текст `brand`; `destructive` — `danger[50]`,
текст `danger[700]`. Pressed: scale 0.98 + смена тона. Disabled: opacity
0.45. Один primary на экран.

## Inputs (`TextField`)

Покой: `backgroundSubtle` + 1 px `neutral[200]`; фокус: белый + 1 px
`brand[600]` + едва заметная тень (0.08/6; объект `ring` сохранён — часть
доказанного Android-фикса, `collapsable={false}` не трогать); ошибка:
`danger[500]`. Высота ≥ 52, radius `md`, label 13/500 над полем.

## Navigation (`MainTabNavigator`)

Белый tab bar без верхней линии (тень 0.06 вверх), иконки 24, подписи
11/500 (11, а не 12: армянские подписи «Դրամապանակ» на 390 pt иначе
режутся), active `brand[600]`, inactive `neutral[400]`. Центральная кнопка
Pay — круг 46 px solid `brand[600]` всегда (pressed/focused `brand[800]`),
без градиента и свечения. Back в `Screen` — chevron 26 в круге 36 с
pressed-фоном.

## Motion (`motion.ts`)

Press: spring `snappy`, scale 0.98 (кнопки), 0.97 (плитки), opacity 0.5–0.8
(текстовые ссылки, строки — фон `neutral[100]`). Composition bar: 420 мс.
Skeleton: пульс 700 мс. Экранные переходы — платформенные по умолчанию.
Ничего не «летает».

## Haptics

Не используются (в проекте нет `expo-haptics`; добавление нативного
модуля отложено до после пилота — см. отчёт, Owner review).

## Accessibility

Min touch target 44 (кнопки 52/44, back 36 + hitSlop 16, chevron-строки
≥ 48 высотой); `maxFontSizeMultiplier` 1.3 на кнопках, `minHeight` вместо
`height`; `accessibilityLabel` на аватаре, колокольчике, referral entry,
полях; контраст: текст ≥ `neutral[500]` на белом (4.6:1), `brand[600]` на
белом 7.2:1, белый на `brand[600]` 7.2:1.
