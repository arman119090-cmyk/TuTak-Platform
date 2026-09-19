-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  TuTak — проверка одной пилотной покупки насквозь. ТОЛЬКО ЧТЕНИЕ.     ║
-- ║  1. Вписать id покупки в строку PURCHASE_ID ниже (одно место).        ║
-- ║  2. Выполнить целиком (Railway → Postgres → Data/Query, или psql).     ║
-- ║  3. Смотреть ПОСЛЕДНИЙ результат: таблица check / status / value.     ║
-- ║     PASS во всех строках = покупка прошла правильно.                  ║
-- ║     Подробности (§1–§6) — выше, только если что-то FAIL.              ║
-- ╚══════════════════════════════════════════════════════════════════════╝
-- Безопасно при случайном запуске: ни одного INSERT/UPDATE/DELETE, транзакция
-- только на чтение.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '20s';

SET LOCAL tutak.pid = '00000000-0000-0000-0000-000000000000';   -- ← PURCHASE_ID сюда

-- §1 Покупка
SELECT id, status, "paymentRoute", "directTender", "grossAmount", "bonusAmountRequested",
       "ordinaryPaymentRemainder", "refundedAmount", "poolAmount", "greenAmount",
       "deferredAmount", "referrerAmount", "tutakAmount", "contributionRuleVersion",
       "contributionRuleKind", "customerId", "partnerId", "partnerBranchId",
       "confirmedByUserId", "confirmedAt", "createdAt", "sourceTransactionId"
FROM purchase_intents WHERE id = current_setting('tutak.pid');

-- §2 Ledger: транзакции покупки (и её возвратов) с проводками
SELECT t.id AS transaction_id, t."sourceType", t."reversesId", t."postedAt",
       p.direction, p.amount, a.type AS account_type, a."userId", a."partnerId",
       sum(CASE WHEN p.direction = 'DEBIT' THEN p.amount ELSE -p.amount END)
         OVER (PARTITION BY t.id) AS transaction_delta   -- должно быть 0
FROM ledger_transactions t
JOIN ledger_postings p ON p."transactionId" = t.id
JOIN ledger_accounts a ON a.id = p."accountId"
WHERE (t."sourceType" = 'PurchaseIntent' AND t."sourceId" = current_setting('tutak.pid'))
   OR t.id IN (SELECT "ledgerTransactionId" FROM purchase_intent_refunds WHERE "purchaseIntentId" = current_setting('tutak.pid'))
   OR t.id = (SELECT "sourceTransactionId" FROM purchase_intents WHERE id = current_setting('tutak.pid'))
ORDER BY t."postedAt", t.id, p.direction;

-- §3 Бонусы покупателя, начисленные этой покупкой (+ кошелёк)
SELECT l.id, l.type, l.status, l."originalAmount", l."remainingAmount", l."availableAt", l."expiresAt", l."createdAt"
FROM bonus_lots l JOIN wallets w ON w.id = l."walletId"
WHERE w."userId" = (SELECT "customerId" FROM purchase_intents WHERE id = current_setting('tutak.pid'))
  AND (l."sourceTransactionId" = (SELECT "sourceTransactionId" FROM purchase_intents WHERE id = current_setting('tutak.pid'))
       OR l."createdAt" BETWEEN (SELECT "confirmedAt" - interval '1 minute' FROM purchase_intents WHERE id = current_setting('tutak.pid'))
                            AND (SELECT "confirmedAt" + interval '1 minute' FROM purchase_intents WHERE id = current_setting('tutak.pid')))
ORDER BY l."createdAt";
SELECT "availableBonus", "pendingBonus", "reservedBonus", "lifetimeEarned", "lifetimeSpent"
FROM wallets WHERE "userId" = (SELECT "customerId" FROM purchase_intents WHERE id = current_setting('tutak.pid'));

-- §4 Реферал покупателя (если приведён)
SELECT ri.id, ri."referrerType", ri."referrerUserId", ri."referrerPartnerId", ri.status, ri."rewardAmount", ri."qualifiedAt", ri."rewardedAt"
FROM referral_invites ri
WHERE ri."refereeUserId" = (SELECT "customerId" FROM purchase_intents WHERE id = current_setting('tutak.pid'));

-- §5 Возвраты
SELECT r.id, r.amount, r."bonusRestored", r.reason, r."ledgerTransactionId", r."actorId", r."createdAt"
FROM purchase_intent_refunds r WHERE r."purchaseIntentId" = current_setting('tutak.pid') ORDER BY r."createdAt";

-- §6 Проводки партнёра и их привязка к расчёту
SELECT p.id AS posting_id, a.type AS account_type, p.direction, p.amount, e."settlementId", s.status AS settlement_status, s."periodStart", s."periodEnd"
FROM ledger_postings p
JOIN ledger_accounts a ON a.id = p."accountId"
JOIN ledger_transactions t ON t.id = p."transactionId"
LEFT JOIN partner_settlement_entries e ON e."ledgerPostingId" = p.id
LEFT JOIN partner_settlements s ON s.id = e."settlementId"
WHERE t."sourceType" = 'PurchaseIntent' AND t."sourceId" = current_setting('tutak.pid') AND a."partnerId" IS NOT NULL;

-- ══════════════════════════ ИТОГ: смотреть сюда ══════════════════════════
WITH pi AS (SELECT * FROM purchase_intents WHERE id = current_setting('tutak.pid')),
tx AS (
  SELECT t.id, t."reversesId",
         sum(CASE WHEN p.direction = 'DEBIT' THEN p.amount ELSE -p.amount END) AS delta
  FROM ledger_transactions t JOIN ledger_postings p ON p."transactionId" = t.id
  WHERE (t."sourceType" = 'PurchaseIntent' AND t."sourceId" = current_setting('tutak.pid'))
     OR t.id IN (SELECT "ledgerTransactionId" FROM purchase_intent_refunds WHERE "purchaseIntentId" = current_setting('tutak.pid'))
     OR t.id = (SELECT "sourceTransactionId" FROM pi)
  GROUP BY t.id, t."reversesId"
),
lots AS (
  SELECT l.* FROM bonus_lots l JOIN wallets w ON w.id = l."walletId", pi
  WHERE w."userId" = pi."customerId"
    AND (l."sourceTransactionId" = pi."sourceTransactionId"
         OR l."createdAt" BETWEEN pi."confirmedAt" - interval '1 minute' AND pi."confirmedAt" + interval '1 minute')
),
ref AS (SELECT ri.* FROM referral_invites ri, pi WHERE ri."refereeUserId" = pi."customerId"),
refunds AS (SELECT * FROM purchase_intent_refunds WHERE "purchaseIntentId" = current_setting('tutak.pid')),
checks AS (
  SELECT 1 AS n, 'purchase found' AS "check",
         CASE WHEN EXISTS (SELECT 1 FROM pi) THEN 'PASS' ELSE 'FAIL' END AS status,
         coalesce((SELECT id::text FROM pi), 'нет такой покупки — проверьте PURCHASE_ID') AS value
  UNION ALL SELECT 2, 'status = CONFIRMED',
         CASE WHEN (SELECT status FROM pi) = 'CONFIRMED' THEN 'PASS' ELSE 'FAIL' END,
         coalesce((SELECT status::text FROM pi), '-')
  UNION ALL SELECT 3, 'route = DIRECT_PARTNER (пилот без PSP)',
         CASE WHEN (SELECT "paymentRoute" FROM pi) = 'DIRECT_PARTNER' THEN 'PASS' ELSE 'WARN' END,
         coalesce((SELECT "paymentRoute"::text FROM pi), '-')
  UNION ALL SELECT 4, 'confirmed by a cashier, with time',
         CASE WHEN (SELECT "confirmedByUserId" IS NOT NULL AND "confirmedAt" IS NOT NULL FROM pi) THEN 'PASS' ELSE 'FAIL' END,
         coalesce((SELECT "confirmedAt"::text FROM pi), '-')
  UNION ALL SELECT 5, 'pool split snapshot present',
         CASE WHEN (SELECT "poolAmount" IS NOT NULL AND "greenAmount" IS NOT NULL FROM pi) THEN 'PASS' ELSE 'FAIL' END,
         coalesce((SELECT 'pool=' || "poolAmount" || ' green=' || "greenAmount" || ' deferred=' || coalesce("deferredAmount"::text,'-') || ' referrer=' || coalesce("referrerAmount"::text,'-') FROM pi), '-')
  UNION ALL SELECT 6, 'ledger: one original transaction, delta 0',
         CASE WHEN (SELECT count(*) FROM tx WHERE "reversesId" IS NULL) = 1 AND (SELECT coalesce(max(abs(delta)),0) FROM tx) = 0 THEN 'PASS' ELSE 'FAIL' END,
         (SELECT count(*)::text || ' tx, max |delta| = ' || coalesce(max(abs(delta))::text, '0') FROM tx)
  UNION ALL SELECT 7, 'cashback: exactly one ACCRUAL_PURCHASE lot',
         CASE WHEN (SELECT count(*) FROM lots WHERE type = 'ACCRUAL_PURCHASE') = 1 THEN 'PASS' ELSE 'FAIL' END,
         (SELECT count(*)::text || ' lot(s); amounts: ' || coalesce(string_agg("originalAmount"::text, ', '), '-') FROM lots WHERE type = 'ACCRUAL_PURCHASE')
  UNION ALL SELECT 8, 'cashback amount = green share of the split',
         CASE WHEN (SELECT "greenAmount" FROM pi) IS NULL THEN 'WARN'
              WHEN (SELECT coalesce(sum("originalAmount"),0) FROM lots WHERE type = 'ACCRUAL_PURCHASE') = (SELECT "greenAmount" FROM pi) THEN 'PASS'
              ELSE 'CHECK' END,
         'lot ' || (SELECT coalesce(sum("originalAmount"),0)::text FROM lots WHERE type = 'ACCRUAL_PURCHASE') || ' vs greenAmount ' || coalesce((SELECT "greenAmount"::text FROM pi), '-') || ' (CHECK = сверить с правилом партнёра, не обязательно ошибка)'
  UNION ALL SELECT 9, 'referral: invite state matches the reward',
         CASE WHEN NOT EXISTS (SELECT 1 FROM ref) THEN 'PASS'
              WHEN (SELECT status FROM ref LIMIT 1) IN ('REWARDED','QUALIFIED') AND (SELECT "rewardedAt" IS NOT NULL FROM ref LIMIT 1) THEN 'PASS'
              WHEN (SELECT status FROM ref LIMIT 1) = 'PENDING' THEN 'WARN' ELSE 'FAIL' END,
         CASE WHEN NOT EXISTS (SELECT 1 FROM ref) THEN 'no referral (ok)' ELSE (SELECT status::text || ' reward=' || coalesce("rewardAmount"::text,'-') FROM ref LIMIT 1) END
  UNION ALL SELECT 10, 'refunds: within gross; each has a ledger reversal',
         CASE WHEN (SELECT "refundedAmount" > "grossAmount" FROM pi) THEN 'FAIL'
              WHEN (SELECT count(*) FROM refunds WHERE "ledgerTransactionId" IS NULL) > 0 THEN 'FAIL'
              WHEN (SELECT count(*) FROM refunds) <> (SELECT count(*) FROM tx WHERE "reversesId" IS NOT NULL) THEN 'FAIL'
              ELSE 'PASS' END,
         (SELECT count(*)::text FROM refunds) || ' refund(s), refunded ' || coalesce((SELECT "refundedAmount"::text FROM pi), '-') || ' of ' || coalesce((SELECT "grossAmount"::text FROM pi), '-')
  UNION ALL SELECT 11, 'settlement: partner postings not double-claimed',
         CASE WHEN NOT EXISTS (SELECT 1 FROM partner_settlement_entries e JOIN ledger_postings p ON p.id = e."ledgerPostingId"
                    JOIN ledger_transactions t ON t.id = p."transactionId"
                    WHERE t."sourceType" = 'PurchaseIntent' AND t."sourceId" = current_setting('tutak.pid')
                    GROUP BY e."ledgerPostingId" HAVING count(*) > 1) THEN 'PASS' ELSE 'FAIL' END,
         (SELECT count(*)::text || ' partner posting(s) already in a settlement' FROM partner_settlement_entries e JOIN ledger_postings p ON p.id = e."ledgerPostingId"
          JOIN ledger_transactions t ON t.id = p."transactionId" WHERE t."sourceType" = 'PurchaseIntent' AND t."sourceId" = current_setting('tutak.pid'))
  UNION ALL SELECT 12, 'GLOBAL ledger imbalance = 0',
         CASE WHEN (SELECT coalesce(sum(balance),0) FROM ledger_accounts) = 0 THEN 'PASS' ELSE 'FAIL' END,
         (SELECT coalesce(sum(balance),0)::text FROM ledger_accounts) || ' (то же, что tutak_ledger_imbalance_amd)'
)
SELECT n, "check", status, value FROM checks
UNION ALL
SELECT 99, '═ VERDICT ═', CASE WHEN bool_or(status = 'FAIL') THEN 'FAIL' WHEN bool_or(status IN ('WARN','CHECK')) THEN 'PASS WITH NOTES' ELSE 'PASS' END,
       count(*) FILTER (WHERE status = 'PASS')::text || ' PASS, ' || count(*) FILTER (WHERE status IN ('WARN','CHECK'))::text || ' to look at, ' || count(*) FILTER (WHERE status = 'FAIL')::text || ' FAIL'
FROM checks
ORDER BY n;

COMMIT;
