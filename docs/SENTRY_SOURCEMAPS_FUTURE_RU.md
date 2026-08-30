# Future task: безопасная загрузка Sentry source maps

Статус: **не реализовано**. Не является частью первого staging deploy.

## Цель

Вернуть source-map upload для `apps/admin` и `apps/partner`, не помещая
`SENTRY_AUTH_TOKEN` ни в репозиторий, ни в Render runtime environment, ни в
финальный Docker image.

## Требования к реализации

1. Сборка выполняется в CI или другом изолированном build environment.
2. Upload credential выдаётся только build job и живёт минимально возможное
   время. Предпочтителен короткоживущий токен/credential; если провайдер не
   поддерживает настоящий ephemeral token, использовать отдельный CI secret
   с минимальными правами и регулярной ротацией.
3. Токен не передаётся в runtime-контейнер и не сохраняется в `render.yaml`,
   Dockerfile `ENV`, `.env*`, workflow source или любом другом файле репозитория.
4. Не полагаться на недоказанное преобразование Render runtime env → Docker
   `ARG`. Build-time secret должен поступать через документированный механизм
   конкретного CI/build-провайдера.
5. Source maps загружаются для точного `GIT_COMMIT_SHA`, совпадающего с
   собираемым commit.
6. После upload финальный runtime image не содержит source maps, upload token
   или иных build secrets.
7. До включения upload `sourcemaps.disable: true` остаётся обязательным.

## Минимальные проверки будущей задачи

- build без token проходит успешно;
- build с CI token загружает artifacts в правильный Sentry project/release;
- поиск token value по финальному image/filesystem даёт 0 совпадений;
- runtime `env` контейнера не содержит `SENTRY_AUTH_TOKEN`;
- `render.yaml` не содержит `SENTRY_AUTH_TOKEN`;
- событие после deploy символизируется до `.ts`/`.tsx` файла и строки;
- токен отозван/ротирован согласно принятой схеме после проверки.

До выполнения этих условий source-map upload считается отключённым и не
должен включаться частично.
