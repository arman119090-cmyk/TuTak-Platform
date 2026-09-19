# TuTak Mobile — Premium Visual Refinement, PASS 2 + Partner Spotlight. Отчёт 2026-09-19

**FINAL VERDICT: NOT COMPLETE — визуальный pass 2, Partner Spotlight,
промо-бэкенд и админка сделаны и проверены тестами; НЕ выполнена
проверка на реальном Android (§13): APK из ветки собирается в GitHub
Actions (run 59), но у меня нет устройства/эмулятора, чтобы его
запустить. Screenshot matrix — web-рендер demo на 390 и 360 pt, fontScale
1.3 не проверен (§14).**

Ветка: `claude/premium-visual-refinement`, PR #59.
База pass 2: `52a3bcd` (pass 1) поверх `369eda1` (`main`).
Документ системы: `docs/TUTAK_PREMIUM_VISUAL_SYSTEM.md` (обновлён).
Скриншоты: `docs/screenshots/premium-visual-refinement/` —
`before/` (оригинал), `after/` (PASS 1), `pass2/` (PASS 2, 390 pt),
`pass2-360/` (PASS 2, 360 pt).

---

## 0. Задание (пересказ)

«TUTAK MOBILE — PREMIUM VISUAL REFINEMENT, PASS 2 + PARTNER SPOTLIGHT».
Pass 1 полезен, но UI всё ещё выглядит как UI-kit / fintech template.
Требования: не возвращать шум, не делать новый дизайн, не ломать
структуру; сохранить решения pass 1 (solid primary, минимум рамок, нет
glow, спокойные тени, inset-разделители, keyboard/focus fix). Довести
Home как одну композицию (header → hero → QR → quick actions → **Partner
Spotlight** → referral → операции → tab bar); реализовать Partner
Spotlight (лента 82–88 %, snap, без autoplay, 3–5 карточек, скрывать
при отсутствии, маркировка «Промо» для платных, тап по всей карточке,
image + scrim, без точек пагинации); data model (partner, title,
subtitle, artwork, benefit, destination, active, priority, startAt,
endAt; expired никогда не показывать; promo API не блокирует Home;
thumbnail/cache/lazy/fallback); минимальная админка (партнёр, artwork,
title/subtitle, benefit, даты, priority, active, preview; партнёр сам не
публикует); Wallet — пересобрать композицию; Settings — убрать ощущение
формы; icon optical normalization; bottom nav — Pay как часть системы,
армянские подписи без уродливых сокращений; typography optical pass
(page titles меньше); radii ещё упростить; никакого «пустого premium»;
native screenshots из APK design-ветки; 360 px + fontScale 1.3;
аналитика `partner_promo_impression` / `partner_promo_open` (impression
только при реальной видимости, без лишних personal data); не трогать
финансы/QR/auth/permissions/Idram/PSP/live EV/прод-инфру; отдельный PR;
BEFORE / PASS 1 / PASS 2; финальный отчёт с разделами ниже; максимум 3
вопроса владельцу.

---

## WHY PASS 1 WAS STILL NOT FINAL

По скриншотам pass 1 (папка `after/`):

1. **Home читался как стек компонентов** — квадратные плитки quick
   actions под полноширинной кнопкой выглядели как app-drawer; hero,
   кнопка и три карточки имели один радиус 20–24 → «bubble UI».
2. **Wallet — четыре поверхности на одну страницу чисел**: белая карта
   баланса, две серые плитки итогов, серая группа истечения, серая
   группа истории. Прототип кошелька, не кошелёк.
3. **Settings — серые «коробки» вокруг каждой группы** и тяжёлый блок
   «Фото» (аватар 72, карточка) — форма, а не список настроек.
4. **Иконки из трёх семейств на одном экране**: Jako stroke 2.6 в tab
   bar, filled Ionicons в quick actions, outline Ionicons в Settings.
5. **Pay-диск 46 pt, поднятый над баром** — generic FAB, поставленный
   сверху навигации; inactive `neutral[400]` читался как disabled.
6. **Заголовки 26/22 на 390 pt** — постерные.
7. **Partner Spotlight не был сделан** — требование владельца пропущено.

## HOME PASS 2

| Проблема | Изменение | Почему |
|---|---|---|
| Плитки quick actions | `QuickAction` → горизонтальный бар 52 pt: outline-иконка 20 + подпись 14/18, `backgroundSubtle`, radius 12 | Читается слева направо, как всё на экране; вместе с кнопкой — группа из трёх действий в двух весах |
| Hero 24 pt радиус, padding 24 | radius 20 (`xl`), padding 20, легенда inline с переносом | Один hero-радиус на экран; на 30 pt короче |
| Секции с шагом 32 | `SectionHeader` marginTop 24 | Один ритм 24/12 для всей страницы |
| Нет партнёрского блока | `PartnerSpotlight` между quick actions и referral | См. ниже |
| Header paddingTop 12 | 8 | Header ближе к статус-бару, hero выше |

Файлы: `HomeScreen.tsx`, `QuickAction.tsx`, `BalanceCard.tsx`,
`BonusComposition.tsx`, `SectionHeader.tsx`, `PartnerSpotlight.tsx`.

## WALLET PASS 2

Ни одной карточки. Колонка: caption «Общий баланс» → число 32/38 tabular
→ бар → inline-легенда (та же форма, что на hero) → итоги «Начислено /
Потрачено» одной строкой под hairline → «Скоро истекает» как
финансовый список (сумма — заголовок, дата — подзаголовок, StatePill
справа, без иконки-часов) → «История операций» тем же списком.
Данные и семантика не менялись. Файл: `WalletScreen.tsx`.

## SETTINGS PASS 2

- Заголовок аккаунта: аватар 56, имя `title` 20, телефон — без карточки.
- Группы под `SectionHeader`, строки прямо на странице с inset-
  разделителями: Фото → **Аккаунт** (Мои данные, Стать партнёром,
  Пригласить друзей; новый ключ `settings.account` в ru/hy/en) → Язык →
  Конфиденциальность (switch) → Безопасность (уведомления, пароль,
  удалить) → Выйти.
- `AvatarControl` без `Surface`, аватар 56, все тексты о приватности
  сохранены дословно.
- Убран дубль имени в подзаголовке «Мои данные».
Файлы: `SettingsScreen.tsx`, `AvatarControl.tsx`, i18n.

## ICON SYSTEM

- **Одно правило веса**: Ionicons outline 20–22 pt на экранах; Jako v2
  в tab bar stroke **2.2** (было 2.6) на 24 pt — оптически тот же вес.
- Quick actions: `flash`/`map` (filled) → `flash-outline`/`map-outline`.
- Settings: outline 22 в колонке 28, без плиток (pass 1) — оставлено.
- Wallet: убрана иконка-часы у каждой строки истечения (говорила ничего).
- Transaction list: нейтральная плитка `backgroundSubtle` + outline 18
  (pass 1) — оставлено; `PartnerMark` для партнёрских строк.
- Не сделано: собственный Jako-набор для строк Settings (отрисовка, не
  refinement).

## BOTTOM NAVIGATION

- Все пять иконок в одном боксе 36×36 (`tabBarIconStyle`) → подписи на
  одной базовой линии.
- Pay: диск 36 pt solid `brand[600]` **внутри бокса**, без `marginTop:
  -6`; QR-иконка 22/2.4.
- Inactive `neutral[500]`, active `brand[600]`, верхней линии нет
  (тень 0.06 вверх).
- Подписи 11/500, `tabBarItemStyle.paddingHorizontal: 0`, кастомный
  `tabBarLabel` с `adjustsFontSizeToFit` (min 0.8) и
  `maxFontSizeMultiplier` 1.2 — армянское «Դրամապանակ» ужимается на
  native, **язык не сокращён**. На web-рендере `adjustsFontSizeToFit` не
  работает, поэтому на web-скриншотах слово всё ещё с многоточием —
  это ограничение скриншота, не приложения (UNVERIFIED на устройстве).

## PARTNER SPOTLIGHT

Компонент `apps/mobile/src/presentation/components/PartnerSpotlight.tsx`:
- Место: после quick actions, перед referral, никогда выше QR.
- `FlatList horizontal`, карточка **86 %** ширины контента (301 pt на
  390, 275 на 360), следующая видна на ~37 pt, `snapToInterval` =
  ширина + 12, `decelerationRate="fast"`, `disableIntervalMomentum`;
  ручной swipe, без autoplay, без точек.
- Карточка 16:10: `expo-image` (`contentFit cover`, `cachePolicy
  memory-disk`, `transition 180`, fallback — brand-градиент при ошибке),
  scrim снизу 0 → 0.82, benefit-чип белый (`10% кешбэк`), «Промо» только
  при `sponsored`, снизу `PartnerMark` 22 + имя, заголовок `headline`
  белый (2 строки), подзаголовок (1 строка). Radius 16, без рамки/тени.
  Вся карточка — `Pressable` с `accessibilityRole="button"` и label
  «партнёр. заголовок. выгода».
- Заголовок секции: `home.partnerOffers` = «От партнёров TuTak» /
  «TuTak-ի գործընկերներից» / «From TuTak partners»; `home.promoMark` =
  «Промо» / «Պրոմո» / «Promo».
- Если `GET /promos/featured` пуст или упал — секция отсутствует
  целиком (`return null`), Home не ждёт: отдельный `useQuery`, `retry: 1`,
  `staleTime` 5 мин.
- Тап: `destination === 'PARTNER'` → вкладка Карта с `q = partnerName`
  (новый param `q` в `MainTabParamList.Partners`, PartnersScreen подставляет
  его в поиск); `PARTNERS_MAP` → вкладка Карта. Наружу — никогда.
- Аналитика: `IMPRESSION` через `onViewableItemsChanged` при
  `itemVisiblePercentThreshold: 60` + `minimumViewTime: 500`, один раз за
  сессию приложения на карточку (module-level `Set`); `OPEN` по тапу. Оба —
  fire-and-forget `POST /promos/:id/events`, ошибки глотаются. Ни userId,
  ни device — сервер инкрементирует счётчик на карточке.
- Demo: три карточки (`mockData.promos`), artwork — data-URL JPEG 720×450
  (`mockPromoArtwork.ts`, сгенерированы sharp из brand-градиентов и Jako;
  реальные фото загружаются из админки). Маршруты
  `GET /promos/featured`, `POST /promos/:id/events` в `mockAdapter`.

## PROMO BACKEND / ADMIN

**Prisma / миграции** (`apps/api/prisma`):
- `20260919100000_media_asset_kind_promo_artwork`: `MediaAssetKind` +
  `PROMO_ARTWORK`; `AuditAction` + `PARTNER_PROMO_CREATED/UPDATED`.
  Отдельная миграция, потому что PostgreSQL не даёт использовать новое
  значение enum в той же транзакции.
- `20260919100100_partner_promos`: enum `PartnerPromoDestination`
  (`PARTNER`, `PARTNERS_MAP`), таблица `partner_promos` (partnerId, title,
  subtitle, benefitLabel, artworkAssetId, destination, sponsored, active,
  priority, startAt, endAt, impressionCount, openCount, createdByUserId,
  timestamps), индексы `(active, priority)`, `(partnerId)`, CHECK
  `endAt > startAt`, CHECK счётчики ≥ 0; `media_assets_subject_matches_kind`
  расширен на `PROMO_ARTWORK` (partnerId обязателен); частичный уникальный
  индекс «один ACTIVE на партнёра и kind» исключает `PROMO_ARTWORK` —
  партнёр может вести несколько карточек.
- Модель `PartnerPromo` со связями `Partner.promos`,
  `MediaAsset.artworkOfPromos`.

**API** (`apps/api/src/modules/promos/`):
- `promo-window.ts` — чистое правило «живой»: `active` ∧ партнёр
  `isActive` ∧ `status = ACTIVE` ∧ (`startAt` null или ≤ now) ∧ (`endAt`
  null или > now), плюс тот же предикат как Prisma `where`; лимит 5.
- `PromosService`: `featured()`, `list()` (с `live` по тому же правилу),
  `create/update` (валидация окна, trim, аудит), `setArtwork` (через
  `MediaService.storePromoArtwork`, старый asset → `REPLACED`),
  `recordEvent` (атомарный `increment`, неизвестный id — тихо).
- `PromosController` `/promos`: `GET featured` (любой авторизованный),
  `POST :id/events` (204, throttle 60/мин).
- `AdminPromosController` `/admin/promos`: `GET`, `POST`, `PATCH :id`,
  `PUT :id/artwork` (multipart, тот же pipeline и лимиты, что у cover) —
  все `RequirePermissions(PARTNER_MANAGE)` + `assertPlatformAdmin`
  (роль, не permission: PARTNER_OWNER держит PARTNER_MANAGE).
- Media: `KIND_PREFIX.PROMO_ARTWORK`, SHAPES 2048×1280 / 1024×640 / 128×80
  cover; `storePromoArtwork` публикует сразу (единственный вызывающий —
  админ), `publish: false` (не трогает logo/cover партнёра).
- DTO: `CreatePromoDto` (title ≤ 80, subtitle ≤ 120, benefit ≤ 24,
  priority −1000..1000, ISO-даты), `UpdatePromoDto`, `PromoEventDto`.
- shared-types: `packages/shared-types/src/dto/promo.ts`
  (`PartnerPromoPublicDto`, `PartnerPromoAdminDto`, request DTO, event
  type); `MediaAssetKind` + `'PROMO_ARTWORK'` (и зеркало в
  `media.contracts.ts`, spec обновлён).
- `PromosModule` зарегистрирован в `AppModule` и в интеграционном harness.

**Admin** (`apps/admin/src/app/(dashboard)/promos/page.tsx`,
`lib/api/promosApi.ts`, пункт «Partner Spotlight» в Sidebar):
форма (партнёр — только торгующие, benefit, title, subtitle,
destination, priority, starts/ends `datetime-local` → ISO, active,
sponsored), **live-preview карточки** в пропорциях телефона, таблица с
thumbnail, статусом («Live / Off / Scheduled / Expired / Partner not
trading»), окном, приоритетом, «seen / opened», кнопками Upload/Replace
artwork, Edit, Switch on/off. Партнёрская панель не получила ничего.

## RU / HY / EN

- Новые ключи в трёх локалях: `home.partnerOffers`, `home.promoMark`,
  `settings.account`.
- Проверено на web-скриншотах: RU 390/360, HY 390/360 (Home, Settings),
  EN — только Login (демо после входа переключается на ru).
- Армянский: hero-легенда переносится, quick actions в 2 строки на 360
  («Լիցքակայաններ» помещается в одну), tab-подпись «Դրամապանակ» —
  см. Bottom navigation.
- Не проверено: fontScale 1.3 (см. UNVERIFIED).

## ANDROID REALITY

- APK из ветки: workflow `Build Android APK`, run **59**
  (https://github.com/arman119090-cmyk/TuTak-Platform/actions/runs/35441688635),
  профиль `preview` (помеченная сборка, не production), builder `local`,
  API `https://tutak-api-production.up.railway.app/v1`. На проде нет
  `/promos/featured` до merge/deploy → в этой сборке Spotlight будет
  скрыт (404 → секция отсутствует); остальные экраны — как в pass 2.
- **Устройства нет.** Elevation, шрифты, switch, sharpness иконок на
  Samsung/Xiaomi не видел. Это главная причина вердикта NOT COMPLETE.

## TESTS

| Проверка | Результат |
|---|---|
| mobile `jest` | 64 suites / 530 tests passed |
| mobile `tsc --noEmit` | 0 |
| mobile `eslint src` | 0 |
| api `tsc` (build + spec) | 0 / 0 |
| api `eslint src test/promos.int-spec.ts` | 0 |
| api `jest --selectProjects unit` | 51 suites / 700 tests passed (в т.ч. новый `promo-window.spec.ts`, 9 тестов) |
| api `jest --selectProjects integration promos.int-spec` (локальный PostgreSQL 16 + Redis) | 4 / 4 passed (featured-фильтр, счётчики, CHECK окна, несколько ACTIVE artwork) |
| `prisma migrate deploy` на чистую БД | 73 миграции применены, 0 ошибок |
| admin `tsc` / `eslint .` | 0 / 0 |
| admin `jest` | 109 tests passed (в т.ч. новый `promos/page.test.tsx`, 4 теста) |
| `scripts/build-demo-app.sh` + `git diff --quiet -- demo` | parity OK |
| Playwright после-скриншоты | 11 кадров × 2 ширины, 0 page errors |

## SCREENSHOTS

`docs/screenshots/premium-visual-refinement/`:

| Экран | BEFORE (`before/`) | PASS 1 (`after/`) | PASS 2 (`pass2/`, `pass2-360/`) |
|---|---|---|---|
| 01-login | ✓ | ✓ | ✓ / ✓ |
| 02-home, 02b-home-scrolled | ✓ | ✓ | ✓ / ✓ |
| 03-wallet | ✓ | ✓ | ✓ / ✓ |
| 04-partners | ✓ | ✓ | ✓ / ✓ |
| 05-settings, 05b | ✓ | ✓ | ✓ / ✓ |
| 06-history | ✓ | ✓ | ✓ / ✓ |
| 07-referral | — | ✓ | ✓ / ✓ |
| 08-settings-hy, 09-home-hy | — | ✓ | ✓ / ✓ |

Что видно между PASS 1 и PASS 2: Home — одна колонка из hero, кнопки,
двух баров, ленты и списка, а не пять карточек; Wallet — 0 поверхностей
вместо 4; Settings — 0 серых групп вместо 5, аватар 72 → 56; tab bar —
диск в линии с иконками; заголовки 26 → 24.

## OWNER DECISIONS (3)

1. **Заголовок ленты**: сейчас «От партнёров TuTak». Альтернатива —
   «Специальные предложения». Слово в i18n, меняется за минуту.
2. **Армянская подпись «Դրամապանակ»**: на native ужимается до 80 %.
   Если после проверки на телефоне выглядит мелко — нужен ваш вариант
   перевода (я язык не сокращал).
3. **Куда ведёт карточка**: сейчас на карту, отфильтрованную по партнёру
   (у сетей — ближайший филиал). Альтернатива — страница партнёра, но
   `PartnerDetail` требует объект филиала с координатами; это отдельная
   работа над экраном.

---

## Что сделано (файлы)

Mobile: `PartnerSpotlight.tsx` (новый), `promosApi.ts` (новый),
`mockPromoArtwork.ts` (новый), `mockData.ts`, `mockAdapter.ts` (+test),
`HomeScreen.tsx`, `QuickAction.tsx`, `BalanceCard.tsx`,
`BonusComposition.tsx`, `SectionHeader.tsx`, `WalletScreen.tsx`,
`SettingsScreen.tsx`, `AvatarControl.tsx`, `MainTabNavigator.tsx`,
`navigation/types.ts`, `PartnersScreen.tsx` (param `q`).
Design: `packages/design/src/tokens/premium.ts` (радиусы, размеры).
i18n: три локали. shared-types: `dto/promo.ts`, `dto/media.ts`.
API: модуль `promos/` (6 файлов + spec), media (4 файла), `schema.prisma`,
2 миграции, `app.module.ts`, `test/promos.int-spec.ts`,
`test/setup/harness.ts`.
Admin: `promos/page.tsx` (+test), `lib/api/promosApi.ts`, `Sidebar.tsx`.
Docs: `TUTAK_PREMIUM_VISUAL_SYSTEM.md`, этот отчёт, скриншоты.
Demo регенерирован.

## Что НЕ сделано

- **Native screenshots и проверка на Samsung/Xiaomi (§13)** — нет
  устройства. APK собирается (run 59), ссылка на релиз появится по
  завершении workflow.
- **fontScale 1.3 (§14)** — web-рендер не эмулирует; в коде легенда и
  quick actions переносятся, tab-подписи ограничены множителем 1.2.
- **Destination «страница партнёра»** — ведёт на карту с фильтром
  (см. Owner decisions 3).
- **Jako-иконки для строк Settings** — не рисовал.
- **Партнёрская панель** — намеренно без доступа к промо.
- **EN-скриншоты после входа** — демо-пользователь ru.
- **Собственные ошибки по ходу работы:**
  1. `adjustsFontSizeToFit` для hero-легенды (pass 1) не работал на web —
     заменил на перенос; ту же ловушку оставил в tab-подписях осознанно
     (native-only) и честно пометил.
  2. Первая версия Settings перевела фото-блок на серую поверхность —
     switch и кнопка пропадали; в pass 2 ушёл от поверхностей совсем.
  3. Интеграционный тест сначала повис 10 минут — не поднял Redis; затем
     упал на FK аудита (`actorUserId` = несуществующий пользователь) —
     починил, создавая реального пользователя в `beforeEach`.
  4. `PromosModule` забыл добавить в интеграционный harness — тест не
     нашёл сервис; добавил.
  5. Admin-тест ловил `getByLabelText('Benefit')` (label + hint), «12 / 3»
     как несколько text-узлов и дубль счётчиков во второй строке — три
     правки теста и одна правка разметки (счётчики одной строкой).
  6. Первый regen demo запустил из `apps/mobile` относительным путём —
     упал; перезапустил.
  7. Заметил, что на web `page.goBack()` не работает — before-кадры
     referral/hy так и остались без оригинала (с pass 1).

## UNVERIFIED

1. Всё на реальном Android/iOS: elevation, switch, шрифты, tab bar,
   `adjustsFontSizeToFit` подписей, sharpness Jako-иконок.
2. fontScale 1.3.
3. Загрузка artwork через админку end-to-end (multipart → sharp →
   storage): `setArtwork` и `storePromoArtwork` покрыты только типами и
   тем же pipeline, что у cover; интеграционный тест загрузки не писал.
4. CI на GitHub для коммита pass 2 (запустится по push; demo parity и
   integration-шарды).
5. Поведение `FlatList` snap на web — проверено визуально только
   статикой.
6. Результат APK run 59 на момент отчёта (см. TESTS/ANDROID REALITY).

## Вопросы владельцу

См. OWNER DECISIONS (3). Дополнительно: ставить ли этот PR на merge до
проверки APK на телефоне, или ждать вашего прогона по Samsung/Xiaomi?

---

## Дополнение после отчёта (замечание владельца, 2026-09-19)

Поле ИНН в заявке партнёра называлось «ՀՎՀՀ» во всех трёх языках.
Исправлено: ru — «ИНН (ՀՎՀՀ)» и «ИНН можно будет добавить позже…»,
en — «Tax ID (ՀՎՀՀ)» и «You can add your tax ID later…»; в админке
заголовок колонки заявок «ՀՎՀՀ» → «Tax ID». Армянская аббревиатура
оставлена в скобках, потому что так номер называется в документах
партнёра; если нужно совсем без неё — одна строка в `ru.json`/`en.json`.
Файлы: `packages/i18n/src/locales/{ru,en}.json`,
`apps/admin/src/app/(dashboard)/partner-applications/page.tsx`; demo
регенерирован. Тестов на старый текст не было.
