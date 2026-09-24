# Отчёт: установка плагина Figma — 24.09.2026

## 1. Задание

Выполнить команду `claude plugin install figma@claude-plugins-official`.

## 2. База

- Ветка: `claude/figma-plugin-install-yriw4d`
- Коммит: `369eda196581591366fd90efd1ae7a2f20ae5190`

## 3. Что сделано

1. Первая попытка `claude plugin install figma@claude-plugins-official` —
   ошибка: `Plugin "figma" not found in marketplace "claude-plugins-official"`.
2. `claude plugin marketplace update claude-plugins-official` — ошибка:
   маркетплейс не зарегистрирован в контейнере (список маркетплейсов пуст).
3. `claude plugin marketplace add anthropics/claude-plugins-official` —
   маркетплейс склонирован и добавлен (user settings).
4. Повторная установка — успешно:
   `figma@claude-plugins-official`, версия **2.2.120**, scope **user**,
   статус **enabled** (`claude plugin list`).

Плагин подключает HTTP MCP-сервер `https://mcp.figma.com/mcp`
(инструменты get_design_context, get_screenshot, get_variable_defs,
use_figma и др.).

Файлы репозитория не менялись, кроме этого отчёта. Миграций нет.

## 4. Что НЕ сделано

- **MCP-сервер Figma из контейнера недоступен.** Запрос к
  `https://mcp.figma.com/mcp` через прокси: `CONNECT tunnel failed, response 403`.
  Сетевая политика облачного окружения не пропускает хост `mcp.figma.com`.
  Пока домен не разрешён, инструменты плагина работать не будут.
- **Авторизация в Figma (OAuth) не выполнена** — невозможна без доступа к
  хосту и требует входа владельца аккаунта.
- **Установка не переживёт контейнер.** Плагин поставлен в scope `user`
  (`~/.claude`), а контейнер эфемерный. В проектные настройки
  (`.claude/settings.json`) плагин не прописывал — это изменение для всех,
  кто работает с репозиторием, решение за владельцем (см. вопросы).
- Собственные ошибки: первые два шага (install и marketplace update) были
  заведомо обречены — маркетплейс в окружении не был зарегистрирован;
  стоило сразу проверить `claude plugin marketplace list`.

## 5. Чем доказано

- `claude plugin list` → `figma@claude-plugins-official`, Version 2.2.120,
  Scope user, Status enabled.
- `curl -X POST https://mcp.figma.com/mcp` → `CONNECT tunnel failed, response 403`
  (HTTP-код 000).

## 6. UNVERIFIED

- Что MCP-сервер `figma` реально подключается в сессии Claude Code и отдаёт
  инструменты — не проверено (блокирует сеть и отсутствие OAuth).
- Работа скиллов плагина — не проверялась.

## 7. Вопросы владельцу

1. Добавить `mcp.figma.com` (и при необходимости `www.figma.com`,
   `api.figma.com` для OAuth) в разрешённые домены окружения? Делается в
   настройках облачного окружения: меню окружения в заголовке сессии → Edit →
   Network access. Описание уровней доступа:
   https://code.claude.com/docs/en/claude-code-on-the-web
2. Прописать плагин в проектный `.claude/settings.json`
   (`extraKnownMarketplaces` + `enabledPlugins`), чтобы он ставился в каждой
   новой сессии автоматически?
