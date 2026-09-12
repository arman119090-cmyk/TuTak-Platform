# Исправление внесено и проверено — 10.09.2026

## Итог

Правка готова, протестирована, запушена в отдельную ветку
**`fix/viva-gateway-path-signing`** (от коммита `df1fd99`, на котором сейчас
и держится `deploy/railway-api-df1fd99`). **Не трогал закреплённую ветку
деплоя и ничего не деплоил** — как и договаривались.

## Что изменено

Один файл, суть правки: `apps/api/src/infrastructure/sms/viva-sms.provider.ts`,
метод `post()`. Раньше подписывался сырой параметр `path` (например,
`/token/get`), а не тот путь, что реально получается в итоговом URL.
Теперь подписывается путь, вычисленный из фактического URL:

```diff
     const search = new URLSearchParams(query).toString();
     const url = `${this.config.baseUrl}${path}${search ? `?${search}` : ''}`;
     const payload = JSON.stringify(body);
+    const signedPath = new URL(url).pathname;

     try {
       const response = await fetch(url, {
         ...
           ...(this.config.gatewaySecret
-            ? gatewayAuthHeaders(this.config.gatewaySecret, path, payload)
+            ? gatewayAuthHeaders(this.config.gatewaySecret, signedPath, payload)
             : {}),
```

При `baseUrl = 'https://217.76.49.94/v1'` это даёт `signedPath =
'/v1/token/get'` — то же самое, что шлюз вычисляет из `req.url`. Подписи
совпадут.

## Как проверено

1. Добавлен регрессионный тест в `viva-sms.provider.spec.ts` — собирает
   провайдер точно как в конфигурации шлюза (`baseUrl` с `/v1`,
   `gatewaySecret` задан) и независимо пересчитывает ожидаемую подпись по
   формуле шлюза.
2. **Проверил, что тест реально ловит баг**: временно откатил только правку
   в `.ts` (тест оставил) — тест упал с несовпадением подписи. Вернул
   правку — тест прошёл.
3. Полный прогон: **82/82** теста `viva-sms.provider.spec.ts`,
   **22/22** теста шлюза (`viva-gateway.test.mjs`, отдельный процесс,
   не менялся).
4. `nest build` (после `prisma generate`) — чисто, ошибок типов нет.

## Что дальше — решение за вами

Ветка `fix/viva-gateway-path-signing` готова к использованию, но сама
`deploy/railway-api-df1fd99` (та, что подключена к `tutak-api` в Railway и
описана как неизменяемый указатель) не тронута. Варианты:

1. **Смержить `fix/viva-gateway-path-signing` в `deploy/railway-api-df1fd99`**
   (или переключить источник `tutak-api` в Railway на новую ветку) — после
   этого Railway автоматически соберёт и задеплоит новую версию (сервис уже
   подключён к репозиторию и деплоит на пуш).
2. Сначала посмотреть diff сами, затем сказать, что делать.

Секреты (`SMS_VIVA_GATEWAY_SECRET`, Viva-креды) уже стоят в Railway с
прошлого шага — их трогать не нужно, правка не про них.

Скажите, как поступить — я не буду мержить/деплоить без вашего явного «да».
