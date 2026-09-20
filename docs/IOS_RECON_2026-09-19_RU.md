# iOS: разведка состояния перед первой сборкой (19.09.2026)

Что было известно до этой задачи: «у нас нет вообще iOS». Ниже — что
именно есть, чего нет, и что можно сделать без Apple-аккаунта. Ничего
из этого не выдумано: каждая строка — результат `expo config --type
introspect` (то, что Expo реально запишет в Info.plist и манифест), чтения
кода и проверки зависимостей.

## 1. Что уже было готово к iOS

| Что | Где | Состояние |
|---|---|---|
| Bundle identifier `am.tutak.app`, `supportsTablet: false`, portrait, light-only | `apps/mobile/app.config.js` | есть |
| Иконка 1024×1024 RGB **без альфы** (App Store отвергает альфу) | `assets/icon.png` | есть, проверено по PNG-заголовку |
| Splash 1024×1024, цвет фона `#F8F9FB` | `app.config.js` → `splash` | есть |
| Строки разрешений: камера (QR), геолокация (карта, только when-in-use, background выключен) | плагины `expo-camera`, `expo-location` | есть, свои тексты |
| URL-схема `tutak` | `scheme` | есть |
| Все нативные зависимости с iOS-реализацией (expo-camera/location/image/secure-store/notifications/…, react-native-svg, webview, netinfo, safe-area, screens, gesture-handler) | `package.json` | да, все из Expo SDK 57 |
| Единственный локальный нативный модуль `focus-trace` — **только Android** | `apps/mobile/modules/focus-trace` | `platforms: ["android"]`, JS-сторона через `requireOptionalNativeModule` → на iOS просто `null`, сборку не ломает |
| Sentry native plugin | `app.config.js` | подключается только при `SENTRY_AUTH_TOKEN`; без него iOS-сборка не трогает Sentry |
| Push: `expo-notifications` + Expo Push API на сервере | `registerPushToken.ts`, `PUSH_ENDPOINT` | код платформонезависим; на iOS нужен APNs-ключ в EAS (после Apple-аккаунта) |
| Удаление аккаунта в приложении (требование App Review 5.1.1(v)) | `DeleteAccountScreen` | есть |
| Sign in with Apple | — | **не требуется**: входа через Google/Facebook нет, только телефон/пароль/OTP |
| EAS-профили `preview-ios`, `production-ios`, workflow `Build iOS`, документ по релизу | PR #58 (`9af3278`) | есть, взято в эту ветку как есть |

## 2. Что было не так (и исправлено в этой ветке)

| Проблема | Доказательство | Исправление |
|---|---|---|
| **Микрофон.** Плагин `expo-image-picker` применяется Expo автоматически, даже если не перечислен, и без настройки добавляет `RECORD_AUDIO` на Android и `NSMicrophoneUsageDescription` на iOS. Плагин `expo-camera` тоже пишет строку микрофона. Приложение микрофон не использует нигде. | `introspect` до: Android `RECORD_AUDIO` в списке; iOS `NSMicrophoneUsageDescription: "Allow $(PRODUCT_NAME) to access your microphone"` | плагин `expo-image-picker` перечислен с `microphonePermission: false`, `expo-camera` — `microphonePermission: false`. После: `RECORD_AUDIO` нет, строки микрофона нет |
| **Фото-строка по умолчанию.** `NSPhotoLibraryUsageDescription: "Allow $(PRODUCT_NAME) to access your photos"` — App Review требует указать цель | `introspect` до | `photosPermission: "TuTak needs access to your photos to set a profile picture."` |
| **App Transport Security.** Шаблон Expo пишет `NSAllowsArbitraryLoads: true` во **все** сборки — выключает системный запрет cleartext, App Review просит обоснование | `introspect` до | по профилю: `development` — как было (Metro/локальный API по http); `preview/staging/production` — `NSAllowsArbitraryLoads: false`, без исключений. Тест `iosTransportSecurity` |
| **Export compliance.** Нет `ITSAppUsesNonExemptEncryption` → каждая загрузка в TestFlight останавливается на вопросе о шифровании | `introspect` до: ключа нет | `ios.config.usesNonExemptEncryption: false` (только системный TLS) |
| **Tab bar на iPhone.** Высота фиксированная `tabBarHeight`, `paddingBottom` жёстко 28: на iPhone с индикатором (inset 34) подписи на 6 pt внутри зоны индикатора; на iPhone SE (inset 0) 28 pt пустоты; `useTabBarSpace` на iOS игнорировал inset → последняя строка списка под баром | `MainTabNavigator.tsx`, `useTabBarSpace.ts` | одно правило для обеих платформ: `height = tabBarHeight + insets.bottom`, `paddingBottom = max(20, insets.bottom)`. Тесты iOS 34/0 и «то же правило, что Android» |
| **Workflow `Build iOS` без карты.** Не передавал `MAP_TILE_*` → `app.config.js` отказал бы `preview-ios` сборке через 20 минут после старта | сравнение с `android-apk.yml` | тот же блок переменных карты, что в Android-workflow; `expo config` прогоняется до `eas build`, чтобы отказ был за секунды |

## 3. Что iOS-сборке всё ещё мешает (вне репозитория)

1. **Apple Developer Program** ($99/год; для компании нужен D-U-N-S).
   Без него: не подписать, не поставить на iPhone, не загрузить в TestFlight.
2. **Одноразовая настройка credentials в EAS** с ноутбука:
   `cd apps/mobile && npx eas-cli@latest credentials --platform ios`
   (вход в Apple-аккаунт, EAS сам создаёт сертификат и профиль; CI их не видит).
3. **iPhone** с зарегистрированным UDID (для `preview-ios`) или TestFlight
   (для `production-ios`).
4. **APNs-ключ** в EAS для push (после п. 1; без него приложение работает,
   но уведомления не приходят).

## 4. Что можно сделать без Apple-аккаунта — и сделано

**Сборка для iOS Simulator.** EAS собирает нативный проект на своей
Mac-ферме и отдаёт `.app` для симулятора: подпись не нужна. Это
доказывает, что iOS-сторона **компилируется**: CocoaPods, все нативные
модули, Info.plist. На iPhone такая сборка не ставится; запускается только
в Xcode Simulator на Mac.

- профиль `preview-ios-simulator` в `apps/mobile/eas.json` и опция в
  workflow `Build iOS` (по умолчанию);
- профиль `ios-simulator` в `demo/eas.json` и workflow `Build demo iOS
  (simulator)` — демо без сервера, тот же источник, что демо-APK.

Оба используют тот же `EXPO_TOKEN`, что Android-сборки.

## 5. Что на iOS отличается в поведении и требует проверки на iPhone

- Safe area сверху (`Screen` использует `SafeAreaView edges=['top']`) и
  снизу (tab bar, исправлено выше) на iPhone с «чёлкой»/Dynamic Island.
- Клавиатура: `KeyboardAwareScroll` слушает `keyboardDidShow`/`DidHide`
  (на iOS есть более ранние `keyboardWillShow`; текущий вариант работает,
  но появление клавиатуры на экране входа стоит увидеть глазами).
- Первый запрос разрешения камеры (QR), геолокации (карта), фото (аватар)
  и уведомлений (после входа) — тексты выше.
- Шрифт системный → San Francisco; армянские подписи tab bar с
  `adjustsFontSizeToFit` — как на Android, но метрики SF другие.
- Push: только с APNs-ключом.

## 6. Что НЕ трогалось

Демо-приложение по-прежнему генерируется с `userInterfaceStyle: 'dark'` и
тёмным splash `#0A0A0F` (в отличие от светлого основного приложения) — это
существующее поведение `scripts/build-demo-app.sh`, не относящееся к iOS;
отмечено для отдельного решения.
