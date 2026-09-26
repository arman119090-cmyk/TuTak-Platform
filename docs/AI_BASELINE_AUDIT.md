# AI baseline audit — Kimi + DeepSeek (26.09.2026)

**Статус: BLOCKED_BY_API_KEY.**

Задача §: «архитектура ревью Kimi + DeepSeek; ключи — в GitHub Secrets, не в
репозитории; если ключей нет — BLOCKED_BY_API_KEY».

## Что сделано

- `.github/workflows/ai-review.yml` — на каждый PR из этого репозитория
  (включая Draft) собирает diff относительно базовой ветки (без lock-файла,
  снапшотов и `docs/`), обрезает до 120 000 символов и отдаёт двум моделям
  через OpenAI-совместимый `/chat/completions`:
  - Kimi (Moonshot): secret `KIMI_API_KEY`, переменные `KIMI_BASE_URL`
    (по умолчанию `https://api.moonshot.ai/v1`), `KIMI_MODEL`
    (`kimi-k3`; до 26.09 — `kimi-k2-0905-preview`: серия kimi-k2 снята с
    обслуживания 25.05.2026, официальная рекомендация миграции — `kimi-k3`);
  - DeepSeek: secret `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`
    (`https://api.deepseek.com`), `DEEPSEEK_MODEL` (`deepseek-chat`).
- `scripts/ai-review.mjs` — один sticky-комментарий на PR на модель
  (маркер `<!-- ai-review:<provider> -->`, обновляется, не плодится).
  Системный промпт нацелен на деньги: баланс двойной записи, идемпотентность,
  гонки, maker/checker, tenant isolation, авторизация на write-маршрутах;
  шкала P0/P1/P2/NIT; «не хвалить».
- Статусы (с 26.09, закрытие «ложного зелёного»): каждый прогон модели
  заканчивается ровно одним из `REVIEW_COMPLETE` / `BLOCKED_BY_API_KEY` /
  `PROVIDER_FAILURE` / `INVALID_RESPONSE` / `NOTHING_TO_REVIEW` / `NOT_RUN`;
  статус пишется в `$GITHUB_STEP_SUMMARY`, в step output `status`, в
  `ai-review-out/<provider>-<mode>.status.json` и в sticky-комментарий PR
  («это не чистое ревью»). Шаг модели сам никогда не падает (чтобы вторая
  модель успела отработать); финальный шаг **Verdict**
  (`node scripts/ai-review.mjs --verdict`) выходит с кодом 1, если не все
  модели `REVIEW_COMPLETE` (исключение — обе `NOTHING_TO_REVIEW`: в diff нет
  кода, docs-only PR). Поэтому job «Kimi + DeepSeek review» GREEN ⇔ обе
  модели реально отревьюили. Job **не является required check** и не должен
  им становиться без ключей — иначе заблокирует все PR. Ответ модели не в
  форме JSON-массива объектов → `INVALID_RESPONSE` (raw сохраняется), а не
  «0 замечаний».
- Тесты `scripts/ai-review.test.mjs` (`node --test`, fetch подменён, платные
  API не вызываются; выполняются первым шагом workflow): нет ключа Kimi; нет
  ключа DeepSeek; нет обоих; таймаут провайдера (реальный AbortController) и
  HTTP 500/503/401; невалидный JSON; Kimi success + DeepSeek failure; обе
  success (+ sticky-комментарии); пустой diff; отсутствующий status-файл;
  нормализация findings. 12 тестов.
- Вывод — JSON по схеме `FINDING_SCHEMA` в `scripts/ai-review.mjs`
  (`severity P0–P3, category, file, line, finding, evidence, suggestedFix,
  confidence`), сохраняется артефактом (`ai-review-out/<provider>-<mode>.json`,
  90 дней) и рендерится таблицей в комментарии. Лимиты: вход 120 000 символов,
  выход 4 000 токенов, таймаут 180 с, 2 повтора (repository variables
  `AI_REVIEW_*`).
- Еженедельный полный аудит (понедельник 04:23 UTC, и `workflow_dispatch`):
  13 денежных модулей (`ledger`, `partner-settlements`, `payouts`,
  `purchase-intents`, `partner-orders`, `commission-distribution`, `wallet`,
  `referral`, `payments`, `psp`, `auth`, `security`, `prisma/migrations`),
  обе модели независимо, артефакты на прогон. Первый прогон на PR #71 без
  ключей: job «Kimi + DeepSeek review» отработал (12 с) со статусом BLOCKED.
- Форки не получают секретов: `if: head.repo.full_name == github.repository`.

## Что НЕ сделано и почему

- Собственно baseline-аудит кода второй/третьей моделью **не проведён**: в
  GitHub Secrets нет `KIMI_API_KEY` и `DEEPSEEK_API_KEY` (проверить список
  секретов из этой среды нельзя — API 403 через прокси; workflow ещё не
  выполнялся, потому что добавлен в этой ветке). Первое реальное ревью
  появится на PR #71 после того, как владелец добавит ключи и workflow
  сработает на следующем push.
- Имена моделей/эндпоинтов — значения по умолчанию из публичной документации
  провайдеров на дату написания; если провайдер переименует модель, менять
  через repository variables, не через код.

## Owner action

1. GitHub → Settings → Secrets and variables → Actions → New repository secret:
   `KIMI_API_KEY`, `DEEPSEEK_API_KEY` (платные аккаунты провайдеров).
2. Опционально — Variables: `KIMI_MODEL`, `DEEPSEEK_MODEL`, `*_BASE_URL`.
3. Любой push в открытый PR запустит job «Kimi + DeepSeek review»; результат —
   два комментария в PR. Замечания моделей проверяются агентом/человеком до
   попадания в отчёт как факт.

## Ограничения архитектуры (честно)

- Diff, а не весь репозиторий: модель не видит контекста за пределами
  изменённых строк. Для baseline всего кода нужен отдельный одноразовый прогон
  по модулям (скрипт можно вызвать с `git diff <empty-tree>..HEAD -- apps/api/src/modules/<m>`),
  тоже BLOCKED_BY_API_KEY.
- Код PR уходит третьей стороне (Moonshot, DeepSeek). Репозиторий публичный,
  секретов в коде нет — утечки нет; но если репозиторий станет приватным,
  владелец должен принять это решение отдельно.
