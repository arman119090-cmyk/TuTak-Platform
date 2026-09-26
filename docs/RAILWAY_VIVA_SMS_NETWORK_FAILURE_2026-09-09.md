# СМС не доходит — точная причина найдена: Railway не может достучаться до Viva напрямую

Дата: 09–10.09.2026.

## Что показал журнал

По запросу `POST /v1/auth/register/request-otp` в логе `tutak-api`:

```
Viva request to /token/get failed: fetch failed
Could not deliver OTP to +374******73: Could not send the SMS message
otp register: carrier-refused
```

Повторилось на всех трёх попытках. Это произошло **до** того, как Viva
вообще ответила чем-либо — нет ни HTTP-статуса, ни кода `RC`. `fetch failed`
означает, что сам сетевой запрос (TCP/TLS) до `businesshubapi.viva.am` не
состоялся. Это первая строка из контрольной таблицы плана:

> `carrier-refused` + сеть/таймаут → до Viva не достучались → адрес Railway
> не в списке разрешённых → шлюз

## Почему это ожидаемо — подтверждено в самом коде

В `apps/api/src/config/configuration.ts` рядом с `gatewaySecret` есть
комментарий разработчика:

> «Railway has no static outbound IP, so an allow-list cannot be the
> authentication — the request signs itself instead [через HMAC-шлюз].»

И в `infra/viva-gateway/README.md`:

> «Railway Hobby has no stable outbound IP, so an allow-list would have to
> be wide enough to be worthless.»

То есть прямое подключение Railway → Viva **структурно не может работать
надёжно**: у Railway нет постоянного исходящего IP, который можно было бы
внести в разрешённый список у Viva. Именно поэтому для этого в репозитории
заранее собран отдельный шлюз на Contabo VPS (`217.76.49.94`) — он держит
постоянный IP и поднимает IPsec-туннель до Viva, а Railway обращается уже к
шлюзу.

## Что мне нужно от вас, чтобы продолжить

Шлюз — это отдельный сервер (VPS `217.76.49.94`), доступа к которому у меня
нет (ни SSH, ни иного инструмента). По документу
`docs/VIVA_TUNNEL_RUNBOOK_RU.md` (от 03.09.2026) там оставалось сделать
вручную:

1. Вписать PSK-ключ от Viva на сервере.
2. Прогнать 5 bootstrap-скриптов (harden, firewall, strongswan, gateway,
   tls).
3. Убедиться, что туннель реально поднят (`swanctl --list-sas` →
   `ESTABLISHED`/`INSTALLED`).

**Вопрос: этот туннель и шлюз на `217.76.49.94` уже подняты и работают,
или нет?**

- **Если да** — скажите домен шлюза (в примерах фигурирует
  `viva-gw.tutak.am`, но мог быть выбран другой) и подтвердите, что на самом
  сервере уже задан `VIVA_GATEWAY_SECRET` (командой `openssl rand -hex 32`
  на шаге установки). Тогда я:
  - поменяю `VIVA_API_BASE_URL` у `tutak-api` на адрес шлюза вместо
    `businesshubapi.viva.am`;
  - добавлю `SMS_VIVA_GATEWAY_SECRET` с тем же значением, что вы задавали
    на сервере как `VIVA_GATEWAY_SECRET` (это значение мне нужно от вас так
    же, как остальные секреты — не буду выводить в чат в ответ, только
    приму и сразу отправлю в Railway);
  - передеплою и проверю журнал.

- **Если нет** — это отдельная задача на самом VPS, я её выполнить не могу
  (нет доступа к серверу), придётся делать руками по runbook'у или дать мне
  доступ каким-то другим способом.

## Что не изменилось

Postgres, Redis и остальная конфигурация `tutak-api` не трогались.
Приложение по-прежнему `online`, просто отправка СМС через Viva напрямую не
работает по описанной причине.
