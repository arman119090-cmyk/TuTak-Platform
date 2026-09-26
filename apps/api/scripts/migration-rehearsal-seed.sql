-- Rows of the shapes this branch's migrations actually touch.
--
-- Not a fixture for tests: a deliberate reconstruction of what a production
-- database looks like on the morning of the deploy, including the awkward
-- cases. Every INSERT here exists because some migration in this branch
-- reads, rewrites or constrains rows like it.

-- ── People and businesses ───────────────────────────────────────────────
INSERT INTO users (id, phone, "passwordHash", "firstName", "lastName", "updatedAt") VALUES
  ('u-customer-1', '+37411000001', 'x', 'Ани',  'Петросян', now()),
  ('u-customer-2', '+37411000002', 'x', 'Тигран', 'Саргсян', now()),
  ('u-cashier',    '+37411000003', 'x', 'Кассир', 'Смена',   now()),
  ('u-finance-a',  '+37411000004', 'x', 'Финанс', 'Первый',  now()),
  ('u-finance-b',  '+37411000005', 'x', 'Финанс', 'Второй',  now());

INSERT INTO partners (id, "legalName", "displayName", "taxId", category, "bonusAccrualRateBps", "updatedAt") VALUES
  ('p-haze',  'ХЭЙЗ ООО',     'HAZE',     'tax-haze',  'fuel',   300, now()),
  ('p-cafe',  'Кафе ООО',     'Кафе',     'tax-cafe',  'food',   500, now());

-- ── Purchases, including two live ones for the same pair ────────────────
--
-- The awkward case the preflight exists for: before this branch there was no
-- index stopping a customer having two unfinished purchases at one business,
-- so a real database may well contain them.
INSERT INTO purchase_intents
  (id, "customerId", "partnerId", status, "confirmationCode", "grossAmount",
   "bonusAmountRequested", "ordinaryPaymentRemainder", "negotiatedRateBps",
   "maxBonusPaymentPercent", "expiresAt", "createdAt")
VALUES
  ('pi-live-1',  'u-customer-1', 'p-cafe', 'AWAITING_CONFIRMATION', '1001', 5000, 0, 5000, 500, 100, now() + interval '3 min', now()),
  ('pi-live-2',  'u-customer-1', 'p-cafe', 'AWAITING_CONFIRMATION', '1002', 7000, 0, 7000, 500, 100, now() + interval '3 min', now()),
  -- An ordinary settled purchase, to prove the back-fill describes history
  -- truthfully rather than marking everything unapproved.
  ('pi-done-1',  'u-customer-2', 'p-cafe', 'CONFIRMED',             '1003', 9000, 0, 9000, 500, 100, now() - interval '2 day', now() - interval '2 day'),
  ('pi-expired', 'u-customer-2', 'p-haze', 'EXPIRED',               '1004', 3000, 0, 3000, 300, 100, now() - interval '1 day', now() - interval '1 day');

UPDATE purchase_intents
   SET "confirmedByUserId" = 'u-cashier', "confirmedAt" = now() - interval '2 day',
       "poolAmount" = 450, "greenAmount" = 90, "deferredAmount" = 135, "tutakAmount" = 225,
       "programVersion" = 'THREE_LEVEL_V2'
 WHERE id = 'pi-done-1';

-- ── No legacy settlements, and that is the finding ──────────────────────
--
-- `partner_settlements` and `partner_bank_accounts` do not exist on
-- `origin/main`: the whole settlement engine arrives with this branch. So
-- there is nothing to seed and nothing that can be damaged — worth recording
-- here rather than discovering during a deploy, because it means the
-- settlement migrations carry no data risk at all, and the risk is
-- concentrated in the three that touch `purchase_intents` and
-- `partner_contribution_rules`.

-- ── Legacy card payments and a refund ───────────────────────────────────
--
-- §13 asks for a DIRECT refund regression check; these are the rows that
-- path reads, and they must survive untouched.
INSERT INTO payments (id, "userId", "partnerId", amount, "commissionAmount", status, "pspReference", "idempotencyKey")
  VALUES ('pay-legacy', 'u-customer-2', 'p-cafe', 9000, 450, 'CAPTURED', 'demo-1', 'key-legacy');

INSERT INTO refunds (id, "paymentId", amount, reason, "actorId", "idempotencyKey")
  VALUES ('rf-legacy', 'pay-legacy', 1000, 'Legacy partial refund', 'u-finance-a', 'key-refund-legacy');
