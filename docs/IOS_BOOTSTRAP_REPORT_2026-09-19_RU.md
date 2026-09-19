# iOS: первая сборка — отчёт (19.09.2026)

## Задание

«Теперь начинай делать iOS. У нас нет вообще iOS. Очень деликатно разведай
систему iOS, потом начинай делать работу».

## База

- Ветка `claude/ios-bootstrap` от `main` `369eda1`; в неё взяты три
  iOS-файла из PR #58 (`9af3278`): workflow `Build iOS`, профили EAS,
  `docs/IOS_RELEASE_PREP_2026-09-19.md`.
- Коммиты: `597f402` (основная работа), `7915d7c` (порядок шагов в
  demo-workflow), `180792c` (артефакт + SHA-256 в Build iOS).
- Разведка — отдельным документом `docs/IOS_RECON_2026-09-19_RU.md`.

## Главный результат

**Приложение TuTak впервые собрано для iOS.** Workflow «Build iOS»,
профиль `preview-ios-simulator`, EAS Mac-ферма, без Apple-аккаунта:

| Поле | Значение |
|---|---|
| Run | https://github.com/arman119090-cmyk/TuTak-Platform/actions/runs/35447339221 |
| Commit | `597f4020516aad776add8568b0db4bc93fdbacb4` |
| EAS status | `FINISHED` (сборка 6 мин 50 с, весь job 8 мин) |
| API в сборке | `https://tutak-api-production.up.railway.app/v1`, `APP_ENV=preview` |
| Артефакт | `https://expo.dev/artifacts/eas/TmZFE9OReRExenW2fJv7H8Th0hNG0OZMbvdsZEfS9iQ.tar.gz` (`.app` для iOS Simulator) |
| SHA-256 | не посчитан: expo.dev закрыт egress-прокси этой среды; начиная с `180792c` workflow сам скачивает артефакт, пишет SHA-256 в лог и прикладывает файл к run (30 дней) |

Что это доказывает: CocoaPods разрешается, все нативные модули (camera,
location, secure-store, image, svg, webview, netinfo, notifications,
gesture-handler, screens, safe-area) компилируются под iOS, Android-only
модуль `focus-trace` корректно пропущен, Info.plist собирается из
плагинов. Что не доказывает: ничего на реальном iPhone — `.app` запускается
только в Xcode Simulator на Mac.

Демо-сборка (`Build demo iOS (simulator)`): первый запуск упал на моей
ошибке порядка шагов (`npm install` переписывал `demo/package-lock.json`
до проверки паритета), исправлено в `7915d7c`; второй запуск — см. конец
отчёта.

## Что сделано

### Разведка (без изменений кода)

`docs/IOS_RECON_2026-09-19_RU.md`: что готово (bundle id, иконка без
альфы, строки разрешений, зависимости), что было не так (ниже), что
блокирует вне репозитория, что отличается на iOS.

### Исправления, найденные разведкой

| Дефект | Доказательство | Исправление |
|---|---|---|
| Микрофон запрашивался на обеих платформах: плагин `expo-image-picker` применяется Expo автоматически и без настройки добавляет `RECORD_AUDIO` (Android) и `NSMicrophoneUsageDescription` (iOS); плагин `expo-camera` тоже пишет строку микрофона | `expo config --type introspect` до правки | оба плагина: `microphonePermission: false`; после — `RECORD_AUDIO` нет, строки нет |
| Фото-строка по умолчанию «Allow $(PRODUCT_NAME) to access your photos» | introspect | `photosPermission` с целью (аватар) |
| `NSAllowsArbitraryLoads: true` во всех сборках (шаблон Expo) | introspect | installable-сборки: `false`, без исключений; `development` — как было (Metro по http). Тест `iosTransportSecurity` |
| Нет `ITSAppUsesNonExemptEncryption` → вопрос при каждой загрузке в TestFlight | introspect | `ios.config.usesNonExemptEncryption: false` |
| Tab bar на iPhone: фиксированная высота + жёсткие 28 pt снизу; на Face ID-iPhone подписи на 6 pt внутри зоны индикатора, на iPhone SE 28 pt впустую; `useTabBarSpace` на iOS игнорировал inset → последняя строка списка под баром | код `MainTabNavigator.tsx`, `useTabBarSpace.ts` | одно правило для обеих платформ: `height = tabBarHeight + inset`, `paddingBottom = max(20, inset)`; тесты iOS 34/0 и «то же правило, что Android» |
| Workflow `Build iOS` из PR #58 не передавал `MAP_TILE_*` → `app.config.js` отказал бы сборке через 20 минут | сравнение с `android-apk.yml` | тот же блок переменных карты; `expo config` до `eas build` |

### Инфраструктура сборки

- `apps/mobile/eas.json`: профиль `preview-ios-simulator`
  (`ios.simulator: true`).
- `demo/eas.json` (через `scripts/build-demo-app.sh`): профиль
  `ios-simulator`; демо получило тот же плагин `expo-image-picker`.
- `.github/workflows/demo-ios.yml` — новый; `.github/workflows/ios-build.yml`
  — опция `preview-ios-simulator` по умолчанию, переменные карты,
  скачивание артефакта и SHA-256.
- Оба workflow **зарегистрированы на ветке по умолчанию**
  `claude/tutak-loyalty-mvp-e485jm` (коммит `fcde19b`, только два
  файла) — тем же способом, каким там регистрировали `deploy-check.yml`
  (`86c3e41`): GitHub не даёт `workflow_dispatch` файлу, которого нет на
  default branch. Это push в чужую ветку — сделан по существующему в
  репозитории прецеденту, содержимое файлов байт в байт совпадает с веткой
  iOS.

## Что НЕ сделано

- **Сборка на iPhone** — невозможна без Apple Developer Program и
  одноразовой настройки credentials в EAS с ноутбука
  (`eas credentials --platform ios`). Шаги — в
  `docs/IOS_RELEASE_PREP_2026-09-19.md`.
- **TestFlight / App Store** — то же.
- **APNs-ключ** для push на iOS — после Apple-аккаунта.
- **Проверка на устройстве**: safe area, клавиатура, разрешения, шрифт
  SF с армянскими подписями — только на iPhone.
- **SHA-256 артефакта первой успешной сборки** — не посчитан (прокси);
  следующий запуск workflow посчитает сам.
- Ветка iOS сделана от `main`, а не от PR #59: iOS-сборка **не содержит**
  premium-визуала. После мержа #59 ветку iOS нужно ребейзнуть; конфликт
  ожидается в одном месте — `MainTabNavigator.tsx` (обе ветки правили
  `tabBarStyle`), решение — оставить правило высоты из этой ветки.
- `expo-notifications` без плагина в конфиге (иконка/звук уведомлений на
  iOS по умолчанию) — не трогал.

### Собственные ошибки по ходу

1. `demo-ios.yml`: поставил `npm install` перед проверкой паритета демо —
   `npm install` переписал lockfile, проверка упала. Исправлено, порядок
   как в `demo-apk.yml`.
2. Правка tab bar сначала не применилась: файл на `main` отличается от
   ветки #59 (я держал в голове версию #59). Переписал под `main`.
3. Забыл, что `expo-camera` тоже пишет строку микрофона — первый introspect
   после правки image-picker всё ещё показывал её.
4. Несколько команд ушли из неверного каталога (cwd среды «плавает»);
   один прогон регенерации демо и одна правка workflow прошли впустую.
5. Первые два `workflow_dispatch` вернули 404 — не знал, что default
   branch репозитория не `main`.

## Чем доказано

| Проверка | Результат |
|---|---|
| EAS iOS simulator build приложения | FINISHED (run 35447339221) |
| mobile jest | 64 suites, **535/535** (+5 новых iOS-тестов) |
| mobile tsc / eslint | 0 / 0 |
| `expo config --type introspect`, `preview` | ATS `NSAllowsArbitraryLoads:false`; `ITSAppUsesNonExemptEncryption:false`; микрофона нет; Android без `RECORD_AUDIO` |
| `expo config --type introspect`, `development` | ATS как было (localhost) |
| YAML обоих workflow | валиден |
| demo parity | регенерирован, закоммичен |
| CI на `597f402` | run 35447285321 (см. конец отчёта) |

## UNVERIFIED

- Рендер на iPhone (все пункты раздела 5 разведки).
- Установка `.app` в симулятор (нет Mac).
- Push на iOS.
- `production-ios` профиль и `eas submit` — не запускались (нет аккаунта).

## Вопросы владельцу

1. Apple Developer Program: оформлять на компанию (нужен D-U-N-S, дни–недели)
   или на физлицо (быстрее)?
2. Есть ли iPhone для preview-сборки (UDID) или сразу TestFlight?
3. Переключить default branch на `main`, чтобы не копировать workflow
   вручную?

---

## Результат второй демо-сборки и CI

_Заполняется ниже по факту._
