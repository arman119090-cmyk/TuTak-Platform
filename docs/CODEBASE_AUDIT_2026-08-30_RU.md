# TuTak — аудит кодовой базы на мусор, дублирование и мёртвый код

Дата: 30 августа 2026

Это аудит, который попросил Арман после завершения всех инженерных задач
по платформе: проход по всему монорепозиторию — backend, mobile, admin,
partner, общие пакеты, документация — в поисках мёртвого кода,
дублирования и документации, которая больше не соответствует коду. Здесь
нет ни одного бизнес-решения; всё удалённое было проверено на отсутствие
ссылок по всему репозиторию перед удалением, а часть кандидатов на
удаление в итоге была оставлена, потому что оказалась нужной.

## Что было исправлено

### Документация

- `docs/ARCHITECTURE.md`, `docs/DESIGN.md` — обновлены места, которые
  противоречили текущему коду (список модулей, PurchaseIntent,
  tracing/metrics, маскот Jako, пункты дорожной карты).
- `docs/ROAMING_CPO_INTEGRATION_2026-08-25.md`, `scripts/demo-README.md`:
  мелкие фактические правки и опечатка в имени файла.
- `docs/TUTAK_MASTER_PROJECT_CONTEXT_2026-08-16.md`,
  `docs/NEXT_CLAUDE_TASK.md`: добавлены баннеры "устарело" — оба
  документа были заморожены на более ранней дате и разошлись с тем, что
  реально в продакшене.
- `docs/README.md`: пересобран индекс "Актуально/Устарело".

### apps/api

- Убрал два мёртвых интерфейса из `roaming-cpo-provider.interface.ts`
  (`RoamingCpoSessionReport`, `RoamingCpoStationSync`) и устаревший
  комментарий, который на них ссылался.
- Убрал мёртвую переэкспортируемую константу в `idempotency.service.ts`.
- Объединил четыре копии регулярного выражения для армянского номера
  телефона (DTO для login, register, password, OTP) в один общий файл
  `common/validators/armenian-phone.ts`.

### packages/shared-types и packages/i18n

Удалил каждый экспорт, у которого **не осталось ни одного импортёра** —
проверял не поиском имени символа по коду (это даёт ложные совпадения с
одноимёнными enum'ами из `@prisma/client`, см. раздел ниже), а разбором
реальных операторов `import { ... } from '@tutak/shared-types'` во всех
67 файлах, которые вообще упоминают этот пакет:

- `dto/auth.ts`: `RefreshRequestDto`, `UpdatePersonalizationConsentRequestDto`
- `dto/partner-branch.ts`: `SetBranchFuelTypeRequestDto`
- `dto/partner.ts`: `PartnerOfferingInputDto`, `ReplacePartnerOfferingsRequestDto`,
  `UpdatePartnerAboutRequestDto`, `CreatePartnerBranchRequestDto`,
  `UpdatePartnerBranchRequestDto`, `UpdatePartnerFuelTypesRequestDto`
- `dto/wallet.ts`: `ReserveBonusRequestDto`, `SettleBonusRequestDto`,
  `ReleaseBonusRequestDto`
- `dto/transaction.ts`: `TransactionHistoryQueryDto`
- `dto/ev.ts`: `CreateEvReservationRequestDto`, `EvReservationDto` (удалил
  только после того, как убедился, что мобильные методы
  `evApi.createReservation`/`myReservations`, которые их использовали,
  сами мёртвые — см. ниже)
- `enums/roles.ts`: `Permission`
- `enums/ev.ts`: `EvReservationStatus` (тоже только после подтверждения
  мёртвости `EvReservationDto` выше — это был единственный оставшийся
  потребитель)
- `enums/locale.ts`, `enums/audit.ts`: удалил файлы целиком
  (`SupportedLocale`/`DEFAULT_LOCALE`/`SUPPORTED_LOCALES`,
  `AuditAction`/`FraudSignalType`) вместе с их экспортом из barrel-файлов
- `packages/i18n/src/index.ts`: мёртвая константа `translations`
- Убрал неиспользуемую зависимость `@tutak/i18n` из `apps/admin` и
  `apps/partner` (`package.json`, `next.config.ts`, `tsconfig.json`) —
  этот пакет реально использует только `apps/mobile`.

### apps/mobile

- Удалил `app/theme/tokens.ts` и `app/theme/colors.ts` — ранний набор
  светлой/тёмной темы, на который нигде не осталось ссылок; приложение
  теперь целиком работает на `tutakMobileLightTheme` из `@tutak/design`
  через `ThemeProvider`.
- Убрал мёртвые методы, которые нигде не вызываются — ни в приложении, ни
  в тестах: `evApi.createReservation`, `evApi.myReservations` (экрана
  бронирования зарядки вообще не существует), `authApi.refresh`
  (настоящий рефреш живёт в перехватчике `httpClient.ts` и вызывается
  напрямую через axios — этот метод дублировал его, и его никто не
  вызывал), `usersApi.me`.
- Убрал мёртвый хелпер `now` и его экспорт из `mockData.ts`, а также
  мёртвый реэкспорт `DEFAULT_CENTRE` из `PartnersScreen.tsx` (настоящий
  экспорт живёт и используется только в `useApproximateLocation.ts`).
- Объединил приватную функцию `BonusCompositionOnBrand` из
  `BalanceCard.tsx` с компонентом `BonusComposition` через новый параметр
  `tone?: 'default' | 'onBrand'` — та же стилизация (полупрозрачно-белая
  дорожка, фиксированные светлые подписи, меньшие размеры), но одна
  реализация вместо двух почти одинаковых.
- Вынес побайтово одинаковый блок `StyleSheet` из `StationPin` и
  `PartnerPin` в новый общий файл `mapPinStyles.ts`.
- Переписал комментарий-докблок в `Surface.tsx` — он описывал тёмную,
  почти чёрную стеклянную поверхность с синим свечением, но собственный
  докблок `ThemeProvider.tsx` подтверждает, что версия v2 — только
  светлая (`tutakMobileLightTheme`, тёмная тема никогда не используется).
  Теперь комментарий описывает реально отрисовываемую светлую
  стекло/тень-схему, в том же стиле рассуждения, что и `light-premium.ts`.

### apps/admin и apps/partner

- Удалил мёртвый `StatCard.tsx` в обоих приложениях — компонент был
  объявлен, но нигде не импортировался.
- Исправил реальный баг: плитки предпросмотра медиа/брендинга
  использовали Tailwind-класс `bg-sunken`, которого не существует в
  дизайн-системе (определён только `--color-surface-sunken` /
  `bg-surface-sunken` — он же правильно используется в других местах,
  например в `ThemeToggle.tsx`). Плитки молча рендерились без фона.
  Исправлено и в `apps/admin/.../media/page.tsx`, и в
  `apps/partner/.../branding/page.tsx`.
- Вынес побайтово одинаковые `httpClient.ts` (экземпляр axios,
  перехватчик bearer-авторизации, повтор запроса после 401 через рефреш)
  и `Providers.tsx` (провайдер React Query) в `@tutak/design/web`:
  `createHttpClient(authStore, apiBaseUrl)` и `Providers`. Локальный
  `httpClient.ts` каждого приложения теперь просто вызывает фабрику со
  своим `useAuthStore` и базовым URL — сами реализации `useAuthStore`
  **не объединял** (см. ниже), только обвязку вокруг них.
  - Для этого пришлось убрать `rootDir: "."` из
    `packages/design/tsconfig.json` (он запрещал пакету типизировать
    межпакетный импорт — то же ограничение `rootDir`, с которым уже живёт
    `apps/api`) и явно объявить `@tanstack/react-query`,
    `@tutak/shared-types`, `axios` зависимостями `@tutak/design` (раньше
    они были неявными).
  - Проверил не только тайпчеком: полный набор Jest-тестов обоих
    приложений (включая `httpClient.test.ts` в admin, который проверяет
    всю логику "401 → рефреш → повтор запроса" целиком) и реальную
    продакшен-сборку `next build` для обоих приложений — всё прошло.

## Что выглядело мёртвым, но не было — поймал до удаления

Наивный поиск по имени символа по всему репозиторию даёт ложные
срабатывания, потому что несколько символов из shared-types совпадают по
имени с не связанным с ними enum'ом из `@prisma/client`, который
`apps/api` импортирует напрямую (сам `@tutak/shared-types` `apps/api`
импортировать не может — ограничение `rootDir`). Каждый из этих случаев
я перепроверил, проследив настоящий оператор импорта, а не просто имя:

- `PartnerBranchQrStatus` — по имени выглядел мёртвым, но реально
  используется внутри `PartnerBranchQrCodeDto.status`, а этот DTO
  **действительно** импортируют `partnersApi.ts` и в `apps/admin`, и в
  `apps/partner`. Оставил.
- `MediaAssetKind`, `MediaAssetStatus` — используются внутри
  `MediaAssetDto`, который импортируют `mediaApi.ts` обоих дашбордов.
  Оставил.
- `NotificationChannel` — используется внутри `NotificationDto`, который
  импортирует `notificationsApi.ts` в `apps/mobile`. Оставил.
- `EvReservationStatus` — сначала выглядел мёртвым, но `EvReservationDto`
  (который его использует) на тот момент ещё импортировался в
  `apps/mobile/.../evApi.ts`. Стал по-настоящему мёртвым и был удалён
  только после того, как оба метода `evApi`, использовавших
  `EvReservationDto`, подтвердились неиспользуемыми и были удалены в этом
  же проходе — см. выше.

Вывод, который стоит запомнить на будущее: перед удалением экспорта
нужно проверять не только "импортирует ли это что-то снаружи пакета", но
и "не использует ли это что-то ВНУТРИ того же пакета как часть типа, от
которого зависит другой, настоящий импортёр".

## Что нашёл, но сознательно не тронул

Оставил как рекомендации Арману, а не молчаливые удаления или
самостоятельные правки, — потому что это бизнес-решения или изменения в
логике авторизации с повышенным риском, а не мёртвый код:

- **Объединение `authStore`/`AuthGate` в admin и partner.** Реализации
  `useAuthStore` в двух дашбордах похожи, но не идентичны — разные ключи
  для device-id в хранилище, разные имена персистентного стора, и в
  partner-сторе есть дополнительная логика скоупинга по ролям
  (`PARTNER_ROLES`, `getPrimaryPartnerId`, `isPartnerOwner`), которой нет
  аналога в admin-сторе. Их объединение — это настоящее архитектурное
  решение (поглощает ли модель ролей admin модель скоуп-прав partner, или
  они остаются раздельными), а не механическое вынесение общего кода,
  как было с `httpClient`/`Providers`.
- **`mediaApi.revoke`** (admin), **`partnerApi.listStaff`**,
  **`partnerApi.setAllBranches`** (partner) — все три метода реально
  подключены к рабочему эндпоинту API, но ни один экран ни в одном
  дашборде их не вызывает. Это больше похоже на недоделанный интерфейс
  (кнопка отзыва логотипа ещё не построена, экран списка сотрудников/
  назначения филиалов ещё не построен), чем на мёртвый код для удаления —
  удаление стёрло бы рабочую интеграцию с API, которая может понадобиться
  будущему экрану. Рекомендую Арману решить: строить соответствующий UI
  или удалять методы.

## Проверка

Прогонял после каждой партии удалений, и ещё раз целиком в конце,
предварительно убедившись, что Postgres и Redis подняты:

| Пакет | Тайпчек | Линт | Тесты | Сборка |
| --- | --- | --- | --- | --- |
| `packages/shared-types` | ✅ | — | — | — |
| `packages/i18n` | ✅ | — | — | — |
| `packages/design` | ✅ | — | — | — |
| `apps/api` | ✅ (`tsconfig.build.json` + `tsconfig.spec.json`) | ✅ | ✅ 95 наборов / 1324 теста | — |
| `apps/mobile` | ✅ | ✅ | ✅ 29 наборов / 237 тестов | — |
| `apps/admin` | ✅ | ✅ | ✅ 5 наборов / 34 теста | ✅ `next build` |
| `apps/partner` | ✅ | ✅ | ✅ 5 наборов / 35 тестов | ✅ `next build` |

После изменений зависимостей `@tutak/i18n`/`@tutak/design` заново
прогнал `pnpm install`; разница в `pnpm-lock.yaml` — ровно две удалённые
записи `@tutak/i18n` и три новые записи зависимостей `@tutak/design`,
больше ничего не сдвинулось.

Изменений схемы БД или миграций в этом проходе не было, поэтому проверка
на расхождение миграций не требовалась.
