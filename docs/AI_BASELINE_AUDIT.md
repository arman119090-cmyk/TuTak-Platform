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
    (`kimi-k2-0905-preview`);
  - DeepSeek: secret `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`
    (`https://api.deepseek.com`), `DEEPSEEK_MODEL` (`deepseek-chat`).
- `scripts/ai-review.mjs` — один sticky-комментарий на PR на модель
  (маркер `<!-- ai-review:<provider> -->`, обновляется, не плодится).
  Системный промпт нацелен на деньги: баланс двойной записи, идемпотентность,
  гонки, maker/checker, tenant isolation, авторизация на write-маршрутах;
  шкала P0/P1/P2/NIT; «не хвалить».
- Без ключа скрипт печатает `BLOCKED_BY_API_KEY` и завершается с кодом 0 —
  проверено локально (`AI_REVIEW_PROVIDER=kimi node scripts/ai-review.mjs /dev/null`).
  Job **никогда не валит CI**: это совет, не approve (`AGENTS.md` §4).
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
