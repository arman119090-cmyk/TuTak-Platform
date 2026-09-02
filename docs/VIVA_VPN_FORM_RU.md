# Viva VPN form — заполнение

**Форму самостоятельно НЕ отправлял.** Ниже — то, что можно заполнить, и то,
что должен подтвердить Viva.

Источники: `Viva API integration document` (4 стр., прислан 2026-09-02) и
описание формы VPN, приведённое владельцем в задании. **Скриншоты формы к
этому сообщению приложены не были** — см. §«Чего не хватает».

| Поле | Значение | Источник | Статус |
|---|---|---|---|
| City / Country | — | — | **NEEDS VIVA / NEEDS CONTABO LOCATION** — см. ниже |
| VPN Device Description | strongSwan 5.9.x, Ubuntu 24.04, Contabo Cloud VPS 4 (Hub Europe) | Наша сторона | **CONFIRMED** (версия — после live-проверки) |
| Tunnel Source (наш peer) | — | Письмо Contabo (значение не переносим до проверки) | **NEEDS LIVE CHECK** — см. ниже |
| Encryption Domain (наш) | — | — | **NEEDS VIVA** |
| Encryption Domain (Viva) | — | — | **NEEDS VIVA** |
| Backup VPN | — | — | **NEEDS VIVA** |
| IKE authentication | Symmetric PSK | Форма Viva | **CONFIRMED** |
| IKE version | IKEv2 | Форма Viva | **CONFIRMED** |
| IKE mode | Main Mode | Форма Viva | **CONFIRMED** |
| IKE SA lifetime | 86400 s | Форма Viva | **CONFIRMED** |
| Phase 1 Encryption | — | — | **NEEDS VIVA** |
| Phase 1 Integrity / Hash | — | — | **NEEDS VIVA** |
| Phase 1 DH group | — | — | **NEEDS VIVA** |
| Phase 1 PRF | — | — | **NEEDS VIVA** |
| ESP encryption | — | — | **NEEDS VIVA** |
| ESP integrity | — | — | **NEEDS VIVA** |
| PFS | Enabled | Форма Viva | **CONFIRMED** |
| PFS group | — | — | **NEEDS VIVA** |
| IPsec SA lifetime | 3600 s | Форма Viva | **CONFIRMED** |
| Protocol | ESP | Форма Viva | **CONFIRMED** |
| Technical contact | — | — | **NEEDS OWNER** |
| Notes | Трафик только к `businesshubapi.viva.am`, только 4 endpoint'а API | Наша сторона | **CONFIRMED** |

## City / Country — почему «NEEDS VIVA / NEEDS CONTABO LOCATION»

Раньше здесь стояло «Yerevan, Armenia». Это было неверно: Yerevan — место
ведения бизнеса владельца, а поле формы относится к VPN-устройству. VPN
gateway физически находится **не в Армении**, а в дата-центре Contabo
(тариф Cloud VPS 4, регион **Hub Europe**).

Заполнять поле нельзя, пока не подтверждены обе вещи:

1. **NEEDS VIVA** — что именно Viva хочет видеть в этом поле: физическую
   локацию VPN-устройства, юридический адрес компании или адрес технического
   контакта. От ответа зависит, идёт ли туда город дата-центра или Ереван.
2. **NEEDS CONTABO LOCATION** — точная физическая локация VPS. «Hub Europe» —
   это регион, а не город. Точный дата-центр смотрим в Contabo Customer
   Control Panel (карточка сервера → Region / Datacenter) либо в письме о
   создании сервера.

До получения обоих ответов поле остаётся пустым. Подставлять «Yerevan,
Armenia» в форму, которую Viva использует для настройки своей стороны
туннеля, нельзя.

## Tunnel Source — почему «NEEDS LIVE CHECK»

`217.76.49.94` взят из письма Contabo, приведённого в задании. Я **не смог
проверить его с самой машины** (см. §SSH-блокер), а на VPS за NAT адрес на
интерфейсе и адрес, который видит интернет, различаются — и Viva нужен
второй.

`bootstrap/00-audit.sh` печатает оба:

```
on-interface: ...
as-seen:      ...   ← это и есть Tunnel Source
```

В форму пишем `as-seen`. Если он не совпадает с `217.76.49.94` — в форму идёт
фактический, а не тот, что в письме.

**Адрес для формы и адрес для strongSwan — это не одно и то же.** Public IP —
это наш IKE identity и Tunnel Source (`__LOCAL_IKE_ID__`). В `local_addrs`
strongSwan он попадает только если реально назначен интерфейсу VPS. Если VPS
за NAT (`as-seen` не совпадает ни с одним `on-interface`), в `local_addrs`
идёт локальный адрес интерфейса или `%any`, а туннель работает через NAT-T.
Подставлять public NAT IP в `local_addrs` автоматически нельзя — сокет не
забиндится. Подробнее — `infra/viva-gateway/strongswan/PLACEHOLDERS.md`.

## PSK

Обменивается с Viva **вне репозитория и вне переписки**. В git не попадает
никогда: `/etc/swanctl/conf.d/viva-secret.conf`, права 0600, путь в
`.gitignore`.

## Чего не хватает, чтобы дозаполнить форму

К этому сообщению **не приложены**: скриншоты формы Viva, письмо Contabo с
root-доступом, invoice. В загрузках сессии есть только Viva API PDF от
2026-09-02, который я уже разобрал (он про HTTP API, а не про VPN, и ничего
из крипто-параметров не содержит — перепроверено).

Поэтому всё, что помечено **NEEDS VIVA**, взято не из «я не посмотрел», а из
«этого нет ни в одном имеющемся документе».

## Что спросить у Viva одним письмом

1. Peer IP/FQDN вашей стороны и peer ID.
2. Ваш encryption domain и какой local encryption domain вы ждёте от нас.
3. Phase 1: encryption, integrity/hash, DH group, PRF.
4. Phase 2: ESP encryption, ESP integrity, PFS group.
5. Как передаём PSK.
6. Нужен ли backup VPN и его параметры.
7. Плюс три вопроса по HTTP API, которые всё ещё открыты:
   формат номера получателя (`93600600` / `37493600600` / `+37493600600`);
   как предъявлять access token на `transact/*`;
   и какой именно `client_id` использовать для API.

## Partner ID ≠ API client_id

`10064` — это **Partner ID** в личном кабинете Viva, а не подтверждённый
API `client_id`. Пока Viva явно не подтвердит обратное, это значение
**нельзя** записывать в `SMS_VIVA_CLIENT_ID`.

В коде оно не захардкожено нигде: `SMS_VIVA_CLIENT_ID` читается из окружения
без значения по умолчанию, в `.env.example` переменная пустая, а поиск по
всему репозиторию по строке `10064` не даёт совпадений.
