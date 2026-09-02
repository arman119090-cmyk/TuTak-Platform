# Исправления к commit `7ed6782` — отчёт по пяти пунктам

Только по пяти пунктам задания. Production и VPS не трогал.

---

## 1. `10064` — Partner ID, а не подтверждённый API `client_id`

**Проверено, нигде не захардкожено.**

Поиск по всему репозиторию (без `node_modules` и `.git`) по строке `10064`:
единственное совпадение — новый пояснительный абзац в
`docs/VIVA_VPN_FORM_RU.md`, где прямо сказано, что это Partner ID и его
нельзя класть в `SMS_VIVA_CLIENT_ID`. В коде значения нет.

Значение читается только из окружения, без default:

- `apps/api/src/config/configuration.ts:423` — `clientId: process.env.SMS_VIVA_CLIENT_ID ?? ''`
- `.env.example:35` — `SMS_VIVA_CLIENT_ID=` (пусто)
- `apps/api/src/infrastructure/sms/sms-transport.ts:49` — если пусто, boot падает
  с явной ошибкой (тест `viva-sms.provider.spec.ts:548`)

Добавил в `docs/VIVA_VPN_FORM_RU.md` раздел «Partner ID ≠ API client_id» и
третий открытый вопрос к Viva: какой именно `client_id` использовать.

---

## 2. City / Country — больше не «Yerevan, Armenia»

**Было:** `| City / Country | Yerevan, Armenia | Владелец | NEEDS OWNER |`

**Стало:** `| City / Country | — | — | NEEDS VIVA / NEEDS CONTABO LOCATION |`

Плюс новый раздел с объяснением: поле относится к VPN-устройству, а gateway
физически стоит в Contabo (Cloud VPS 4, регион **Hub Europe**), а не в
Армении. Не заполняем, пока не подтверждены обе вещи:

1. **NEEDS VIVA** — что Viva хочет в этом поле: физическую локацию
   VPN-устройства, юрадрес компании или адрес техконтакта.
2. **NEEDS CONTABO LOCATION** — точный дата-центр. «Hub Europe» — регион, а
   не город; смотреть в Contabo Customer Control Panel или в письме о
   создании сервера.

Заодно убрал `217.76.49.94` из ячейки Tunnel Source в таблице — значение из
письма не переносим в форму до live-проверки; в тексте под таблицей оно
осталось с пометкой «не проверен с машины».

---

## 3. strongSwan PSK template: `id-2` теперь `__VIVA_PEER_ID__`

**Был реальный дефект.** `remote { id = __VIVA_PEER_ID__ }`, а
`secrets { id-2 = __VIVA_PEER__ }`. strongSwan выбирает PSK по identity, а не
по адресу, поэтому при `__VIVA_PEER__ != __VIVA_PEER_ID__` (FQDN как peer,
IP как ID — обычный случай) аутентификация падала бы с корректным PSK.

Исправлено в `infra/viva-gateway/strongswan/viva.conf.template`:

```
secrets {
    ike-viva {
        id-1   = __LOCAL_IKE_ID__
        id-2   = __VIVA_PEER_ID__
        secret = __PSK__
    }
}
```

Оба id теперь ссылаются ровно на те же placeholder'ы, что и `local.id` /
`remote.id` в секции connections, с комментарием, объясняющим почему.

---

## 4. `local_addrs` больше не берёт public IP автоматически

**Был реальный дефект.** `local_addrs = __CONTABO_PUBLIC_IP__` предполагало,
что public IP назначен интерфейсу. Если VPS за NAT — сокет не забиндится и
демон откажет в соединении.

Разделил один placeholder на два, потому что это две разные сущности:

| Placeholder | Что это | Чем заполняется |
|---|---|---|
| `__CONTABO_LOCAL_ADDRS__` | адрес, к которому strongSwan **биндит сокет** | адрес, реально существующий на интерфейсе |
| `__LOCAL_IKE_ID__` | **кем мы представляемся** Viva; Tunnel Source в форме | как правило public IPv4 (`as-seen`) |

Правило записано в шаблоне и в `PLACEHOLDERS.md`, решение принимается по
выводу `bootstrap/00-audit.sh`:

- `as-seen` есть среди `on-interface` → public IP идёт в оба поля;
- `as-seen` нет среди `on-interface` (NAT) → в `local_addrs` идёт адрес
  интерфейса или `%any`, туннель работает через NAT-T (UDP 4500), а public IP
  остаётся только как IKE identity и Tunnel Source.

Автоматической подстановки public IP в `local_addrs` больше нет нигде.
Дополнительно: форму просят подтвердить, что Viva ждёт от нас именно IP как
IKE ID, а не FQDN.

---

## 5. Lifetime semantics — арифметика была неверна в обеих фазах

**Был реальный дефект, оба значения расходились с Viva.**

В swanctl:
- hard lifetime IKE SA = `rekey_time` + `over_time`;
- hard lifetime CHILD SA = `life_time` (`over_time` к детям не применяется).

| | Требование Viva | Было | Фактический hard | Стало |
|---|---|---|---|---|
| IKE SA | 86400 s | `rekey_time 86400s` + `over_time 3600s` | **90000 s** (+1 ч) | `rekey_time 82800s` + `over_time 3600s` = **86400 s** |
| IPsec SA | 3600 s | `rekey_time 3600s`, `life_time 3900s` | **3900 s** (+300 с) | `rekey_time 3240s`, `life_time 3600s` |

Про `rand_time`: по умолчанию он равен `over_time` (IKE) и
`life_time - rekey_time` (CHILD). То есть rekey джиттерится в
[79200 s, 82800 s] и [2880 s, 3240 s] соответственно — это сдвигает rekey
только **раньше** и на hard lifetime не влияет. Оба hard-лимита теперь точно
равны значениям Viva. Вся арифметика записана комментариями прямо в шаблоне,
чтобы её нельзя было «округлить» обратно.

---

## Проверки

| Проверка | Результат |
|---|---|
| `node --test infra/viva-gateway/gateway/viva-gateway.test.mjs` | 21/21 pass |
| `pnpm --filter @tutak/api typecheck` | pass |
| `pnpm --filter @tutak/api lint` | pass |
| `pnpm --filter @tutak/api test:unit -- --testPathPattern sms` | 47/47 pass |
| secret scan по диффу (psk/secret/password/token/api key/private key/IP) | только прозаические упоминания слов «PSK» и «access token» в комментариях; секретов нет |
| `grep 10064` по репозиторию | только новый поясняющий абзац в docs |

Изменены три файла, кода не трогал:
`infra/viva-gateway/strongswan/viva.conf.template`,
`infra/viva-gateway/strongswan/PLACEHOLDERS.md`,
`docs/VIVA_VPN_FORM_RU.md`.

## Статус

Пункты 3, 4, 5 были настоящими ошибками в `7ed6782` — исправлены.
Пункт 1 — нарушения не было, добавлена фиксация правила в документации.
Пункт 2 — исправлено, поле переведено в NEEDS VIVA / NEEDS CONTABO LOCATION.

Шаблон по-прежнему намеренно невалиден: все `__PLACEHOLDER__` ждут ответов
Viva. Production и VPS не тронуты.
