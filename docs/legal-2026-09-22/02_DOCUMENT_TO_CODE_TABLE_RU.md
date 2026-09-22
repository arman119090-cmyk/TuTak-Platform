# Положение документа → реализация → проверка

Сверка текстов пакета `TuTak_Legal_2026-09-22` с тем, что система делает на
самом деле, на коммите ветки `claude/railway-connector-check-wy0ffq`.

Колонка «Состояние»:

- **реализовано** — в коде есть именно то, что написано в документе;
- **требует изменения текста** — код правильный, а документ описывает его
  неточно;
- **не применяется** — положение относится к функции, которая выключена
  (PSP, stored value, POS) и в пилоте A не участвует;
- **решение владельца** — код тут ни при чём, нужна цифра или правило.

---

## 1. Условия использования (`01_TERMS.md`)

| Положение документа | Реализация | Проверка | Состояние |
| --- | --- | --- | --- |
| Оператор, реквизиты, контакты | `{{OPERATOR_LEGAL_NAME}}` и ещё 8 полей не заполнены | `legal-publication-gate.spec.ts` — gate не публикует | решение владельца |
| Регистрация по номеру +374 с подтверждением кодом | `auth.service.ts` `requestRegistrationOtp` / `verifyRegistrationOtp`, формат телефона — `common/validators/armenian-phone.ts` | `auth-otp.int-spec.ts` | реализовано |
| Аккаунт создаётся только после подтверждения номера | Аккаунт пишется в транзакции `verifyRegistrationOtp` после `consumeCode` | `auth-otp.int-spec.ts` | реализовано |
| Пароль знает только пользователь | `argon2.hash(dto.password)`, `passwordChangedAt` ставится при создании | `auth-otp.int-spec.ts` («usable from the sign-in screen») | реализовано |
| Бонусы не обмениваются на деньги | Вывод бонусов деньгами в коде отсутствует; `CUSTOMER_PREPAID_TOPUP_ENABLED` выключен | `customer-balance-disabled.int-spec.ts` | реализовано |
| Оплата покупки через провайдера | Путь PSP есть, но `TUTAK_PSP_ENABLED=false` в production | `configuration.ts`, переменные Railway | не применяется |

## 2. Политика обработки персональных данных (`02_PRIVACY.md`)

| Положение документа | Реализация | Проверка | Состояние |
| --- | --- | --- | --- |
| Состав данных: телефон, профиль, устройства, покупки, бонусы, приглашения, обращения | Таблицы `users`, `devices`, `transactions`, `purchase_intents`, `bonus_*`, `referral_*`, `audit_logs` | `prisma/schema.prisma` | реализовано |
| Геолокация — только на переднем плане | `expo-location` с `isIosBackgroundLocationEnabled: false` и `isAndroidBackgroundLocationEnabled: false`; единственный вызов — `requestForegroundPermissionsAsync` | `apps/mobile/app.config.js:466`, `useApproximateLocation.ts:131` | реализовано |
| Биометрия добровольна, шаблоны не покидают устройство | `expo-local-authentication`; на сервер уходит только факт разблокировки, ключ лежит в Secure Enclave/Keystone устройства | `apps/mobile/src/data/biometrics/biometricDevice.ts` | реализовано, но формулировку про «шаблоны» должен подтвердить юрист (см. `04_…`) |
| Данные передаются подрядчикам | Фактические получатели: Expo Push (`https://exp.host/--/api/v2/push/send`), Sentry, MapTiler (тайлы карты), Viva (SMS), Telegram (служебные алерты), Railway (хостинг и БД), S3-совместимое хранилище (фото) | `configuration.ts:772`, `app.config.js`, `viva-sms.provider.ts`, `telegram-alert.channel.ts` | требует изменения текста: реестр получателей `{{RECIPIENTS_REGISTER_URL}}` не заполнен |
| В телеметрию не уходят персональные данные | `sentry-sanitize.ts` вырезает весь свободный текст (`request`, `message`, `user`, `extra`, `contexts`), оставляя только структурные поля из allow-list; паритет с `@tutak/observability` проверяется скриптом в CI | `scripts/verify-sentry-sanitizer-parity.js`, `sentry-otel.spec.ts` | реализовано |
| Чужие фотографии не открываются в обход интерфейса | Аватары отдаются только по подписанной ссылке, и маршрут доставки **на каждом обращении** заново проверяет право смотреть — отозванное согласие действует немедленно, а не по истечении ссылки | `media-delivery.service.ts:76-90`, `media-system.int-spec.ts` | реализовано |
| Сроки хранения по категориям | `{{RETENTION_SCHEDULE_URL}}`, `{{SECURITY_LOG_RETENTION}}`, `{{SUPPORT_RETENTION}}`, `{{LOCATION_RETENTION}}` не заполнены; в коде есть только срок удаления аккаунта | `configuration.ts` `accountDeletion.graceDays` (30) | решение владельца |
| Сроки ответа на обращения | В коде нет автоматики обращений; сроки по армянскому закону (5 дней / 10 рабочих дней / 3 рабочих дня) нельзя подменять сроками GDPR | `source/internal/07_APPROVAL_AND_SOURCES_RU.md` | решение владельца |

## 3. Правила бонусов, отмен и возвратов (`03_BONUS_AND_REFUNDS.md`)

| Положение документа | Реализация | Проверка | Состояние |
| --- | --- | --- | --- |
| Параметры покупки фиксируются и не меняются задним числом | Ставка и правило вклада пишутся в `purchase_intents` при создании | `contribution-rules.int-spec.ts` | реализовано |
| Бонусы сгорают по сроку, тратятся в определённом порядке | FIFO по `expiresAt` в `bonus-engine.service.ts` | `bonus-engine.int-spec.ts` | реализовано; но само правило срока `{{BONUS_VALIDITY_RULE}}` и порядок списания `{{BONUS_SPEND_ORDER}}` в документе не заполнены | 
| Возврат разделяет деньги и бонусы | Аллокатор возврата по компонентам финансирования | `hybrid-refund.int-spec.ts`, `refund-engine.int-spec.ts` | реализовано |
| Возвращённые бонусы и их срок | `{{RESTORED_BONUS_EXPIRY_RULE}}` не заполнено | — | решение владельца |
| Отложенные бонусы, предельный срок | `{{DEFERRED_MAX_DAYS}}`, `{{DEFERRED_RESOLUTION_POLICY}}` не заполнены | — | решение владельца |

## 4. Согласия (`04_CONSENTS.md`)

| Положение документа | Реализация | Проверка | Состояние |
| --- | --- | --- | --- |
| Два независимых обязательных согласия, по умолчанию пустые | `ConsentCheckbox`, состояние в `useRegistrationConsents`; сервер требует обе цели | `OtpRegisterScreen.consents.test.tsx`, `legal-consent-registration.int-spec.ts` | реализовано |
| Согласие даётся к конкретной редакции текста | В записи хранятся `revision`, `contentHash`, `language` по каждому документу; хэш проверяется на сервере | `legal-consent-registration.int-spec.ts` («refuses a hash the server never published») | реализовано |
| Отзыв не стирает историю выдачи | Таблица `legal_consent_records` только дополняется, отзыв — новая строка | тот же файл, тест про отзыв маркетинга | реализовано |
| Реклама по каналам отдельно, скрытое включение запрещено | Цели `MARKETING_SMS/PUSH/EMAIL` есть в модели и проверяются при отправке и повторно перед доставкой | `notifications.service.ts`, `push-dispatch.service.ts` | реализовано на сервере; **экрана управления каналами в приложении нет** — рассылок пока нет вовсе (см. отчёт, раздел «Что не сделано») |
| Согласие хранит связь с подтверждением телефона, но не код | `registrationChallengeId` — id строки `auth_otp_tokens`; ни кода, ни его хэша в записи нет | тест «stores the edition, the language, the hash and the link» | реализовано |
| Рекомендации и видимость фото — отдельно и по умолчанию выключены | `User.personalizedRecommendationsConsent` и `User.avatarConsentReferralList`, оба `@default(false)`; переключатели живут в настройках, не на форме регистрации | `schema.prisma`, `SettingsScreen.tsx`, `AvatarControl.tsx` | реализовано |
| Разрешения (камера, геолокация, push, биометрия) спрашиваются в момент использования, отказ не блокирует | Геолокация запрашивается на экране карты и при отказе экран продолжает работать; биометрия — необязательная надстройка над обязательным кодом приложения | `useApproximateLocation.ts`, `AppLockSettings.tsx` | реализовано; на устройстве не проверялось |
| 18+ | Цель `AGE_CONFIRMATION_18` заведена, но нигде не спрашивается | — | решение владельца |

## 5. Закрытие аккаунта (`05_ACCOUNT_DELETION.md`)

| Положение документа | Реализация | Проверка | Состояние |
| --- | --- | --- | --- |
| Закрытие доступно из приложения | Экран `DeleteAccountScreen`, `DELETE /users/me` | `account-deletion.int-spec.ts` | реализовано |
| Доступ прекращается сразу, данные стираются позже | `deletedAt` закрывает вход немедленно; `anonymizedAt` ставит sweep через `ACCOUNT_DELETION_GRACE_DAYS` (сейчас 30) | `account-deletion.service.ts:81,224,268` | реализовано; срок — решение владельца |
| Финансовая история не уничтожается | Связь `Wallet → User` стоит `onDelete: Restrict`, жёсткого удаления нет нигде; обезличивание сохраняет проводки | `schema.prisma`, `account-deletion.int-spec.ts` | реализовано |
| Аккаунт не возвращается из резервной копии | Проверить нечем: политика резервных копий Railway владельцу неизвестна, `{{BACKUP_RETENTION}}` не заполнено | — | **не проверено**, решение владельца |
| Push-токены после закрытия | Устройства и токены обезличиваются вместе с аккаунтом | `account-deletion.service.ts` | реализовано |
| Обращение по данным без входа в аккаунт | Такого канала в продукте нет: есть только удаление из приложения и статическая страница `/legal/account-deletion` | `legal.controller.ts` | **не реализовано**, см. отчёт |
