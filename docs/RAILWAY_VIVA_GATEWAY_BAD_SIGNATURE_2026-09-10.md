# Шлюз отвечает, но отклоняет подпись — 10.09.2026

## Итог одной строкой

Соединение Railway → шлюз (`https://217.76.49.94/v1`) теперь **работает** —
это уже не «fetch failed». Но шлюз отклоняет запрос по HMAC-подписи:
`SMS_VIVA_GATEWAY_SECRET`, заданный в Railway, не совпадает с
`VIVA_GATEWAY_SECRET` на самом VPS.

## Что показал журнал

```
Viva refused the credentials (HTTP 401, code=bad_signature)
Could not deliver OTP to +374******17: Could not send the SMS message
otp register: carrier-refused
```

Это вторая строка контрольной таблицы плана:

> `carrier-refused` + отказ авторизации → связь есть, ключи не приняты →
> сверить учётные данные

Сообщение "Viva refused the credentials" здесь означает не отказ от самой
Viva, а отказ **шлюза** (тот же класс ошибки в коде используется для обоих
случаев) — код `bad_signature` специфичен для проверки HMAC-подписи, её
формирует и проверяет `infra/viva-gateway/gateway/viva-gateway.mjs` на самом
VPS, сверяя её с `VIVA_GATEWAY_SECRET` в своём окружении.

## Причина

Значение, которое вы мне передали
(`164af1ecf16afe4dd7c021f5638adb5f34f2f2408f6691a63092dc931ff1a98a`) и
которое я поставил в Railway как `SMS_VIVA_GATEWAY_SECRET`, **не совпадает**
с тем, что реально используется на сервере как `VIVA_GATEWAY_SECRET` — либо
секрет на сервере другой, либо там несколько значений и перепутано, какое
актуальное.

## Что нужно проверить на VPS

Зайдите по SSH на `217.76.49.94` и посмотрите фактическое значение, с
которым запущен gateway-процесс:

```bash
sudo systemctl cat viva-gateway | grep -i VIVA_GATEWAY_SECRET
```

или, если секрет вынесен в отдельный env-файл рядом с systemd-юнитом:

```bash
sudo systemctl cat viva-gateway | grep -i EnvironmentFile
# затем открыть найденный файл и посмотреть VIVA_GATEWAY_SECRET
```

Пришлите фактическое значение (так же, как раньше — сразу отправлю в
Railway, в чате не повторю), и я обновлю `SMS_VIVA_GATEWAY_SECRET` и
передеплою.

## Что не менялось

Postgres, Redis не трогались. `tutak-api` по-прежнему `online`, домен и
маршруты работают (`/health` отвечает `200`, сам HTTP-запрос до шлюза
доходит) — падает только подпись на последнем шаге перед отправкой SMS.
