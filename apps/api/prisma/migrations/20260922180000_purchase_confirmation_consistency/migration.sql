-- The confirmation columns describe one of three mutually exclusive events.
-- Until now only TypeScript said so.
--
-- `PurchaseConfirmation` in `purchase-intents.service.ts` is a discriminated
-- union, and every write goes through it — today. A union in application code
-- protects the writer that uses it and nothing else: a backfill, a support
-- fix typed straight into psql, or a second write path added next year can
-- still produce a row claiming a cashier confirmed it while naming an
-- integration key, and nothing would notice until a partner reads a statement
-- that contradicts itself.
--
-- The three shapes, and why each column is where it is:
--
--   STAFF                a person acted, so there is a user and a permanent
--                        employee code. The assignment and role stay optional
--                        — an owner or an all-branch manager confirms without
--                        being posted anywhere.
--   PARTNER_INTEGRATION  the partner's own system acted on its key. No person,
--                        therefore no user, no code, no posting.
--   PROVIDER_CALLBACK    a payment provider reported the money. Nobody at the
--                        partner acted at all.
--
-- NULL source is the fourth shape and the reason this is not a NOT NULL
-- column: every purchase confirmed before these columns existed, and every
-- purchase not yet confirmed. Those must carry no detail either — a row with
-- no recorded source but a recorded employee code would be exactly the
-- half-written state this constraint exists to forbid.
--
-- Satisfied by every existing row by construction: the detail columns were
-- added nullable two migrations ago and no historical row was backfilled.

ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_confirmation_is_consistent"
  CHECK (
    ("confirmationSource" IS NULL
      AND "confirmedByEmployeeCode" IS NULL
      AND "confirmedByAssignmentId" IS NULL
      AND "confirmedByRole" IS NULL
      AND "confirmedByApiKeyId" IS NULL)
    OR ("confirmationSource" = 'STAFF'
      AND "confirmedAt" IS NOT NULL
      AND "confirmedByUserId" IS NOT NULL
      AND "confirmedByEmployeeCode" IS NOT NULL
      AND "confirmedByApiKeyId" IS NULL)
    OR ("confirmationSource" = 'PARTNER_INTEGRATION'
      AND "confirmedAt" IS NOT NULL
      AND "confirmedByApiKeyId" IS NOT NULL
      AND "confirmedByUserId" IS NULL
      AND "confirmedByEmployeeCode" IS NULL
      AND "confirmedByAssignmentId" IS NULL
      AND "confirmedByRole" IS NULL)
    OR ("confirmationSource" = 'PROVIDER_CALLBACK'
      AND "confirmedAt" IS NOT NULL
      AND "confirmedByUserId" IS NULL
      AND "confirmedByEmployeeCode" IS NULL
      AND "confirmedByAssignmentId" IS NULL
      AND "confirmedByRole" IS NULL
      AND "confirmedByApiKeyId" IS NULL)
  );

-- A posting without the role held under it is half an answer: "which branch
-- authorised this" and "as what" are read together on the employee card and
-- in the statement filter, and a row carrying one without the other would
-- make the card show a branch with a blank next to it.
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_confirmation_posting_is_whole"
  CHECK (
    ("confirmedByAssignmentId" IS NULL AND "confirmedByRole" IS NULL)
    OR ("confirmedByAssignmentId" IS NOT NULL AND "confirmedByRole" IS NOT NULL)
  );
