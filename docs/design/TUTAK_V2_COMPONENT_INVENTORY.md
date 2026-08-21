# TuTak v2 — component and copy inventory for Claude

This file turns the visual boards into an implementation checklist. The SVG files are the visual source of truth; this inventory fixes the required labels, states and restrictions. All text is localized in-app — it is **not** baked into the illustrations.

## Required visual sources

| Item | Open first | Exact use |
| --- | --- | --- |
| Product overview | `TUTAK_V2_DESIGN_PREVIEW.svg` | Home, Map, QR, Wallet hierarchy |
| Referral network | `TUTAK_V2_REFERRAL_PREVIEW.svg` | three-level referral screen and privacy rules; vector source scales without loss |
| Component sheet | `TUTAK_V2_COMPONENT_SHEET.svg` | buttons, fields, chips, status pills and navigation; vector source scales without loss |
| Hero image | `assets/tutak-home-hero-parrot-v2.jpg` | Home balance-card background only |
| Small Jako brand mark | `packages/design/src/brand/jako.svg` | logo, empty states and small brand moments |

## Foundation tokens

| Role | Token/value | Rules |
| --- | --- | --- |
| Primary action | `brand-600` / `#00B676` | full-width positive CTA only |
| Brand dark | `brand-700` / `#0B5D3B` | headings/gradients, not an arbitrary alternative button green |
| Informational | `info` / `#2F80ED` | map/location/neutral information |
| Pending | `warning` / `#F59E0B` | pending, time-sensitive status only |
| Danger | `danger` / `#E5484D` | error/rejection/destructive action only |
| Radius | 12 / 16 / 20 / 24 px | chips / buttons / cards / hero sheets |
| Layout grid | 4 px | rhythm: 8 / 12 / 16 / 24 / 32 px |

## Shared controls

| Component | Required labels / variants | State rules |
| --- | --- | --- |
| Primary button | `Сканировать QR`, `Поделиться кодом`, `Начать зарядку` | green; disabled only with a visible reason; 44px touch target minimum |
| Secondary button | `Копировать код`, `Показать мой QR`, `Все` | white/quiet border; never visually equal to a primary CTA |
| Destructive button | `Отклонить` | danger only after a confirmation dialog |
| Search field | `Поиск адреса или партнёра` | search icon, clear/filters, keyboard-safe |
| Chips | `Станции`, `Магазины`, `Кафе`, `Рестораны`, `Ещё` | icon + text; selection is not colour-only |
| Status pill | `Ожидает`, `Подтверждено`, `Отклонено`, `Истёк` | server state only; colour plus text/icon |
| Bottom nav | `Главная`, `Карта`, `QR`, `Кошелёк`, `Профиль` | QR is central/larger; referral is accessed from Home and Profile, not a sixth tab |

## Screen-critical copy

| Screen | Required visible content |
| --- | --- |
| Home | `Доступно для скидки`, optional `Зарезервировано`, `Сканировать QR`, `Начать зарядку`, `Найти партнёра`, referral entry `Пригласить друзей` / `Моя сеть` |
| Map | `Карта`, `Станции и партнёры рядом`, `Рядом с вами`, `Показать все` |
| QR | `Оплата QR`, `Покажите QR партнёру`, `Как это работает` |
| Wallet | `Доступно для скидки`, `Зарезервировано`, `Получено всего`, `История` |
| Referrals | `Моя сеть`, `Ваш реферальный код`, `Приглашены лично`, `Друзья друзей`, `Следующий уровень`, `Открыть список друзей` |

## Referral privacy contract

1. **Level 1:** list only the user’s personally invited people; render first name + last initial and optional consented avatar. Status/date only if returned by the server.
2. **Levels 2 and 3:** render aggregate count only. No drill-down, identities, contact data, relationship paths, per-person purchases, reward amounts or referral links.
3. Do not display a fake `0` while the three-level response is missing. Use loading/unavailable/error state.
4. Rates are explanatory (`1%`, `0,5%`, `0,5%` of the partner commission pool). No client-side calculation of rewards, chain or qualification.
5. Referral Challenge progress is separate from network depth. Display it only from server truth.

## Mandatory UI states for every changed screen

- loading/skeleton;
- empty state with a useful next step;
- error with retry and no invented value;
- offline/read-only where relevant;
- long Russian, Armenian and English strings;
- 360dp Android and 390pt iPhone widths;
- safe area and keyboard navigation;
- screen-reader label plus text state, not colour alone.
