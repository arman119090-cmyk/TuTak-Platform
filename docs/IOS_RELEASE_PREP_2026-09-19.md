# iOS: почему нет release candidate и что для него нужно

Дата: 19.09.2026

## Точная причина

iOS-сборки TuTak не существует ни одной, потому что три вещи, без
которых её нельзя сделать, находятся вне репозитория:

1. **Apple Developer аккаунт** ($99/год). Без него нельзя ни подписать
   сборку, ни установить её на iPhone, ни загрузить в TestFlight. Для
   компании — D-U-N-S (дни–недели), для физлица — быстрее.
2. **Учётные данные подписи в EAS.** Сертификат и provisioning profile
   создаёт EAS при первом `eas credentials --platform ios` с входом в Apple
   аккаунт — интерактивно, с ноутбука, один раз. CI их не видит и не
   создаёт.
3. **Физический iPhone** для preview-сборки (UDID регистрируется в
   аккаунте) или TestFlight для production-сборки.

## Что уже готово в коде (сделано сегодня + было)

| Что | Где | Состояние |
|---|---|---|
| Bundle identifier `am.tutak.app`, `supportsTablet: false` | `apps/mobile/app.config.js` | было |
| Строки разрешений (камера, геолокация) | `app.config.js` (`infoPlist`) | было |
| EAS-профили `preview-ios` (ad-hoc, для зарегистрированных iPhone) и `production-ios` (store, `autoIncrement`) | `apps/mobile/eas.json` | **добавлено** |
| Секция `submit.production-ios` с плейсхолдером `ascAppId` | `apps/mobile/eas.json` | **добавлено**; заполнить после создания приложения в App Store Connect |
| Workflow `Build iOS` (EAS cloud, `workflow_dispatch`, отказывается без `EXPO_TOKEN`, объясняет ошибку credentials) | `.github/workflows/ios-build.yml` | **добавлено** |
| Тот же код приложения, что в Android APK из `main` | — | да; платформенных отличий в путях регистрации/покупки нет |
| Профиль `preview-ios-simulator` (сборка для iOS Simulator **без Apple-аккаунта** — доказывает, что iOS компилируется) и такой же `ios-simulator` для демо + workflow «Build demo iOS (simulator)» | `apps/mobile/eas.json`, `demo/eas.json`, `.github/workflows/demo-ios.yml` | **добавлено** (ветка `claude/ios-bootstrap`) |
| Info.plist: ATS без `NSAllowsArbitraryLoads` в installable-сборках, `usesNonExemptEncryption: false`, фото-строка с целью, микрофон убран (iOS и Android), workflow передаёт `MAP_TILE_*` | `app.config.js`, `ios-build.yml` | **добавлено**; разбор — `docs/IOS_RECON_2026-09-19_RU.md` |

## Что может сделать CI

После одноразовой настройки credentials: Actions → «Build iOS» → профиль
`preview-ios` или `production-ios` → сборка в облаке EAS → ссылка на
артефакт в логе шага «Where to get it». Mac не нужен.

## Что требует Арман (минимальные шаги)

1. Оплатить Apple Developer Program (developer.apple.com).
2. На ноутбуке: `cd apps/mobile && npx eas-cli@latest credentials --platform ios`
   → войти в Apple аккаунт → «Set up new credentials» → для `preview-ios`
   добавить UDID своего iPhone (Settings → General → About → скопировать).
3. GitHub → Actions → Build iOS → `preview-ios` → установить .ipa на
   iPhone по ссылке из лога.
4. Для TestFlight: App Store Connect → создать приложение (bundle
   `am.tutak.app`) → вписать `ascAppId` в `eas.json` → Build iOS
   `production-ios` → `npx eas-cli submit --platform ios --profile production-ios`.

## Что проверить на iPhone (то же, что на Android)

`docs/ANDROID_DEVICE_TEST_RU.md`, шаги 1–9. Отдельно на iOS: safe area на
устройствах с «чёлкой», клавиатура на экране входа (KeyboardAwareScroll),
камера для QR (первый запрос разрешения).

## Статус

iOS RELEASE CANDIDATE: **BLOCKED BY ARMAN** (Apple аккаунт + одноразовая
настройка credentials). Код и CI готовы.
