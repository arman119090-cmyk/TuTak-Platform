-- Проверка одной пилотной покупки насквозь: покупка → ledger → бонусы →
-- реферал → возврат → расчёт партнёру. ТОЛЬКО ЧТЕНИЕ. Выполнять в
-- Railway → Postgres → Data/Query (или через railway connect).
--
--   \set pid '<uuid покупки из Admin → Payments/Purchases>'
--
-- В UI Railway без psql: заменить :'pid' на '<uuid>' в кавычках.
--
-- Что считается PASS для DIRECT-покупки без бонусной оплаты
-- (первая пилотная транзакция):
--   §1  status = CONFIRMED, confirmedAt и confirmedByUserId заполнены,
--       paymentRoute = DIRECT_PARTNER, refundedAmount = 0;
--   §2  ровно одна ledger-транзакция с sourceType = 'PurchaseIntent' и
--       sourceId = id покупки; её проводки в сумме дают 0;
--   §3  у покупателя один bonus_lot типа ACCRUAL_PURCHASE с
--       originalAmount = poolAmount (или greenAmount — что начисляет
--       правило партнёра), status PENDING до availableAt, потом AVAILABLE;
--   §4  если покупатель приведён по коду: у реферера один bonus_lot
--       ACCRUAL_REFERRAL и referral_invites.status = REWARDED; иначе —
--       0 строк в §4;
--   §5  0 возвратов; после возврата — строки в purchase_intent_refunds с
--       ledgerTransactionId, и в §2 появится вторая транзакция с reversesId;
--   §6  проводки партнёра ещё не привязаны к расчёту (settlementEntry
--       пуст), пока расчёт не сформирован; после расчёта — привязаны;
--   §7  сумма балансов всех счетов = 0 (глобально, не только эта покупка).

-- §1 Покупка
SELECT id, status, "paymentRoute", "directTender", "grossAmount",
       "bonusAmountRequested", "ordinaryPaymentRemainder", "refundedAmount",
       "poolAmount", "greenAmount", "deferredAmount", "referrerAmount", "tutakAmount",
       "contributionRuleId", "contributionRuleVersion", "contributionRuleKind",
       "customerId", "partnerId", "partnerBranchId",
       "confirmedByUserId", "confirmedAt", "createdAt", "sourceTransactionId"
FROM purchase_intents WHERE id = :'pid';

-- §2 Ledger: транзакции по покупке и их проводки
SELECT t.id AS transaction_id, t."sourceType", t."sourceId", t."reversesId", t."postedAt",
       p.direction, p.amount, a.type AS account_type, a."userId", a."partnerId",
       sum(CASE WHEN p.direction = 'DEBIT' THEN p.amount ELSE -p.amount END)
         OVER (PARTITION BY t.id) AS transaction_delta   -- должно быть 0
FROM ledger_transactions t
JOIN ledger_postings p ON p."transactionId" = t.id
JOIN ledger_accounts a ON a.id = p."accountId"
WHERE (t."sourceType" = 'PurchaseIntent' AND t."sourceId" = :'pid')
   OR t.id IN (SELECT "ledgerTransactionId" FROM purchase_intent_refunds WHERE "purchaseIntentId" = :'pid')
   OR t.id = (SELECT "sourceTransactionId" FROM purchase_intents WHERE id = :'pid')
ORDER BY t."postedAt", t.id, p.direction;

-- §3 Бонусы покупателя по этой покупке
SELECT l.id, l.type, l.status, l."originalAmount", l."remainingAmount",
       l."availableAt", l."expiresAt", l."createdAt"
FROM bonus_lots l
JOIN wallets w ON w.id = l."walletId"
WHERE w."userId" = (SELECT "customerId" FROM purchase_intents WHERE id = :'pid')
  AND (l."sourceTransactionId" = (SELECT "sourceTransactionId" FROM purchase_intents WHERE id = :'pid')
       OR l."createdAt" BETWEEN (SELECT "confirmedAt" - interval '1 minute' FROM purchase_intents WHERE id = :'pid')
                            AND (SELECT "confirmedAt" + interval '1 minute' FROM purchase_intents WHERE id = :'pid'))
ORDER BY l."createdAt";

-- §3b Кошелёк покупателя (сверить с экраном приложения)
SELECT w."availableBonus", w."pendingBonus", w."reservedBonus", w."lifetimeEarned", w."lifetimeSpent"
FROM wallets w WHERE w."userId" = (SELECT "customerId" FROM purchase_intents WHERE id = :'pid');

-- §4 Реферал (если покупатель приведён)
SELECT ri.id, ri."referrerType", ri."referrerUserId", ri."referrerPartnerId", ri.status,
       ri."rewardAmount", ri."qualifiedAt", ri."rewardedAt",
       (SELECT count(*) FROM bonus_lots l JOIN wallets w ON w.id = l."walletId"
         WHERE w."userId" = ri."referrerUserId" AND l.type = 'ACCRUAL_REFERRAL'
           AND l."createdAt" >= (SELECT "confirmedAt" - interval '1 minute' FROM purchase_intents WHERE id = :'pid')) AS referrer_lots_after_purchase
FROM referral_invites ri
WHERE ri."refereeUserId" = (SELECT "customerId" FROM purchase_intents WHERE id = :'pid');

-- §5 Возвраты
SELECT r.id, r.amount, r."bonusRestored", r.reason, r."ledgerTransactionId", r."actorId", r."createdAt"
FROM purchase_intent_refunds r WHERE r."purchaseIntentId" = :'pid' ORDER BY r."createdAt";

-- §6 Привязка проводок партнёра к расчёту
SELECT p.id AS posting_id, a.type AS account_type, p.direction, p.amount,
       e."settlementId", s.status AS settlement_status, s."periodStart", s."periodEnd"
FROM ledger_postings p
JOIN ledger_accounts a ON a.id = p."accountId"
JOIN ledger_transactions t ON t.id = p."transactionId"
LEFT JOIN partner_settlement_entries e ON e."ledgerPostingId" = p.id
LEFT JOIN partner_settlements s ON s.id = e."settlementId"
WHERE t."sourceType" = 'PurchaseIntent' AND t."sourceId" = :'pid'
  AND a."partnerId" IS NOT NULL;

-- §7 Глобальный баланс ledger (то же, что tutak_ledger_imbalance_amd)
SELECT coalesce(sum(balance), 0) AS imbalance_must_be_zero FROM ledger_accounts;
