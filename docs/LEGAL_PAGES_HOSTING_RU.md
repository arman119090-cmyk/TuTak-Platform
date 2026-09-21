# Юридические страницы — где живут и как включаются

Дата: 19.09.2026.

## Проблема, которая была

`public/privacy.html` и `public/account-deletion.html` лежали в корне репо и
**никем не раздавались**: ни один сервис их не копировал и не отдавал.
Панели ссылались на `https://tutak.am/privacy`, которого нет; в мобильном
приложении ссылки на политику не было вовсе. Магазины требуют URL,
отвечающий без установки приложения.

## Что сделано

| Что | Где |
|---|---|
| Страницы перенесены | `apps/api/public/legal/privacy.html`, `apps/api/public/legal/account-deletion.html` (копируются в образ API) |
| Раздача | API, `GET /legal/privacy`, `GET /legal/account-deletion` (version-neutral, без `/v1`, без авторизации), собственный узкий CSP, `Cache-Control: public, max-age=300` |
| Выключатель | `LEGAL_PAGES_ENABLED=true` на tutak-api. Пока не задан — **404** («not published yet»). Тексты с плейсхолдерами наружу не публикуются |
| Панели | `NEXT_PUBLIC_PRIVACY_URL` (уже было; ссылка появляется только если задано) |
| Мобильное приложение | `LEGAL_BASE_URL` при сборке → `extra.legalBaseUrl` → строка «Политика конфиденциальности» в Настройках (скрыта, пока не задано) |

## Канонические адреса

Сейчас (без собственного домена):

- `https://tutak-api-production.up.railway.app/legal/privacy`
- `https://tutak-api-production.up.railway.app/legal/account-deletion`

Когда появится домен (например `tutak.am`): привязать его к **tutak-api**
как custom domain в Railway (или к отдельному поддомену `api.tutak.am`), и
те же пути станут `https://<домен>/legal/privacy`. Менять придётся только
три значения: `NEXT_PUBLIC_PRIVACY_URL` (admin, partner), `LEGAL_BASE_URL`
(mobile, пересборка) и URL в карточках магазинов.

## Порядок включения (после юриста)

1. Юрист утверждает тексты; заменить плейсхолдеры `[CONTACT EMAIL]`,
   `[OPERATOR]`, `[ADDRESS]` в двух HTML (PR).
2. tutak-api → Variables → `LEGAL_PAGES_ENABLED=true` → redeploy.
3. Проверить: `curl -I https://tutak-api-production.up.railway.app/legal/privacy` → 200, `text/html`.
4. tutak-admin и tutak-partner → `NEXT_PUBLIC_PRIVACY_URL=https://tutak-api-production.up.railway.app/legal/privacy` → redeploy (переменная build-time).
5. Следующая сборка APK — с `LEGAL_BASE_URL=https://tutak-api-production.up.railway.app/legal`.
6. Те же два URL — в Google Play Data safety / App Store Privacy Policy URL.

До шага 1 состояние: **технически готово, не опубликовано**.
