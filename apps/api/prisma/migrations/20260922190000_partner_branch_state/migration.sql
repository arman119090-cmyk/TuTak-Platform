-- Why a branch is shut, not only whether it is.
--
-- `isActive` answers the question every read in this codebase actually asks
-- — may a purchase be taken here right now — and it keeps answering it. What
-- it cannot say is which of two different things happened, and the two need
-- different screens and different rules:
--
--   SUSPENDED  closed for refurbishment, a holiday, a dispute. It comes back,
--              and the owner reopens it themselves.
--   ARCHIVED   gone. Everything suspension allows, minus reopening in one
--              click, and it drops out of the ordinary branch list rather
--              than sitting in it forever.
--
-- Both stop new purchases and neither touches history: returns, disputes and
-- statements go on working, because a location closing is not a reason to
-- strand the customer who bought something there last week.
--
-- Additive. The column is backfilled from `isActive`, which is the only
-- honest reading of the rows that exist: a branch that is off today was
-- switched off, and nothing recorded whether that was meant to be permanent.
-- Calling all of them SUSPENDED says "shut, may come back" — true of every
-- one of them, and the owner can archive the ones that are really gone.

CREATE TYPE "PartnerBranchState" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');

ALTER TABLE "partner_branches"
    ADD COLUMN "state" "PartnerBranchState" NOT NULL DEFAULT 'ACTIVE',
    -- Who shut or reopened it, and when. Null on a branch that has only ever
    -- been open: inventing a timestamp for "has always been fine" would put a
    -- date on an event that never happened.
    ADD COLUMN "stateChangedAt" TIMESTAMP(3),
    ADD COLUMN "stateChangedByUserId" TEXT;

UPDATE "partner_branches" SET "state" = 'SUSPENDED' WHERE "isActive" = false;

-- The two columns are one fact written twice, so the database keeps them in
-- step rather than trusting every present and future writer to remember.
-- Without this, a branch could read as archived and still take purchases —
-- the exact state the archive exists to prevent, arrived at by a single
-- forgetful UPDATE.
ALTER TABLE "partner_branches" ADD CONSTRAINT "partner_branches_state_matches_is_active"
  CHECK ("isActive" = ("state" = 'ACTIVE'));

-- The owner's branch list hides archived rows by default, and the purchase
-- path asks for open ones. Both are per-partner reads.
CREATE INDEX "partner_branches_partnerId_state_idx"
    ON "partner_branches"("partnerId", "state");
