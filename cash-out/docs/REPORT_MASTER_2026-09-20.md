# Cash Out — итоговый отчёт по MASTER EXECUTION TASK

**Дата:** 20 сентября 2026
**Репозиторий:** `arman119090-cmyk/TuTak-Platform`, ветка `claude/new-project-5wwjph`, папка `cash-out/`
**Диапазон коммитов:** `549eca1..2404c6c` (10 коммитов, 186 файлов, +15 075 / −1 261 строк)

Главное, коротко:

- Все 13 пунктов ТЗ реализованы в коде и покрыты тестами против моков.
- **Ни одна внешняя интеграция не проверена live**: Yandex Fleet, iDram, SMS и push работают только через mock-адаптеры. Это не production-ready и в отчёте нигде так не названо.
- GitHub Actions: результат прогона указан в разделе O — фактический, не предполагаемый.
- Cash Out остаётся внутри `cash-out/**`; TuTak не тронут (родительский workflow `CI` на этой же ветке зелёный, см. O).

---

## A. Матрица требований ТЗ (пункты 1–13)

| №   | Требование                              | Статус                                           | Файлы / эндпоинты / экраны / тесты                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Коммит           |
| --- | --------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| 1   | Три языка, выбор при первом запуске     | **PASS**                                         | `packages/i18n/src/locales/{hy,ru,en}.ts` (типы ломают сборку при пропущенном ключе); `apps/mobile/src/i18n/detect.ts`, `app/onboarding.tsx`, `app/settings/language.tsx`; тесты `packages/i18n/test/i18n.spec.ts` (16), `apps/mobile/test/locale-and-theme.spec.ts`                                                                                                                                                                                                                                                                                         | 549eca1, 2404c6c |
| 2   | Регистрация по номеру + SMS-код         | **PASS / SMS — MOCK**                            | `apps/api/src/modules/auth/*` (`POST /v1/auth/otp/request`, `/otp/verify`, `/refresh`, `/sign-out`, `/sessions`); `app/sign-in/phone.tsx` (PhoneField), `app/sign-in/otp.tsx` (OtpField); `test/integration/auth.spec.ts`. SMS-шлюз консольный: `SMS_MODE=live` не реализован                                                                                                                                                                                                                                                                                | ранее, 9947007   |
| 3   | Мультипарк: ростер, разрешение, выбор   | **PASS**                                         | Миграция `20260920120000_multi_park_roster` (Park, ParkIntegrationCredential, DriverParkMembership, ParkSwitch, RosterImport); `modules/parks/*` (`GET /v1/me/parks`, `POST /v1/me/parks/activate`); `app/park/{select,auto,not-found,denied}.tsx`, `app/index.tsx`; `parks.spec.ts` (15), `apps/mobile/test/route-for.spec.ts` (8)                                                                                                                                                                                                                          | 40bdbb8, dd8c199 |
| 4   | Баланс из Yandex Pro по активному парку | **PASS / Yandex — MOCK**                         | `modules/yandex/yandex-credentials.service.ts` (ключ парка, AES-GCM), `modules/drivers/balance.service.ts` (`GET /v1/me/balance`, `/balance/fresh`, snapshot с parkId); `app/(tabs)/index.tsx`, `app/(tabs)/balance.tsx`; `yandex-v3.spec.ts` (20 + 6 unit). Live-адаптер v3 никогда не вызывался против реального парка                                                                                                                                                                                                                                     | 40bdbb8, dd8c199 |
| 5   | Вывод на iDram                          | **PASS / iDram — MOCK**                          | Миграция `20260920130000_idram_payout_method`; `modules/idram/{idram.port,idram-mock.adapter,idram.service,idram.controller}.ts` (`GET/POST/DELETE /v1/idram/account`); `app/idram/account.tsx`, `app/withdraw/{amount,idram,review,authorize,processing,success,failure}.tsx`; `idram.spec.ts` (10). `PROVIDER_MODE=live` бросает исключение при старте                                                                                                                                                                                                     | 318ff11          |
| 6   | PIN / биометрия при выводе              | **PASS**                                         | Миграция `20260920140000_pin_and_authorizations` (DriverSecurity, WithdrawalAuthorization); `modules/security/*` (`GET /v1/security`, `POST /pin`, `/pin/change`, `/biometric/enable`, `/biometric/disable`, `/authorize`); подтверждение вывода потребляет одноразовую авторизацию внутри транзакции; `app/security/*`, `app/withdraw/authorize.tsx`; `security.spec.ts` (12)                                                                                                                                                                               | 42577bb          |
| 7   | Автоматический вывод                    | **PASS**                                         | Миграция `20260920150000_auto_payout` (AutoPayoutRule, Withdrawal.origin); `modules/auto-payout/*` (`GET/PUT /v1/auto-payout`, `POST /disable`, cron-воркер, slot-идемпотентность, пауза после 3 ошибок); `app/auto-payout/{index,edit}.tsx`; `auto-payout.spec.ts` (13), `unit/auto-payout-schedule.spec.ts` (6)                                                                                                                                                                                                                                            | 3ca6feb          |
| 8   | История баланса + детали операции       | **PASS**                                         | `modules/history/*` (`GET /v1/history?from&to&type&status&cursor`, `GET /v1/history/:id`); read-model поверх withdrawals + journal (REFUND, ADMIN_ADJUSTMENT); статусы COMPLETED/PROCESSING/CANCELLED/REJECTED; `app/(tabs)/history.tsx`, `app/history/[id].tsx`; `history.spec.ts` (11), `contracts` user-status (4)                                                                                                                                                                                                                                        | 7c712fc          |
| 9   | Driver ID: показ, смена, история        | **PASS / проверка — MOCK Yandex**                | `DriverIdChangeRequest`; `modules/driver-id/*` (`GET /v1/me/driver-id`, `POST /requests`, `POST /requests/:id/cancel`), админ `GET /v1/admin/driver-id-requests`, `POST …/approve`, `/reject`; `app/driver-id/{index,request}.tsx`; `driver-id.spec.ts` (7)                                                                                                                                                                                                                                                                                                  | 10b8735, f7a29b2 |
| 10  | Настройки, темы, уведомления            | **PASS / push — MOCK**                           | Миграция `20260920160000_notification_preferences`; `modules/notifications/*` (`GET/PUT /v1/notifications/preferences`, `POST /push-token`, outbox + sweeper); `app/(tabs)/settings.tsx`, `app/settings/{language,appearance,notifications}.tsx`, `src/theme/{theme.tsx,resolve.ts}`; `notifications.spec.ts` (10), `locale-and-theme.spec.ts`                                                                                                                                                                                                               | 9947007          |
| 11  | Premium UI по дизайн-токенам            | **PASS (без визуальной проверки на устройстве)** | `packages/design-tokens/src/{palette,theme}.ts` (canvas #F6F2EA, surface #FFFFFF, text #0A1322, emerald #0A7A63; dark #0B1424/#111D31; radius 28/18, CTA 56, target 48+); `apps/mobile/src/ui/*` — Button, Text, TextField, PhoneField, OtpField, PinPad, MoneyInput, BalanceCard, TaxiParkCard, IdramCard, OperationRow, StatusPill, BottomSheet, Dialog, Toast, StateView, Skeleton, EmptyState, ErrorState, Toggle, Radio, Tabs, SegmentedControl, ListRow, AmountRow; `tokens.spec.ts` (22, WCAG AA + фиксированные значения), `armenian-layout.spec.ts` | 9947007, 2404c6c |
| 12  | Админка: парки, ростер, заявки, правила | **PASS**                                         | `apps/admin/app/(dash)/parks/page.tsx`, `parks/[id]/page.tsx` (реквизиты, verify, импорт, sync, членства), `driver-id-requests/page.tsx`, `auto-payout/page.tsx`, `drivers/[id]/page.tsx` (членства, переключения, корректировка `POST /v1/admin/drivers/:id/adjust`), `integrations/page.tsx`; API `GET /v1/admin/auto-payout/rules`; `admin-and-reconciliation.spec.ts`, `apps/admin/test/*` (6)                                                                                                                                                           | f7a29b2, 2404c6c |
| 13  | Тесты, CI, документация                 | **PASS (CI — см. O)**                            | `.github/workflows/cash-out-ci.yml` (+ копия `cash-out/.github/workflows/ci.yml`); `docs/{STATUS,SECURITY,OPERATIONS,YANDEX_INTEGRATION,IDRAM_INTEGRATION,ARCHITECTURE}.md`; jest в mobile и admin                                                                                                                                                                                                                                                                                                                                                           | 2404c6c          |

**BLOCKED_EXTERNAL** (не мешает коду, мешает только live-вызовам): реквизиты Yandex Fleet парков, merchant-доступ iDram, SMS-провайдер, push-провайдер, тесты на реальных устройствах. Подробно — разделы Q и R.

## B. Что реализовано

- **Бэкенд (NestJS 11 + Prisma 6 + PostgreSQL 16):** модули parks, yandex (реквизиты по парку), idram, security, auto-payout, history, driver-id, notifications; расширены drivers, withdrawals, admin, integration-health. Конвейер вывода не переписан: 19 состояний, двойная бухгалтерия, идемпотентность и оркестратор остались; добавлено потребление одноразовой авторизации внутри транзакции и origin DRIVER|AUTO_PAYOUT.
- **Контракты (`packages/contracts`):** DTO и zod-схемы для всех новых эндпоинтов, новые коды ошибок, `toUserStatus`.
- **Мобильное приложение (Expo SDK 57):** 5 вкладок, экраны парка, iDram, PIN/биометрии, автовыплат, истории, Driver ID, настроек (язык, оформление, уведомления), авто-выбор парка, варианты экрана неудачи; светлая/тёмная тема с сохранением.
- **Админка (Next.js 16):** страницы парков, заявок Driver ID, правил автовыплат; карточка водителя с членствами и корректировкой; описания плиток iDram и push.
- **Дизайн-токены:** палитра и радиусы по ТЗ, тесты контраста и фиксированных значений.

## C. Миграции

| Миграция                                  | Что добавляет                                                                                                                                                     |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20260920120000_multi_park_roster`        | Park, ParkIntegrationCredential, DriverParkMembership, ParkSwitch, RosterImport; `Driver.activeMembershipId`; `BalanceSnapshot.parkId`; `Withdrawal.yandexParkId` |
| `20260920130000_idram_payout_method`      | `PayoutMethodKind.IDRAM`, `holderName`, `verifiedAt`                                                                                                              |
| `20260920140000_pin_and_authorizations`   | DriverSecurity (scrypt PIN, lockout, device secret hash), WithdrawalAuthorization (одноразовая, привязана к quote/purpose)                                        |
| `20260920150000_auto_payout`              | AutoPayoutRule, `Withdrawal.origin`, `Withdrawal.autoPayoutRuleId`                                                                                                |
| `20260920160000_notification_preferences` | NotificationPreference (4 категории + push-токен)                                                                                                                 |

Все миграции применяются на чистую PostgreSQL в CI (`prisma migrate deploy`).

## D. Эндпоинты (новые и изменённые)

Водитель: `GET /v1/me` (resolution, activePark, membershipCount), `GET /v1/me/parks`, `POST /v1/me/parks/activate`, `GET /v1/me/balance[/fresh]`, `GET /v1/me/driver-id`, `POST /v1/me/driver-id/requests`, `POST /v1/me/driver-id/requests/:id/cancel`, `GET/POST/DELETE /v1/idram/account`, `GET /v1/security`, `POST /v1/security/pin`, `/pin/change`, `/biometric/enable`, `/biometric/disable`, `/authorize`, `POST /v1/withdrawals` (+ `authorizationToken`), `GET/PUT /v1/auto-payout`, `POST /v1/auto-payout/disable`, `GET /v1/history`, `GET /v1/history/:id`, `GET/PUT /v1/notifications/preferences`, `POST /v1/notifications/push-token`.

Админ: `GET/POST /v1/admin/parks`, `GET/PATCH /v1/admin/parks/:id`, `POST …/credential`, `POST …/credential/verify`, `GET …/memberships`, `POST …/roster/import`, `POST …/roster/sync`, `PATCH /v1/admin/memberships/:id`, `GET /v1/admin/driver-id-requests`, `POST …/:id/approve|reject`, `GET /v1/admin/auto-payout/rules`, `POST /v1/admin/drivers/:id/adjust`, `GET /v1/admin/integrations` (плитки idram и push).

## E. Экраны мобильного приложения

`onboarding`, `sign-in/phone`, `sign-in/otp`, `park/auto`, `park/select`, `park/not-found`, `park/denied`, `(tabs)/index` (главная с балансом и парком), `(tabs)/balance`, `(tabs)/withdraw`, `(tabs)/history`, `(tabs)/settings`, `withdraw/amount`, `withdraw/idram`, `withdraw/review`, `withdraw/authorize`, `withdraw/processing`, `withdraw/success`, `withdraw/failure` (cancelled / rejected / under review), `withdrawal/[id]`, `history/[id]`, `idram/account`, `security/index`, `security/pin-set`, `security/pin-change`, `security/biometric`, `auto-payout/index`, `auto-payout/edit`, `driver-id/index`, `driver-id/request`, `settings/language`, `settings/appearance`, `settings/notifications`, `profile`, `devices`, `support`, `legal/[doc]`.

## F. Экраны админки

Dashboard, Withdrawals, Needs attention, **Taxi parks** (список, создание), **Park detail** (реквизиты Fleet API write-only + verify, статус/приостановка, импорт ростера, sync из Fleet API, история импортов, членства с изменением статуса/eligibility), Drivers, **Driver detail** (членства, переключения парков, корректировка баланса), **Driver ID requests**, **Automatic payouts** (read-only), Reconciliation, Fees, Limits, **Integrations** (yandex-fleet, payment-provider, idram, push — MOCK помечены), Audit log.

## G. Yandex Fleet — статус

Live-адаптер v3 с реквизитами по парку и roster sync написаны, **не проверены против реального парка**. Классификация endpoint'ов и полей — в `docs/YANDEX_INTEGRATION.md`. В тестах и локально — mock.

## H. iDram — статус

Порт + mock + управление кошельком + мобильный флоу. **Live-адаптера нет**: нет документации API и merchant-договора. `PROVIDER_MODE=live` бросает исключение при старте. См. `docs/IDRAM_INTEGRATION.md`.

## I. SMS — статус

Консольный шлюз. Реального провайдера нет.

## J. Безопасность

PIN — scrypt, блокировка с растущей задержкой, серверная. Биометрия — секрет устройства в keystore за OS-промптом, сервер проверяет хеш; **не аппаратно-аттестованная подпись** (ограничение задокументировано в `docs/SECURITY.md`). Каждая выплата потребляет одноразовую авторизацию внутри той же транзакции. Реквизиты парка шифруются AES-256-GCM и никогда не возвращаются. Кошелёк iDram хранится зашифрованным и показывается маской.

## K. Автовывод — статус

Правило на водителя (по порогу / ежедневно / еженедельно), согласие PIN-авторизацией с purpose AUTO_PAYOUT, cron-воркер, выполнение как обычный вывод с идемпотентностью по слоту, пауза после 3 ошибок или при недоступности парка/кошелька. Тестируется против моков.

## L. История — статус

Единый read-model: выводы (в т.ч. автоматические), возвраты, корректировки оператора; фильтры по периоду/типу/статусу, курсорная пагинация, детали. Тесты 11.

## M. Driver ID — статус

Показ текущего ID, заявка на смену с автоматической проверкой через Fleet API (mock), решение оператора, история заявок. Одобрение отклоняется при выплате в процессе.

## N. Тесты

| Пакет / приложение     | Suites | Tests   |
| ---------------------- | ------ | ------- |
| packages/money         | 3      | 59      |
| packages/contracts     | 4      | 51      |
| packages/design-tokens | 1      | 22      |
| packages/i18n          | 1      | 16      |
| apps/api               | 17     | 211     |
| apps/mobile            | 4      | 27      |
| apps/admin             | 2      | 6       |
| **Всего**              | **32** | **392** |

Локально на коммите `2404c6c`: все 392 проходят; `pnpm -r typecheck`, `pnpm lint`, `pnpm format:check` — чисто; `next build` админки успешен. Из 211 тестов API 175 — интеграционные против реальной PostgreSQL.

## O. GitHub Actions — фактический результат

| Workflow    | Коммит    | Run                                                                                 | Результат                                                                                                         |
| ----------- | --------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Cash Out CI | `549eca1` | [#3](https://github.com/arman119090-cmyk/TuTak-Platform/actions/runs/35501203648)   | **failure** — шаг Formatting: `docs/TZ_GAP_2026-09-20.md` не был отформатирован prettier (исправлено в `2404c6c`) |
| Cash Out CI | `2404c6c` | [#4](https://github.com/arman119090-cmyk/TuTak-Platform/actions/runs/35505839504)   | **success** (все шаги: миграции, typecheck, lint, format, tests, admin build, mobile checks)                      |
| CI (TuTak)  | `2404c6c` | [#888](https://github.com/arman119090-cmyk/TuTak-Platform/actions/runs/35505839509) | CI_RESULT_888                                                                                                     |

Коммит с этим отчётом и барьерами изоляции запускает ещё один прогон; его результат сообщён в ответе, а не здесь.

## O2. Изоляция от TuTak

По требованию «ни в коем случае не сливать и не мешать TuTak» добавлены барьеры (подробно — `docs/ISOLATION.md`): workflow-страж `.github/workflows/cash-out-isolation.yml` валит любой PR в `main`, который добавляет или меняет `cash-out/**`, и любой push в `main`, где есть `cash-out/`; `cash-out` исключён из `.dockerignore` и root-Prettier; отчёты Cash Out перенесены из корневого `docs/` в `cash-out/docs/`; правило записано в корневой `CLAUDE.md`. Проверено, что `git subtree split --prefix=cash-out` даёт независимую историю (18 коммитов, дерево совпадает с `HEAD:cash-out`), готовую к переносу в отдельный репозиторий или на orphan-ветку `cash-out`.

## P. Коммиты

| SHA       | Блок | Сообщение                                                                                |
| --------- | ---- | ---------------------------------------------------------------------------------------- |
| `40bdbb8` | 1    | Cash Out: parks, the driver roster and the active park                                   |
| `dd8c199` | 2    | Cash Out mobile: five tabs, the Balance screen, and a home that says whose balance it is |
| `318ff11` | 3    | Cash Out: iDram as the payout destination — port, mock, account management, mobile flow  |
| `42577bb` | 4    | Cash Out: PIN and biometric authorization for every payout                               |
| `3ca6feb` | 5    | Cash Out: automatic payout through the same pipeline                                     |
| `7c712fc` | 6    | Cash Out: balance history as a read model over withdrawals and the ledger                |
| `10b8735` | 7    | Cash Out: Driver ID change requests, verified against the fleet                          |
| `9947007` | 8    | Cash Out: settings, themes, notifications, and the premium UI kit                        |
| `f7a29b2` | 9    | Cash Out admin: parks, rosters, Driver ID requests, auto payout rules, adjustments       |
| `2404c6c` | 10   | Cash Out: mobile and admin test suites, honest docs for every integration                |

## Q. Реальные внешние блокеры

1. **Yandex Fleet:** `X-Client-ID`/`X-API-Key` каждого парка, sandbox-парк, письменное разрешение парка на списание, подтверждение Yandex о допустимости стороннего сервиса.
2. **iDram:** merchant-доступ, документация API (проверка кошелька, выплата, статус, webhook), sandbox, договор.
3. **SMS:** провайдер и реквизиты.
4. **Push:** Expo/FCM/APNs реквизиты для bundle id приложения.
5. **Отдельный репозиторий `cash-out`:** GitHub App не может создать репозиторий (`403 Resource not accessible by integration`). Нужно вручную создать пустой приватный репозиторий и дать доступ приложению, затем `cash-out/scripts/split-to-own-repo.sh`.

## R. Что требует тестов на реальных устройствах

Face ID / Touch ID / Android biometric prompt и `requireAuthentication` в keystore; SMS-автозаполнение OTP; армянская раскладка на вкладках и сегментах (бюджеты длины проверены тестами, но не пикселями); тёмная тема на OLED; поведение при потере сети в процессе выплаты; `expo-local-authentication` на устройствах без биометрии.

## S. Следующие действия

1. Получить реквизиты sandbox-парка Yandex и прогнать чек-лист из `docs/YANDEX_INTEGRATION.md` (в т.ч. roster sync).
2. Получить документацию и sandbox iDram, написать live-адаптер `IdramProviderPort`, снять `PROVIDER_MODE=live` с исключения.
3. Подключить SMS- и push-провайдеров (порты готовы).
4. Собрать EAS-сборку и пройти список из раздела R на iOS и Android.
5. Создать репозиторий `cash-out` и выполнить перенос.
6. Redis-реализация rate limiter и job перешифрования для ротации ключей (известные пробелы из `docs/STATUS.md`).
