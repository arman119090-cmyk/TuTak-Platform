-- The four digits a customer reads out at the till.
--
-- CHAR(4), not an integer: 0042 and 42 are different codes to a person
-- reading a slip aloud, and an integer column cannot keep the leading zeros
-- that roughly half of all codes need.
ALTER TABLE "purchase_intents" ADD COLUMN "confirmationCode" CHAR(4);

-- Uniqueness is the database's job, not the application's. Scoped to one
-- business and to purchases that are still awaiting a decision: a code
-- returns to the pool the moment its purchase is confirmed, rejected,
-- cancelled or expired, which is what keeps four digits enough.
--
-- Scoped per partner rather than per branch on purpose. A cashier assigned
-- to two branches of the same business would otherwise be able to type a
-- code that matches one live purchase in each, and the lookup would have to
-- choose between them. Per-partner uniqueness makes that ambiguity
-- impossible, and 10,000 codes is far more than one business can have
-- awaiting confirmation inside a three-minute window.
--
-- Same partial-unique-index form as `partner_branch_qr_codes_active_branch_key`
-- and `partner_branch_staff_assignments_active_user_branch_key`.
CREATE UNIQUE INDEX "purchase_intents_active_partner_confirmation_code_key"
ON "purchase_intents" ("partnerId", "confirmationCode")
WHERE "status" = 'AWAITING_CONFIRMATION' AND "confirmationCode" IS NOT NULL;
