# Найдено конкретное расхождение: подписывается не тот путь — 10.09.2026

Секрет вы подтвердили как совпадающий (`/proc/<MainPID>/environ` на VPS) —
эта версия действительно не подтверждается, версия отклонена, секрет не
трогал. Разобрал байт-в-байт, что подписывает клиент и что проверяет шлюз.

## Короткий вывод

**Клиент подписывает `/token/get`, а шлюз проверяет подпись по `/v1/token/get`.**
Секрет один и тот же с обеих сторон, но строка, которую хэширует HMAC,
отличается — поэтому подписи не совпадают независимо от секрета. Это баг в
коде `apps/api/src/infrastructure/sms/viva-sms.provider.ts`, не ошибка
конфигурации.

## Доказательство, шаг за шагом

### 1. Что реально уходит по сети (URL)

`viva-sms.provider.ts`, метод `authenticate()`:

```ts
const result = await this.post('/token/get', {
  client_id: this.config.clientId,
  ...
});
```

Метод `post(path, body, ...)`:

```ts
const url = `${this.config.baseUrl}${path}${search ? `?${search}` : ''}`;
```

При `baseUrl = 'https://217.76.49.94/v1'` (то, что я поставил в
`VIVA_API_BASE_URL`) и `path = '/token/get'`:

```
url = 'https://217.76.49.94/v1/token/get'
```

Это верно — именно поэтому запрос вообще дошёл до проверки подписи, а не
получил `404 unknown_endpoint`: список разрешённых путей на шлюзе —

```js
// infra/viva-gateway/gateway/viva-gateway.mjs
export const ALLOWED_PATHS = Object.freeze([
  '/v1/token/get',
  '/v1/token/refresh',
  '/v1/transact/send/batch',
  '/v1/transact/show/progress',
]);
```

`/v1/token/get` в этом списке есть — путь узнан.

### 2. Что реально подписывается (HMAC)

Тот же метод `post()`, чуть ниже:

```ts
...(this.config.gatewaySecret
  ? gatewayAuthHeaders(this.config.gatewaySecret, path, payload)
  : {}),
```

Здесь `path` — это **тот же самый параметр**, что пришёл в `post()`, то есть
буквально `'/token/get'`. Не `url`, не путь из итогового запроса — именно
исходная строка `/token/get`, без `/v1`.

### 3. Что проверяет шлюз

`viva-gateway.mjs`:

```js
const path = (req.url ?? '').split('?')[0];
if (!ALLOWED_PATHS.includes(path)) return send(404, 'unknown_endpoint');
...
const expected = sign(settings.secret, {
  timestamp: String(timestamp),
  nonce: String(nonce),
  method: 'POST',
  path,        // ← это /v1/token/get, из req.url
  body,
});
if (!signatureMatches(expected, String(signature))) return send(401, 'bad_signature');
```

`req.url` для запроса на `https://217.76.49.94/v1/token/get` — это
`/v1/token/get`. Шлюз считает ожидаемую подпись с `path = '/v1/token/get'`.

### 4. Собственно расхождение

| | путь в строке подписи |
|---|---|
| Клиент (Railway) подписал | `/token/get` |
| Шлюз проверяет против | `/v1/token/get` |

Строки для HMAC у клиента и шлюза — разные, значит и подписи разные, **при
любом значении секрета**, пока он не пустой и не совпадает случайно. Это
объясняет `HTTP 401, code=bad_signature` без противоречий: секрет тот же,
подпись — нет.

### 5. Почему это не поймали 22 теста

Оба набора тестов действительно проходят, но каждый проверяет свою половину
изолированно, с путём `/v1/token/get`, а не то, что реально формирует
`post()` на вызове `/token/get`:

Тест клиента (`viva-sms.provider.spec.ts:644`):
```ts
it('emits the three headers the gateway checks, and no secret', () => {
  const headers = gatewayAuthHeaders(SECRET, '/v1/token/get', '{}', ...);
```
— здесь `'/v1/token/get'` передан в `gatewayAuthHeaders` вручную, тестом, а
не тем кодом, что реально вызывает `post('/token/get', ...)`.

Тесты шлюза (`viva-gateway.test.mjs`) — везде `const path = '/v1/token/get'`
тоже задаётся вручную.

Ни один тест не собирает `VivaSmsProvider` с `baseUrl`, оканчивающимся на
`/v1`, и `gatewaySecret` заданным, и не сверяет получившуюся подпись с
`sign()` из настоящего `viva-gateway.mjs`. Разрыв между реальным вызовом
`post('/token/get', ...)` и тем, что тесты подставляют вручную
(`/v1/token/get`), ни разу не был перекрыт тестом — поэтому прошёл
незамеченным.

То же самое расхождение будет и на `transact/send/batch` — тот вызов
устроен идентично (`this.post('/transact/send/batch', ...)`), просто мы до
него ещё не дошли: падает раньше, на `token/get`.

## Что я не делал

- Секрет не менял и не трогал — версия про несовпадение отклонена вашей
  проверкой.
- Код не менял, ничего не деплоил.

## Что дальше — нужно решение

Это правка кода на несколько строк в `viva-sms.provider.ts` (подписывать
не сырой параметр `path`, а фактический путь итогового URL, либо передавать
в `post()` сразу полный путь с `/v1`, а `baseUrl` для режима шлюза держать
без `/v1`). Любой из вариантов ломает либо прямой путь к Viva, либо путь
через шлюз, если сделать небрежно — нужно поправить так, чтобы оба режима
(`baseUrl` с `/api/v1` для прямого Viva и `baseUrl` с `/v1` для шлюза)
подписывали именно тот путь, что действительно уходит на сервер.

Хотите, чтобы я внёс эту правку и открыл PR (без деплоя, до вашего
разрешения на слияние и деплой — как и договаривались)?
