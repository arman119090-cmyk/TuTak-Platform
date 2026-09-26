# Поднять туннель до Viva — по шагам

Состояние на 2026-09-03. Все крипто-параметры подтверждены подписанной
формой. Осталось два действия на сервере и одно письмо.

---

## Что уже готово

| | |
|---|---|
| Крипто-параметры | ✅ подтверждены формой, вписаны в конфиг |
| Адреса обеих сторон | ✅ `217.76.0.20` (Viva) ↔ `217.76.49.94` (мы) |
| Encryption domains | ✅ `217.76.1.50/32` ↔ `217.76.49.94/32` |
| Конфиг strongSwan | ✅ готов, ставится скриптом |
| Firewall | ✅ IKE открыт **только** для `217.76.0.20` |
| Gateway (4 endpoint'а) | ✅ код готов, 21 тест проходит |

## Что осталось

| # | Что | Кто |
|---|---|---|
| 1 | Перевыпустить PSK (прежний был в переписке) | вы → Viva |
| 2 | Выполнить 5 скриптов на VPS | вы |
| 3 | Вписать PSK в один файл на сервере | вы |

---

## Шаг 1. PSK — решение принято

Viva выдала ключ, владелец решил использовать его как есть. Перевыпуск не
запрашиваем.

Зафиксировано, потому что об этом спросят позже: ключ проходил через
переписку. Риск принят осознанно. Ротация — обычная операция, её можно
сделать в любой момент без простоя, если появится повод.

**Ключ в репозиторий не попадает ни при каких обстоятельствах.** Он вводится
на сервере, в файл с правами 0600 — шаг 3.

## Шаг 1a. Что у Viva всё ещё нужно спросить

Туннель поднимется без этого. **Отправка SMS — нет.**

Адресат: **Narek Arakelian**, `narakelian@viva.am`.

```
Subject: SaNHay LLC — Business Hub API access

Dear Narek,

The IPsec tunnel is configured on our side per the form of 03/09/2026
and we are bringing it up now. Three items remain, all on the API side.

1. API credentials.
   We need client_id and client_secret for the Business Hub API. We have
   Partner ID 10064, which we understand is not the same thing.

2. Recipient number format.
   For transact/send/batch, which form do you expect:
   93600600, 37493600600, or +37493600600? The integration document
   shows one example and states no rule. A number in a shape you do not
   recognise is accepted into the batch and never delivered, so we would
   rather confirm than guess.

3. Access token presentation.
   How should the token from token/get be presented on the transact/*
   calls — Authorization: Bearer, a custom header, or a body field?

Thank you.
```

Плюс один вопрос **только если туннель не поднимется** с ошибкой
аутентификации: форма даёт ваш адрес `217.76.0.20`, но не отдельный peer ID,
и конфиг исходит из того, что они совпадают. Это единственное предположение,
оставшееся в файле. Спрашивать заранее не нужно — скорее всего совпадает.

Куда идут ответы:

| Ответ | Куда |
|---|---|
| `client_id`, `client_secret` | переменные Render/Railway, **не в чат** |
| формат номера | `SMS_VIVA_NUMBER_FORMAT` = `national` / `msisdn` / `e164` |
| способ передачи токена | `SMS_VIVA_TOKEN_PLACEMENT`, по умолчанию `bearer` |

Формат номера обязателен: без него API не стартует. Это намеренно — номер в
непонятной Viva форме принимается в батч и молча никогда не доставляется,
и единственный симптом такой ошибки в том, что клиент говорит «код не пришёл».

## Шаг 2. На сервере

Зайти по SSH на `217.76.49.94` и выполнить по порядку. Каждый скрипт можно
запускать повторно — они не ломают то, что уже сделано.

```bash
git clone https://github.com/arman119090-cmyk/TuTak-Platform.git
cd TuTak-Platform/infra/viva-gateway/bootstrap

sudo ./00-audit.sh | tee ~/audit.txt   # только читает, ничего не меняет
sudo ./10-harden.sh                    # обновления, fail2ban, sysctl
sudo ./20-firewall.sh                  # SSH + IKE (только Viva) + 443
sudo ./30-strongswan.sh                # ставит strongSwan и конфиг
sudo ./40-gateway.sh                   # gateway + systemd
sudo ./50-tls.sh                       # сертификат для домена шлюза
```

**`00-audit.sh` теперь сам называет нужное значение.** В его выводе будет
раздел `local_addrs — the line for viva.conf`, и там прямо написано, что
ставить. `30-strongswan.sh` определяет это же значение самостоятельно и
подставляет — вручную ничего править не нужно.

Если сервер окажется не тем (публичный адрес не `217.76.49.94`),
`30-strongswan.sh` **откажется** ставить конфиг и скажет почему. Это
намеренно: Viva не примет туннель с другого адреса.

## Шаг 3. Ключ

```bash
sudo nano /etc/swanctl/conf.d/viva-secret.conf
```

Заменить `PUT_THE_PSK_HERE` на ключ от Viva. Файл уже создан скриптом с
правами 0600, идентичности вписаны.

```bash
sudo swanctl --load-all
sudo swanctl --initiate --child viva
sudo swanctl --list-sas
```

Ожидаемый результат:

```
viva: #1, ESTABLISHED, IKEv2, ...
  local  '217.76.49.94' @ 217.76.49.94
  remote '217.76.0.20'  @ 217.76.0.20
  AES_CBC-256/HMAC_SHA2_256_128/PRF_HMAC_SHA2_256/MODP_2048
  viva: #1, reqid 1, INSTALLED, TUNNEL, ESP:AES_CBC-256/HMAC_SHA2_256_128/MODP_2048
    local  217.76.49.94/32
    remote 217.76.1.50/32
```

`ESTABLISHED` и `INSTALLED` — туннель поднят.

## Шаг 4. Проверка, что через туннель действительно ходит

```bash
sudo ./99-verify.sh
```

---

## Если не поднялось

**`no matching proposal found`** — расхождение в крипто-параметрах.
Сверить `swanctl --list-conns` с формой. Все значения подтверждены, так что
расхождение означает опечатку либо изменение на стороне Viva.

**`authentication failed` / `AUTHENTICATION_FAILED`** — два варианта:
1. PSK не совпадает — перепроверить, что вписан именно выданный ключ;
2. Viva идентифицируется не своим IP. Форма даёт адрес, но **не даёт
   отдельный peer ID**, и конфиг исходит из того, что они совпадают. Это
   единственное предположение, оставшееся в файле. Спросить у
   `syseng@viva.am` их IKE identity и поправить `remote { id }`.

**`ESTABLISHED`, но трафик не идёт** — расходятся encryption domains.
Сверить `local_ts` / `remote_ts` с формой.

**Ничего не происходит, таймаут** — firewall на стороне Viva либо неверный
peer. Проверить `sudo tcpdump -ni any host 217.76.0.20` — видно ли исходящие
пакеты на UDP 500.

---

## Что дальше, после туннеля

1. Задать `SMS_VIVA_GATEWAY_SECRET` (одинаковый на VPS и в Railway).
2. Переключить `SMS_ENDPOINT` на адрес шлюза.
3. Внести `SMS_VIVA_CLIENT_ID` / `CLIENT_SECRET`, когда Viva их выдаст.
4. Уточнить у Viva формат номера получателя — от этого зависит
   `SMS_VIVA_NUMBER_FORMAT`, и ошибка здесь невидима: номер принимается и
   никогда не доставляется.
5. Первый живой OTP — только на staging.
