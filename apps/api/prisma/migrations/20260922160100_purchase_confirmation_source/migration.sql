-- Who or what confirmed a purchase, recorded rather than inferred.
--
-- Three different events move a purchase to CONFIRMED, and a partner reading
-- a statement has to be able to tell them apart:
--
--   * a cashier at a till, from their own authenticated session;
--   * the partner's own POS/API integration, acting on its key;
--   * a payment provider reporting that it collected the money.
--
-- Only the third is evidence that money reached TuTak. Before this migration
-- the three were distinguishable only by inference — `confirmedByUserId` null
-- plus `paymentRoute = TUTAK_PSP` meant "the provider did it" — and that
-- inference collides with the rows that predate every one of these columns,
-- where null means "nobody recorded it". A partner cannot be asked to tell
-- those two nulls apart, so the source is written down.
--
-- Additive only. Every column is nullable, every existing row keeps NULL, and
-- NULL is read as "not recorded" rather than being attributed to anybody. No
-- historical purchase is given an author it never had.

CREATE TYPE "PurchaseConfirmationSource" AS ENUM ('STAFF', 'PARTNER_INTEGRATION', 'PROVIDER_CALLBACK');

ALTER TABLE "purchase_intents"
    ADD COLUMN "confirmationSource"      "PurchaseConfirmationSource",
    -- The person's permanent code at this partner, frozen on the day. Not a
    -- join on read: `partner_branch_staff_assignments.employeeDisplayCode`
    -- belongs to an assignment, so a transfer would otherwise rewrite what
    -- last month's receipts appear to say.
    ADD COLUMN "confirmedByEmployeeCode" TEXT,
    -- Which branch assignment authorised it, when one did. NULL for an owner
    -- or an all-branch manager: their reach is the role, not a posting.
    ADD COLUMN "confirmedByAssignmentId" TEXT,
    -- The role held at that moment. A promotion must not rewrite who
    -- approved what.
    ADD COLUMN "confirmedByRole"         TEXT,
    -- Which integration key acted, when the source is a partner's own system
    -- rather than a person. Distinct from `merchantApprovedByApiKeyId`, which
    -- records agreeing the *terms* of a sale, not confirming it happened.
    ADD COLUMN "confirmedByApiKeyId"     TEXT;

-- Deliberately no foreign key on `confirmedByAssignmentId` or
-- `confirmedByApiKeyId`.
--
-- These are historical statements about what happened, and a reference that
-- can be nulled or blocked by a later delete is not that. The assignment row
-- is already never deleted (its own docblock says why) and an API key is
-- revoked rather than removed, so the ids stay resolvable in practice — but
-- if one ever does go, the purchase must keep saying what it said rather
-- than quietly losing its author to `ON DELETE SET NULL`.

-- Reading a partner's confirmations by employee, which is what the statement
-- filter does. Partial: rows with no code recorded are the ones this index
-- can say nothing about anyway.
CREATE INDEX "purchase_intents_partnerId_confirmedByEmployeeCode_idx"
    ON "purchase_intents"("partnerId", "confirmedByEmployeeCode")
    WHERE "confirmedByEmployeeCode" IS NOT NULL;
