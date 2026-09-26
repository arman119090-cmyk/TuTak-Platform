# TuTak — владение инфраструктурой и доступами

Дата инвентаризации: 26.09.2026 (ветка `claude/tutak-launch-readiness-20260926`).
Источники: Railway MCP (`whoami`, `describe-environment`, `list-variables` — имена
без значений), Render MCP (`list_services`, `list_postgres_instances`), GitHub
API (репозиторий, ruleset), документы в `docs/`. Где владелец/биллинг не виден
из этой среды — так и написано: **NOT VERIFIED**.

Главный вывод: **production TuTak (API, админка, партнёрский кабинет, Postgres,
Redis, медиа-бакет, WAL-архив) живёт в Railway-проекте, принадлежащем аккаунту
разработчика, а не владельцу бизнеса.** Это P0 по владению: потеря доступа к
этому аккаунту, спор или просто пропущенный платёж по карте разработчика — и
владелец бизнеса не может ни восстановить, ни выключить, ни оплатить свою
систему. Всё остальное в этом документе вторично относительно §3.

---

## 1. Реестр активов

| Актив | Где | Текущий владелец (аккаунт) | Админ-доступ | Биллинг | Кто восстанавливает | Риск | Требуемое действие |
|---|---|---|---|---|---|---|---|
| Исходный код `arman119090-cmyk/TuTak-Platform` | GitHub, public | `arman119090-cmyk` (владелец) | владелец; список collaborators — NOT VERIFIED (API 403) | бесплатный план | владелец (клон есть у любого) | средний: репозиторий публичный (решение), 65 веток, чужие проекты в ветках | включить Dependabot alerts / secret scanning; вычистить чужие ветки (§5) |
| GitHub Actions (CI, APK/iOS сборки, `docker-publish`) + secrets (`MAP_TILE_API_KEY`, `EXPO_TOKEN`?, …) | GitHub | владелец | владелец; **имена secrets NOT VERIFIED** (API 403) | бесплатные минуты (public repo) | владелец | средний: секреты сборки живут только здесь | инвентаризировать secrets в Settings → Secrets, записать в этот документ |
| **Railway project «TuTak»** `901cf202-…`, env `production` | Railway, workspace «styop0909's Projects» | **`styop0909` (stepan.grig.2009@gmail.com) — разработчик** | разработчик; доступ владельца — NOT VERIFIED (скорее нет) | **разработчик** (NOT VERIFIED, чей способ оплаты) | сегодня — только разработчик | **P0** | §3: перенос проекта в workspace владельца |
| ├ `tutak-api` (`39cf03f4`) | Railway, sfo, `main`, Dockerfile, healthcheck `/health/ready`, `checkSuites: true` | как проект | как проект | как проект | как проект | P0 (наследует) | — |
| ├ `tutak-admin` (`a34ead5d`), `tutak-partner` (`2af2591c`) | Railway, sfo, `main` | как проект | | | | P0 | — |
| ├ `Postgres` (`34eca4f9`, том `postgres-volume` 5 GB, sfo) — **боевые данные** | Railway | как проект | | | восстановление: WAL из бакета `Postgres-PITR` (учение 19.09 — успешно) | **P0**: данные под чужим аккаунтом | §3; после переноса — повторить учение |
| ├ `Redis` (`a3f7eb92`, том 5 GB) | Railway | как проект | | | пересоздать (сессии/кэш/очереди) | средний | — |
| ├ бакет `tutak-media` (sjc) — логотипы, аватары | Railway bucket | как проект | | | из бакета нет копии — NOT VERIFIED | средний | включить копию/экспорт |
| ├ бакет `Postgres-PITR` (sjc) — WAL-архив | Railway bucket | как проект | | | это и есть механизм восстановления | P0 (наследует) | — |
| ├ `Postgres-restored-20260919-1733` (том **50 GB**) + staged delete `verify-restore-20260919` | Railway | как проект | | **оплачивается впустую** (50 GB) | — | низкий/деньги | OWNER DECISION: удалить (patch destructive — принимать владельцу) |
| Домены `tutak-{api,admin,partner}-production.up.railway.app` | Railway (нет кастомных доменов) | как проект | | | — | средний: адреса зашиты в APK и в `NEXT_PUBLIC_API_BASE_URL`; при переносе проекта адреса **меняются** | купить домен `tutak.am` (или иной), привязать до переноса, перевыпустить APK на домен |
| **Render workspace «Arman's workspace»** `tea-daa70igae00c73a0pg30` | Render | `arman119090@gmail.com` (владелец) | владелец | владелец; всё на free/starter | владелец | низкий для TuTak | §4 |
| ├ `tutak-staging-{api,admin,partner,web}` + `tutak-staging-db` (истекает **2026-09-29**) | Render, oregon, ветка `claude/tutak-loyalty-mvp-e485jm` | владелец | | free | — | средний: stale-код с autoDeploy, чужой БД | OWNER DECISION: удалить или сделать staging на `main` |
| ├ `levani-art`, `elgo-site`, `little-joe-armenia-demo`, `hoviki-mebel`, `hoviki-mebel-demo` | Render, deploy из **TuTak-Platform** веток `claude/*` | владелец | | free/starter | | средний: чужие клиенты зависят от веток в репо TuTak | вынести в отдельные репозитории (§5) |
| Viva SMS (аккаунт оператора, ключ), IPsec-шлюз на Contabo VPS (`infra/viva-gateway`) | Viva + Contabo | NOT VERIFIED (по `VIVA_TUNNEL_RUNBOOK_RU.md` скрипты на VPS выполнял владелец) | | | | высокий: без шлюза нет OTP → нет регистрации/входа | записать логин Contabo, владельца аккаунта Viva, где лежит ключ |
| Telegram-бот алертов (`ALERT_TELEGRAM_BOT_TOKEN`, чат) | Telegram | NOT VERIFIED (кто создал бота) | | | | низкий | записать владельца бота; после деплоя `06d97e6a` — `alert:verify` |
| Expo/EAS аккаунт (подпись Android, `eas.json`) | Expo | NOT VERIFIED | | | | **высокий**: потеря = нельзя обновить установленные APK (C5 от 10.09) | записать владельца, включить 2FA, хранить keystore-бэкап |
| Google Play / App Store аккаунты | — | по `STORE_SUBMISSION.md` ещё не куплены — NOT VERIFIED | | | | — | OWNER |
| Sentry | — | не заведён (DSN нет ни на одном сервисе) | | | | наблюдаемость | OWNER: создать проект, задать DSN |
| MapTiler (ключ карты) | MapTiler → GitHub secret | NOT VERIFIED | | | | средний: карта на резервных тайлах без ключа | подтвердить, что secret задан |
| Idram (PSP) | — | договора нет | | | | BLOCKED_EXTERNAL | письмо из `IDRAM_PROVIDER_CONFIRMATION.md` |
| Юридические тексты (оферта, политика) | `docs/PUBLIC_OFFER_RU.md`, `PRIVACY_POLICY_RU.md` — черновики | владелец | | | | блокер сторов | юрист |

## 2. Что означает «владелец» в этом документе

Владелец бизнеса — Арман (`arman119090-cmyk`, `arman119090@gmail.com` — по
GitHub и Render). Разработчик — `styop0909`. Ничего плохого в том, что
разработчик поднял инфраструктуру, нет; плохо, что **спустя полтора месяца
production-данные и биллинг остаются на его личном аккаунте**, а у владельца
нет подтверждённого способа получить к ним доступ без него.

## 3. Перенос Railway-проекта владельцу — пошагово (OWNER ACTION, P0)

Railway поддерживает перенос проекта между workspace («Transfer project»).
Данные томов и переменные переезжают вместе с проектом; **публичные домены
`*.up.railway.app` сохраняются** при переносе внутри Railway (это утверждение
Railway-документации — до переноса подтвердить в support-чате, потому что от
него зависит, останутся ли работать установленные APK). Порядок:

1. **Владелец** создаёт аккаунт Railway на своей почте и workspace (например
   «TuTak»), привязывает **свою** карту (Hobby/Pro по числу сервисов).
2. **Владелец** приглашает разработчика в свой workspace с ролью Member (не
   Admin), чтобы разработчик мог продолжать деплоить, но не мог удалить проект
   или сменить биллинг.
3. **Разработчик** в текущем проекте: Project Settings → Transfer → выбрать
   workspace владельца. До этого: снять staged patch (или принять — по решению
   владельца), убедиться, что нет незавершённых деплоев.
4. **Владелец** после переноса проверяет в своём workspace: 7 сервисов, 3 тома,
   2 бакета, переменные `tutak-api` на месте (имена — по §4 baseline-документа),
   домены отвечают (`/health/ready` = 200), CI-триггер GitHub → Railway всё ещё
   привязан к репозиторию (Railway GitHub App должен быть установлен на
   аккаунт владельца — переустановить, если деплой с `main` не срабатывает).
5. **Владелец** меняет то, что должен знать только он: `SEED_ADMIN_PASSWORD`
   (и пароль супер-админа в приложении), `JWT_*_SECRET` — **только через
   процедуру ротации с `JWT_ACCESS_SECRET_PREVIOUS`** (иначе разлогинит всех;
   отдельная задача), `ALERT_TELEGRAM_*` — бот владельца.
6. Записать в этот документ дату переноса, workspace, кто Admin/Member.

Если перенос невозможен (Railway откажет, домены не сохранятся) — план Б:
создать новый проект в workspace владельца по `docs/RAILWAY_PRODUCTION_RUNBOOK_RU.md`,
восстановить Postgres из WAL-архива (процедура учения 19.09), переключить
`NEXT_PUBLIC_API_BASE_URL` и **сначала** купить домен, чтобы APK не зависел от
`*.up.railway.app`. Это региональная миграция по сути — см. `REGION_MIGRATION_PLAN.md`,
и её можно совместить с переездом в европейский регион.

**Пока перенос не сделан: минимум** — владелец получает Admin-доступ в
workspace разработчика (Railway → Workspace Settings → Members → Admin), чтобы
хотя бы иметь возможность оплатить/выключить/экспортировать.

## 4. Render — что делать

- `tutak-staging-*`: код 19.09 с ветки `claude/tutak-loyalty-mvp-e485jm`,
  чужая БД, autoDeploy при пуше в эту ветку. БД истекает 29.09 — после этого
  staging-api перестанет стартовать. Решение владельца: (а) удалить 5
  сервисов + БД (рекомендую, если staging делать на Railway вторым environment);
  (б) перевести все на `main` и использовать как staging с
  `APP_ENV=staging` — тогда `render.yaml` уже описывает состав.
- Клиентские сайты — §5.

## 5. Разделение репозитория (клиентские проекты)

Ветки `claude/elgo-construction-site-*`, `claude/eva-mercedes-websites-*`,
`claude/furniture-ecommerce-demo-*`, `claude/little-joe-armenia-ecommerce-*`,
`claude/parts-shop-images-*`, `claude/jako-design`, `claude/new-session-xjpidi`
(levani-art), `claude/new-project-*` содержат чужие проекты поверх полной копии
TuTak; 5 Render-сервисов деплоятся с них. План (OWNER ACTION, без риска для
TuTak):

1. Для каждого сайта: `git subtree split -P <dir> -b <site>-only` → новый
   репозиторий `arman119090-cmyk/<site>` → Render-сервис перенастроить на новый
   репозиторий (Settings → Build & Deploy → Repository).
2. После переключения — удалить ветку из TuTak-Platform.
3. Ветки TuTak `audit/*`, `demo/*`, `codex/*`, старые `claude/*` без открытых
   PR — удалить после подтверждения владельца (список — `git branch -r`).
   Я не удаляю ветки: это destructive и не моё решение.

## 6. Контроль доступа GitHub (рекомендации, OWNER DECISION)

- Ruleset «Protect main» есть: без удаления/force-push, PR обязателен, 5
  проверок. Включить `strict` (ветка должна быть актуальна относительно `main`
  перед merge) и, если появится второй человек, `required_approving_review_count: 1`.
- Включить Dependabot alerts и Secret scanning (Settings → Code security).
- 2FA на аккаунте владельца — NOT VERIFIED; обязательно.
- Секреты только в GitHub Actions secrets (уже так; в репозитории секретов нет).

## 7. Открытые вопросы владельцу

1. Чей способ оплаты стоит в Railway-workspace разработчика? Есть ли у вас туда доступ сегодня?
2. Владелец Expo-аккаунта и keystore? Владелец Telegram-бота? Владелец аккаунта Viva и Contabo VPS?
3. Домен: покупать до переноса Railway (рекомендую) или жить на `*.up.railway.app`?
4. Render staging: удалить или перевести на `main`?
5. Клиентские сайты: выносить сейчас (до публичного запуска TuTak)?
