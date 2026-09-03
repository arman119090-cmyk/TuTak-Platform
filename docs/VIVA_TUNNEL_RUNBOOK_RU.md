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

## Шаг 1. Письмо в Viva

```
Subject: PSK reissue request — SaNHay LLC IPsec tunnel

Hello,

Please reissue the pre-shared key for our IPsec tunnel
(peer 217.76.49.94, encryption domain 217.76.49.94/32).
The previously issued key must be considered compromised.

The rest of the configuration from the application form of 03/09/2026
is unchanged and already in place on our side.

Thank you.
```

На `syseng@viva.am`.

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
