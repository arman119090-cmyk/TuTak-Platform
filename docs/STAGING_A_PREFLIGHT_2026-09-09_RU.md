# Этап A — проверки до действия, состояние отката и граница доступа

**Дата:** 9 сентября 2026
**Разрешено:** развернуть `5c28b95` на `tutak-staging-api`, без merge.
**Статус: не развёрнуто.** Одно действие мне недоступно — см. раздел 5.

---

## 1. Полный SHA и фактический diff относительно живого деплоя

| | |
| --- | --- |
| Разрешённый коммит | `5c28b95bb05582d835f235093cd838280c8b92bd` |
| Живой сейчас | `f63b34fbaa687b571eb24dc394f2192929cb64fb` (деплой `dep-daddj80ae00c73dqknag`) |

Полный diff `f63b34f → 5c28b95` — **шесть файлов, все в `apps/api/src/`**:

```
apps/api/src/common/utils/phone-mask.ts             +26   новый
apps/api/src/common/utils/phone-mask.spec.ts        +29   новый, тест
apps/api/src/main.ts                                +38/-1
apps/api/src/modules/auth/auth-otp.service.ts       +22/-6
apps/api/src/modules/auth/auth.service.ts           +54/-6
apps/api/src/modules/auth/auth-otp-logging.spec.ts  +125  тест
                                                    6 файлов, +281 / −13
```

Содержательная часть `auth.service.ts` — вся, без сокращений:

```
+  private logOtpOutcome(flow: 'register' | 'login', outcome: string): void {
+    this.logger.log(`otp ${flow}: ${outcome}`);
+  }

-    if (!existing) {                                     регистрация
-      await this.authOtpService.requestCode(…).catch(…);
+    if (existing) {
+      this.logOtpOutcome('register', 'skipped-number-already-registered');
+    } else {
+      const issued = await this.authOtpService.requestCode(…).catch(… return { delivered: false });
+      this.logOtpOutcome('register', issued.delivered ? 'code-handed-to-carrier' : 'carrier-refused');

-    if (user && user.isActive && !user.deletedAt) {      вход по коду
-      await this.authOtpService.requestCode(…).catch(…);
+    if (!user || !user.isActive || user.deletedAt) {
+      this.logOtpOutcome('login', 'skipped-no-eligible-account');
+    } else {
+      const issued = await this.authOtpService.requestCode(…).catch(… return { delivered: false });
+      this.logOtpOutcome('login', issued.delivered ? 'code-handed-to-carrier' : 'carrier-refused');
```

Условия не изменены по существу — переставлены местами ветки `if`/`else`, чтобы
в каждой можно было записать результат. Ответ клиенту (`success: true`) не
тронут ни в одной ветке.

## 2. Миграций и изменений SMS-конфигурации нет — проверено

| проверка | команда | результат |
| --- | --- | --- |
| Миграции БД | `git diff --name-only f63b34f 5c28b95 -- apps/api/prisma/` | **пусто** |
| Выбор транспорта и конфигурация SMS | `… -- apps/api/src/infrastructure/sms/ apps/api/src/config/ render.yaml` | **пусто** |
| Что-либо вне `apps/api/src/` | `git diff --name-only … \| grep -v '^apps/api/src/'` | **пусто** |

Провайдер Viva, `selectSmsTransport`, `configuration.ts` и `render.yaml` в этом
коммите **не участвуют**. Транспорт останется `unavailable`. Переменные
окружения менять не нужно ни одной.

## 3. Состояние для отката — зафиксировано

Снято с `tutak-staging-api` (`srv-daa8catg1s2s73cf1340`) до любых действий:

| параметр | текущее значение |
| --- | --- |
| Branch | `claude/tutak-loyalty-mvp-e485jm` |
| Auto-Deploy | `yes`, trigger `commit` |
| Живой деплой | `dep-daddj80ae00c73dqknag` |
| Коммит живого деплоя | `f63b34fbaa687b571eb24dc394f2192929cb64fb` |
| Plan / регион | free / oregon |
| Health check | `/health` |

**Откат — два равнозначных пути:**
1. Settings → Build & Deploy → Branch → вернуть `claude/tutak-loyalty-mvp-e485jm`
   → Save → Manual Deploy → Deploy latest commit.
2. Deploys → найти `dep-daddj80ae00c73dqknag` → Rollback.

Миграций нет, поэтому откат чистый: состояние БД не меняется ни вперёд, ни назад.

## 4. Важно: голова ветки уже не равна разрешённому коммиту

Разрешён `5c28b95`. Голова `claude/staging-sms-observability-20260909` за это
время ушла на `f918666` — там два коммита **только с документами**:

```
CLAUDE.md                                        3 строки
docs/STAGING_SMS_PLAN_CORRECTED_2026-09-09_RU.md 200 строк
```

Кода в них нет, но SHA деплоя был бы другим, чем разрешённый. Поэтому создана
**неизменяемая ветка-указатель ровно на разрешённый коммит**:

```
deploy/staging-api-5c28b95  →  5c28b95bb05582d835f235093cd838280c8b92bd
```

В неё ничего не будет дописываться. Разворачивать нужно **её**, тогда
фактический SHA деплоя совпадёт с разрешённым буква в букву.

## 5. Граница доступа: одно действие мне недоступно

**Я не могу переключить ветку сервиса.** Render MCP этой сессии даёт
`get_service`, `list_services`, `list_deploys`, `list_logs`, `get_metrics`,
`update_environment_variables`, `trigger_deploy` и создание новых сервисов —
**инструмента изменения ветки существующего сервиса среди них нет.**
`trigger_deploy` пересобрал бы текущую ветку, то есть тот же живой `f63b34f`, —
это не то, что разрешено.

**Нужно ровно одно действие с вашей стороны:**

> Render → `tutak-staging-api` → Settings → Build & Deploy → **Branch** →
> `deploy/staging-api-5c28b95` → Save

Auto-Deploy трогать не нужно: он `yes`, и сохранение ветки запустит сборку само.
Если не запустится — Manual Deploy → Deploy latest commit.

Admin, partner, production и базовая ветка при этом не затрагиваются: меняется
настройка одного сервиса, merge не выполняется.

## 6. Что я проверю сразу после деплоя

| проверка | как | ограничение |
| --- | --- | --- |
| Фактический SHA | `list_deploys` — сверю с `5c28b95bb055…` | нет |
| Здоровье API | `GET /health` | первый запрос после простоя может ждать холодного старта до минуты |
| Строка транспорта | в журнале при старте ожидается `[SMS] SMS transport: unavailable — …` уровня error | нет |
| Исчезновение ложной строки баннера | `SMS codes are written to this log` не должно появиться | нет |
| Запись результата OTP, регистрация | один `POST /v1/auth/register/request-otp` с **вымышленным** номером → ожидаю `otp register: carrier-refused` | СМС не уйдёт: транспорт отклоняет отправку до сети. Тратится 1 единица глобального бюджета (из 500/час) и создаётся одна строка OTP в БД |
| Запись результата OTP, вход по коду | один `POST /v1/auth/login/request-otp` с тем же вымышленным номером → ожидаю `otp login: skipped-no-eligible-account` | то же; это и есть та строка, которой не хватало 9 сентября |
| Маскирование номера | в строке `Could not deliver OTP to …` номер должен быть замаскирован | нет |

**Реальная СМС при этом невозможна** — транспорт `unavailable` отклоняет
отправку до всякой сети. **Персональные данные не задействованы**: номер
вымышленный, он не принадлежит никому из тестировщиков, и в журнал он попадает
только замаскированным.

**Граница, которую нельзя перейти без ещё одного разрешения:** проверить, что
`code-handed-to-carrier` действительно появляется, невозможно — для этого нужен
живой транспорт, то есть этап B. После этапа A подтверждаются три исхода из
четырёх.

---

## 7. Этап B — сверено, SHA и diff относительно A

**Этап B включает этап A целиком и без изменений.** Проверено диффом по
файлам этапа A между `5c28b95` и головой B:

```
git diff 5c28b95 claude/staging-sms-viva-20260909 -- \
  apps/api/src/main.ts \
  apps/api/src/modules/auth/auth.service.ts \
  apps/api/src/modules/auth/auth-otp.service.ts \
  apps/api/src/common/utils/phone-mask.ts
→ пусто
```

То есть корреляция OTP-запросов, строка транспорта, правка баннера и
маскирование номера в B присутствуют байт в байт.

| | |
| --- | --- |
| SHA головы B | `5e2f690a1005354560bf2ae3a553fa2f32bdd90e` |
| Ветка | `claude/staging-sms-viva-20260909` |

**Diff B относительно A — что добавляется сверх этапа A:**

```
apps/api/.env.example                              +30
apps/api/src/config/configuration.ts               +79/-…   переменные Viva
apps/api/src/config/configuration.spec.ts          +84/-…   тесты
apps/api/src/infrastructure/sms/sms-transport.ts   +40/-…   ветка драйвера viva
apps/api/src/infrastructure/sms/viva-sms.provider.ts     +233/-…
apps/api/src/infrastructure/sms/viva-sms.provider.spec.ts +622/-…
docs/… (4 документа)                               +1042
                                                   10 файлов, +2073 / −57
```

Кода вне SMS-подсистемы и конфигурации в B нет.

**Этап B, изменение секретов и реальную отправку я не выполняю и не готовлю к
выполнению** — жду отдельного разрешения.
