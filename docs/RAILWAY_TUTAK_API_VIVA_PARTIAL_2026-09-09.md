# Viva: несекретные переменные применились, но нужны секреты — 09.09.2026

## Что произошло

Вы добавили 5 несекретных переменных Viva:

```
SMS_DRIVER=viva
VIVA_API_BASE_URL=https://businesshubapi.viva.am/api/v1
VIVA_SENDER_NAME=Tu-Tak
VIVA_OTP_TEMPLATE_NAME=Tu-Tak2
SMS_VIVA_NUMBER_FORMAT=national
```

Они применились live (`list-variables` их видит), сервис передеплоился
автоматически (деплой `6045c274-f336-49f4-883f-4a56d6e263ea`).

## Результат — ожидаемый краш

`tutak-api` сейчас **CRASHED**. Причина в журнале:

```
Error: SMS_DRIVER=viva but VIVA_CLIENT_ID, VIVA_CLIENT_SECRET, VIVA_USERNAME,
VIVA_PASSWORD are not set.
    at selectSmsTransport (apps/api/dist/infrastructure/sms/sms-transport.js:28:19)
```

В отличие от прежнего состояния (`SMS_DRIVER` не задан → транспорт мягко
помечался `unavailable`, приложение работало), явный `SMS_DRIVER=viva` без
учётных данных **фатален**: фабрика провайдера SMS бросает исключение при
старте, всё приложение не поднимается, контейнер уходит в рестарт-цикл.

Это ожидаемо и написано в плане — просто зафиксировал, что именно так себя
ведёт код, раз проверяем. Postgres и Redis не затронуты, оба `online`.
Реальных пользователей на `tutak-api` ещё нет, так что простой не критичен.

## Что нужно добавить

4 секрета в панели Railway для `tutak-api` (не в чат):

- `VIVA_CLIENT_ID`
- `VIVA_CLIENT_SECRET`
- `VIVA_USERNAME`
- `VIVA_PASSWORD`

После этого — деплой той же карточкой (сработает точечно, как раньше).
Ожидаю, что после этого приложение поднимется и в журнале транспорт SMS
покажет что-то отличное от `unavailable` (реальный Viva-провайдер).
Напишите, когда добавите — проверю журнал.
