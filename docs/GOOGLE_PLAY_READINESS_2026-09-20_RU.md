# Google Play: готовность на 20.09.2026

Проверка по коду и конфигурации репозитория против текущих требований
Google Play (Play Console: листинг, Data safety, account deletion, target
API, подпись). Ничего не публиковалось, никаких действий в Play Console
не делалось. Три колонки: `READY IN CODE` — есть в репозитории и
проверено; `OWNER ACTION` — может сделать только владелец; `BLOCKED /
EXTERNAL` — упирается во внешнюю сторону.

| Пункт | Статус | Факт / что делать |
| --- | --- | --- |
| App icon 512×512 (Play) и adaptive icon | READY IN CODE | `apps/mobile/assets/icon.png`, `adaptive-icon.png` (foreground) + фон `#0A0A0F`. Логотип не менялся. Для листинга Play нужен отдельный 512×512 PNG без прозрачности — это тот же `icon.png`, экспортировать при загрузке |
| Splash | READY IN CODE | `splash-icon.png`, фон `#F8F9FB`. В тёмной теме splash остаётся светлым (осознанно, отдельное изменение сборки) |
| `applicationId` | READY IN CODE | `am.tutak.app` (`app.config.js: android.package`) |
| version / versionCode | OWNER ACTION | `version: '0.1.0'`; `versionCode` не задан в `app.config.js`, его выдаёт EAS (`production` profile: `autoIncrement: true`). Перед первым релизом задать `version` (например `1.0.0`) — решение владельца |
| AAB release profile | READY IN CODE | `eas.json` → `production`: `buildType: app-bundle`, `APP_ENV=production`. Не запускался: нужен `EXPO_TOKEN` и EAS-кредит (cloud) либо workflow с `builder: local` для AAB — сейчас `android-apk.yml` собирает только APK |
| Подпись (upload key) | OWNER ACTION | EAS-managed keystore уже используется для APK (см. `android-apk.yml`). Для Play нужен Play App Signing: при первой загрузке AAB Play предложит его включить; upload key = EAS keystore. Резервную копию keystore скачать из EAS и хранить у владельца |
| Target API level | READY IN CODE | Expo SDK 57 / RN 0.86 собирает под актуальный targetSdk, который Play требует на 2026 год. Проверить в собранном AAB (`aapt dump badging`) — не делал, нет AAB |
| Permissions | READY IN CODE | Android: `CAMERA` (QR), `ACCESS_COARSE/FINE_LOCATION` через `expo-location` (карта рядом), `USE_BIOMETRIC` через `expo-local-authentication`, `POST_NOTIFICATIONS` через `expo-notifications`. Каждое объяснено в UI до запроса. Declaration form в Play заполнять не нужно (нет SMS/CallLog/Accessibility/background location) |
| Privacy policy URL | BLOCKED / EXTERNAL | Страница есть (`apps/api/public/legal/privacy.html`), но выключена (`LEGAL_PAGES_ENABLED` не задан), в тексте плейсхолдеры `[OPERATOR]`, `[ADDRESS]`, `[CONTACT EMAIL]`. Нужен юрист + реквизиты, затем включить и указать URL в Play |
| Account deletion (в приложении + URL) | READY IN CODE / OWNER ACTION | В приложении: Настройки → «Удалить аккаунт» (пароль, 30 дней на восстановление). Страница `account-deletion.html` есть; включается тем же флагом, URL указать в Play |
| Data safety form | OWNER ACTION | Что собираем по факту кода: телефон, имя, e-mail (необязательно), история покупок, app-generated device id, приблизительная геолокация (только при открытой карте, не хранится на сервере), аватар (по желанию), push-токен, crash-данные при включённом Sentry. Не собираем: точную локацию в фоне, контакты, рекламный ID. Рекламных/аналитических SDK нет → «Data is not used to track you». Таблица в `docs/STORE_SUBMISSION.md` §3 |
| Screenshots (2–8, 16:9 или 9:16) | OWNER ACTION | Черновики 1080×2340 из web-сборки: `docs/screenshots/store-draft/` (главная, карта, приглашение друзей, вход с Жако). Это черновики: Play принимает их технически, но настоящие снимки должны быть с устройства (шрифты, статус-бар, тайлы карты) |
| Feature graphic 1024×500 | OWNER ACTION | Не сделан. Предложение: зелёный градиент карты баланса + `01_jako_login` + слоган «Больше возможностей рядом» на трёх языках (отдельные графики на язык). Могу собрать по вашему «да» |
| Short / full description | OWNER ACTION | Не написаны. Черновик могу дать на трёх языках; утверждать вам |
| Content rating (IARC) | OWNER ACTION | Анкета в Play Console; ожидаемо «Everyone» (нет UGC-чата, нет азартных игр; есть покупки у партнёров, не in-app purchases) |
| App access (тестовый аккаунт для ревью) | OWNER ACTION | Ревьюеру нужен вход без SMS: демо-режим (`DEMO_MODE`) на production выключен намеренно. Вариант: тестовый номер с фиксированным кодом на сервере — не реализован, это изменение API |
| Store listing languages | READY IN CODE | Приложение hy/ru/en; листинг заводить на трёх языках |
| Developer account | OWNER ACTION | Google Play Developer, $25 однократно, верификация личности/организации занимает дни |

## Что проверить на устройстве перед загрузкой

- Первый запуск: вход по SMS (Viva), код приложения, отпечаток.
- Карта: тайлы грузятся (ключ провайдера в сборке), pinch.
- Тёмная тема на Samsung/Xiaomi.
- `fontScale 1.3`: экраны входа и партнёрского мастера не режут кнопки.

## Что осознанно не делалось

- Ни одного действия в Play Console.
- AAB не собирался (нет EAS-кредита/токена в этой сессии; `android-apk.yml` собирает APK).
- Тексты листинга не писал без утверждения слогана и позиционирования.
