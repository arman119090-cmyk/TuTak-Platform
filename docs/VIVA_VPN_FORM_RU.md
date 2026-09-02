# Viva VPN form — заполнение

**Форму самостоятельно НЕ отправлял.** Ниже — то, что можно заполнить, и то,
что должен подтвердить Viva.

Источники: `Viva API integration document` (4 стр., прислан 2026-09-02) и
описание формы VPN, приведённое владельцем в задании. **Скриншоты формы к
этому сообщению приложены не были** — см. §«Чего не хватает».

| Поле | Значение | Источник | Статус |
|---|---|---|---|
| City / Country | Yerevan, Armenia | Владелец | **NEEDS OWNER** — подтвердить |
| VPN Device Description | strongSwan 5.9.x, Ubuntu 24.04, Contabo Cloud VPS 4 (Hub Europe) | Наша сторона | **CONFIRMED** (версия — после live-проверки) |
| Tunnel Source (наш peer) | `217.76.49.94` | Письмо Contabo | **NEEDS LIVE CHECK** — см. ниже |
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
7. Плюс два вопроса по HTTP API, которые всё ещё открыты:
   формат номера получателя (`93600600` / `37493600600` / `+37493600600`)
   и как предъявлять access token на `transact/*`.
