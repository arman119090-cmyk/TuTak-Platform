# Первый деплой tutak-api — все проверки пройдены, 09.09.2026

## Итог

Шаг 4 плана («первый деплой без Viva») закрыт полностью. Все 5 пунктов
контрольной таблицы подтверждены:

| # | проверка | результат |
|---|---|---|
| 1 | `GET /health` | `{"status":"ok","demoMode":true}` по HTTPS — подтверждено вами |
| 2 | журнал старта | 51 миграция применена, `SEED_BASELINE` отработал — подтверждено логами |
| 3 | транспорт SMS | `SMS transport: budgeted:unavailable` — ожидаемо, Viva ещё не подключена |
| 4 | `POST /v1/auth/demo-session` | **404**, `"This deployment has no demo data. Set DEMO_PASSWORD and DEMO_SEED=true, then redeploy."` — подтверждено вами с валидным телом запроса |
| 5 | строка «SMS codes are written to this log» | отсутствует в журнале |

## Пояснение по пункту 4

Первый ваш запрос (пустое тело `{}`) вернул `400 Bad Request` — это
валидация DTO (`deviceId` обязателен, ≥4 символов), она отрабатывает раньше,
чем код успевает проверить `DEMO_PASSWORD`. Это нормально: сам маршрут
зарегистрирован в NestJS (иначе не было бы 400), но при полностью валидном
теле он корректно возвращает 404, потому что `DEMO_PASSWORD` не задан.
Обхода защиты нет.

## Дальше — шаг 5, переменные Viva

Напоминаю набор для второго деплоя (несекретные переменные):

```
SMS_DRIVER=viva
VIVA_API_BASE_URL=https://businesshubapi.viva.am/api/v1
VIVA_SENDER_NAME=Tu-Tak
VIVA_OTP_TEMPLATE_NAME=Tu-Tak2
SMS_VIVA_NUMBER_FORMAT=national
```

Плюс 4 секрета от вас (в панели Railway, не в чат): `VIVA_CLIENT_ID`,
`VIVA_CLIENT_SECRET`, `VIVA_USERNAME`, `VIVA_PASSWORD`.
`SMS_VIVA_GATEWAY_SECRET` не задавать — идём напрямую к Viva, минуя шлюз.

Деплоить тем же способом (карточка сервиса → Deploy) — сработало чисто в
прошлый раз, Postgres/Redis не затрагивает.
