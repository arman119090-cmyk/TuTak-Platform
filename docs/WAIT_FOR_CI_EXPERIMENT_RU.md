# Эксперимент «Wait for CI» — протокол (PR #58 как доказательство)

Дата: 19.09.2026. Состояние до эксперимента: у tutak-api (и, по всей
видимости, admin/partner) `checkSuites: false` — Railway деплоит коммит в
`main` **сразу**, не дожидаясь GitHub CI. Плохой merge попадает в production
раньше, чем CI его увидит.

## Что делает Арман (один раз, 3 сервиса)

Railway → проект TuTak → сервис → **Settings → Source → «Wait for CI»** = on.
Повторить для `tutak-api`, `tutak-admin`, `tutak-partner`. Требование
Railway: workflow с `on: push: branches: [main]` — у `ci.yml` он есть.

## Что делаю я после этого (по шагам, с фиксацией)

1. `get-service-config` для трёх сервисов → в отчёт: `checkSuites: true`
   на всех трёх. Если хотя бы один `false` — стоп, вернуть Арману.
2. Проверить, что head PR #58 зелёный (CI на актуальном SHA, все 5
   check-run success, `mergeable_state: clean`).
3. **Merge PR #58** (squash или merge — по правилам репо, без rewrite
   истории). Записать `T_merge` (UTC, из ответа GitHub) и SHA merge-коммита.
4. Сразу: `list-deployments` tutak-api → ожидание: новый деплой в статусе
   **WAITING** (не BUILDING/DEPLOYING). Записать `T_waiting`.
   - Если статус BUILDING/DEPLOYING до завершения CI → **STOP**: Wait for
     CI не работает; фиксировать статус, время, `checkSuites` ещё раз и
     разбираться (частый случай — тумблер включён не на том сервисе или
     не в production-environment).
5. Следить за CI на merge-коммите в `main` (workflow CI, event push):
   записать `T_ci_green`.
6. `list-deployments` → деплой перешёл WAITING → BUILDING → DEPLOYING →
   **SUCCESS**. Записать `T_success`. Ожидание: `T_waiting < T_ci_green ≤ T_build_start`.
7. Проверка после деплоя (все три сервиса):
   - `get-logs` tutak-api: `prisma migrate deploy` без ошибок, «Nest
     application successfully started», нет баннера DEMO MODE,
     `Alerts will be delivered by …`;
   - `/health/ready` = 200 (через uptime workflow_dispatch — первый прогон
     `Uptime` вручную);
   - `meta.commitHash` последнего SUCCESS-деплоя каждого сервиса =
     merge-коммит.
8. Отрицательный тест (по желанию, позже): PR с намеренно падающим
   unit-тестом → merge в `main` → деплой должен остаться WAITING и стать
   SKIPPED/REMOVED после красного CI; production не меняется. Затем revert.

## Что именно доказываем (causal ordering), и что НЕ считается провалом

По документации Railway («Controlling GitHub Autodeploys», прочитано
19.09.2026): при включённом Wait for CI «new deployments sit in a WAITING
state until every GitHub Actions check suite on the commit has finished;
Railway looks at the conclusion of each workflow run, not at individual
jobs». То есть **объект deployment создаётся сразу** после push — это
нормально. Провал — только если **build/deploy начался** (BUILDING /
DEPLOYING) раньше `T_ci_green`.

Фиксировать шесть отметок:

| Отметка | Откуда |
|---|---|
| `T_merge` | GitHub PR `merged_at` |
| `T_ci_start` | Actions → run на merge-коммите, `run_started_at` |
| `T_ci_finish` | тот же run, `updated_at` при `conclusion=success` |
| `T_deploy_created` | Railway `list-deployments` → `createdAt` (ожидается ≈ `T_merge`, статус WAITING) |
| `T_build_start` | Railway → deployment → build logs, первая строка |
| `T_success` | deployment `status=SUCCESS`, `updatedAt` |

**PASS:** `T_build_start ≥ T_ci_finish` **и** статус до `T_ci_finish` был
`WAITING` (ни BUILDING, ни DEPLOYING). `T_deploy_created < T_ci_finish` —
**допустимо** и ожидаемо.

## Fail-path (что будет при красном CI) — из документации, не проверено на нашем проекте

- Workflow **failed** → deployment **skipped** сразу; production остаётся на
  предыдущем SUCCESS-деплое; ручной cancel не нужен.
- Workflow **cancelled** (например, наш `concurrency` отменил run из-за
  следующего push) → блокирует только если ни один другой workflow на том
  же коммите не прошёл; при одном workflow (`ci.yml`) — deployment будет
  **skipped**, а следующий коммит получит свой run и свой deployment.
- Не завершилось за **2 часа** → skipped.
- **Skipped/neutral** workflow не блокирует.
- Следующий зелёный коммит разблокируется сам: у него собственный
  deployment со своим check suite.
- Пока мы намеренно не ломали `main`, это — документация, а не наблюдение;
  фиксируется как UNVERIFIED до первого реального красного CI на `main`.

## Две разные защиты — не путать

| | Branch protection (GitHub) | Wait for CI (Railway) |
|---|---|---|
| Что не даёт | непроверенному коммиту попасть в `main` (PR + required checks) | коммиту из `main` попасть в production до зелёного CI |
| Где включается | GitHub → Settings → Branches → rule для `main` | Railway → сервис → Settings → Source → Wait for CI (×3 сервиса) |
| Required checks — **фактические имена job из `ci.yml`** | `Lint, test and build`, `Integration tests (1/3)`, `Integration tests (2/3)`, `Integration tests (3/3)`, `Build the container images` | не настраивается: смотрит на conclusion всего workflow run |
| Для limited pilot | желательно | обязательно (это gate) |

## Таблица результата (заполняется в момент эксперимента)

| Шаг | Время UTC | Значение | Вердикт |
|---|---|---|---|
| checkSuites api/admin/partner | | | |
| T_merge, merge SHA | | | |
| T_waiting (статус деплоя сразу после merge) | | | |
| T_ci_green | | | |
| T_success | | | |
| Логи/health/commitHash | | | |

Gate «Deployment ждёт CI» = CLOSED только с заполненной таблицей и
`T_waiting < T_ci_green`.
