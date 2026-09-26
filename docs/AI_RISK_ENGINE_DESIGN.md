# Антифрод: детерминированные правила пилота и дизайн AI risk engine (не включён)

Дата: 26.09.2026. Ветка `claude/tutak-launch-readiness-20260926`.

## 1. Что работает сейчас (детерминировано, включено)

| Правило | Где | Порог | Действие |
|---|---|---|---|
| Velocity: N транзакций клиента за окно | `FraudDetectionService.checkVelocity` (QR redeem, EV stop, EV CDR) | `FRAUD_VELOCITY_WINDOW_MINUTES` (10), `FRAUD_VELOCITY_MAX_TRANSACTIONS` (8) — **с `adb30a8f` настраиваются без релиза** | платёж держится (400 «held for review»), `FraudSignal VELOCITY_LIMIT_EXCEEDED` MEDIUM, QR-код не расходуется |
| **Пилотные правила на подтверждении покупки** (`PurchaseIntentsService.confirm` → `FraudDetectionService.assessPurchase`): velocity партнёра / филиала / сотрудника за окно; high-value покупка; «новый аккаунт» (возраст < N ч и ≥ M покупок) | `FRAUD_PARTNER_VELOCITY_MAX` (300), `FRAUD_BRANCH_VELOCITY_MAX` (150), `FRAUD_EMPLOYEE_VELOCITY_MAX` (60), `FRAUD_HIGH_VALUE_AMOUNT` (300 000 AMD), `FRAUD_NEW_ACCOUNT_HOURS` (24) + `FRAUD_NEW_ACCOUNT_MAX_PURCHASES` (5), `FRAUD_REWARD_HOLD_HOURS` (72); `0` = правило выключено | **продажа проходит**; зелёная награда клиента начисляется PENDING на `FRAUD_REWARD_HOLD_HOURS` (deferred/рефереры/партнёрская проводка не меняются); `FraudSignal` (VELOCITY_LIMIT_EXCEEDED или BONUS_ABUSE_PATTERN, HIGH при high_value) с `metadata.rules`; AuditLog `PURCHASE_INTENT_CONFIRMED.rewardHold`; **resolve сигнала админом снимает удержание** (лоты становятся due, промоушен-sweep переводит в AVAILABLE). Тест: `fraud-pilot-controls.int-spec.ts` |
| Одна живая покупка на клиента/партнёра | unique index `purchase_intents(customerId, partnerId)` live | — | 400 «already in progress» |
| Self-referral / фарминг | `ReferralService` (+ DB CHECK single owner) | — | отказ, без записи участника |
| Лимит слотов реферальной награды | `REFERRAL_CHALLENGE_SLOT_LIMIT` (3) | — | награда не платится |
| Ручная корректировка бонуса | `BONUS_MANUAL_ADJUSTMENT_MAX` (1 000 000) | — | отказ |
| Глобальный бюджет SMS | `SMS_GLOBAL_MAX_PER_HOUR/DAY` (500/5000) | — | отказ отправки, алерт |
| Rate limit по IP | `RATE_LIMIT_*`, `CLIENT_IP_STRATEGY` | 120/60 с | 429 (только если IP измерен) |
| Блок выплат партнёру | `Partner.payoutsBlockedAt` (reconciliation drift) | — | settlement draft отказан |
| Деактивация партнёра | `Partner.isActive` | — | QR/accrual/EV остановлены |
| **Emergency freeze** | `EMERGENCY_FREEZE=true` | — | 503 на все записи, кроме auth/health/metrics |

Всё это — код, покрытый интеграционными тестами (`partner-state-and-fraud`,
`referral-abuse`, `adversarial-probe`, `emergency-freeze`, `sms-budget`).

## 2. Пороги и что ещё предложить владельцу

Реализованные правила §1 работают с **умеренно широкими значениями по
умолчанию** — они ловят скрипт, а не бойкую субботу. Окончательные
коммерческие пороги — решение владельца (список STOP), меняются переменными
без релиза. Не реализовано (следующая задача Anti-Fraud):

1. Дневной потолок начислений/списаний на клиента.
2. Лимит регистраций с одного IP/устройства в час (нужен измеренный IP).
3. Сигнал на партнёра: доля покупок с бонусом > X% при < Y уникальных
   клиентах за день (кассир гоняет свою карту).
4. Сигнал на реферальную сеть: > N приглашённых с покупкой ровно на порог
   квалификации в первые сутки.
5. Return/dispute abuse: > N возвратов/споров клиента за окно.

Каждое — правило `FraudDetectionService.raise` + пороги из env; действие —
HOLD/сигнал, никогда тихий drop.

## 3. AI risk engine — дизайн (НЕ включается в пилоте)

**Принцип:** модель никогда не двигает деньги. Она только ранжирует; действие
всегда детерминированное правило поверх её оценки, с порогом, который задаёт
владелец, и с полным журналом.

- **Вход:** признаки из существующих таблиц — `transactions`, `fraud_signals`,
  `bonus_ledger_entries`, `referral_invites`, `purchase_intents`, устройства
  (`deviceId` в сессиях). Никаких сырых персональных данных за пределами
  платформы; телефон — хэш.
- **Выход:** `risk_score ∈ [0,1]` + топ-3 причины (правила/признаки), записанные
  в `FraudSignal.metadata` новым типом `RISK_SCORE` (enum расширить миграцией).
- **Где считать:** отдельный worker (BullMQ, как sweeps) — offline, после
  события; **не на hot path** подтверждения покупки. Задержка в минуты
  допустима, потому что действие — HOLD следующей операции / ревью, а не
  отказ текущей.
- **Действия по порогам (owner):** `< 0.6` — ничего; `0.6–0.85` — сигнал в
  админку; `> 0.85` — HOLD бонуса (PENDING) + алерт; **никогда** авто-блок
  аккаунта без человека.
- **Модель на старте:** изотонически калиброванная логистическая регрессия /
  градиентный бустинг на размеченных сигналах (разметка — решения админов по
  `FraudSignal.resolvedAt`). Требует ≥ нескольких тысяч событий → **не раньше
  чем через 2–3 месяца пилота**.
- **Оценка:** precision@HOLD ≥ 0.8, чтобы не держать честных; отчёт
  еженедельно в админку; kill switch `RISK_ENGINE_ENABLED=false`.
- **Что нельзя:** использовать LLM для решения по конкретному клиенту;
  отправлять персональные данные внешнему API; менять экономику сплита.

## 4. Конфликт политики чёрного/отложенного бонуса — OWNER BUSINESS DECISION

Документ `docs/REFERRAL_COMMISSION_MODEL_RU.md` §6: 3 % чёрного баланса
открываются **через 6 месяцев**, при покупках **≥ 15 000 AMD каждый месяц**
все 6 месяцев; пропуск месяца — условие не выполнено.

Код (`configuration.ts:855–856`, `DeferredBonusLotService`): окно
`DEFERRED_BONUS_WINDOW_MONTHS = 3`, условие — **накопленный оборот
`DEFERRED_BONUS_REQUIRED_TURNOVER = 54 000 AMD`** за окно, без помесячной
проверки активности; лот открывается, когда оборот достигнут.

Это разные правила (6 мес × ежемесячно 15 000 ≠ 3 мес × суммарно 54 000).
Пилот сейчас работает по коду. Агент **не меняет** ни документ, ни код:
выбор — за владельцем, после него — миграция параметров (env) или логики
(помесячная проверка требует новой таблицы активности) и обновление
документа. До решения в отчётах пилота это обозначено как известное
расхождение.
