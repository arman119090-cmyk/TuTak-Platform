-- Tracks the two BonusLots a Referral Challenge reward grants (referrer +
-- referee), so a later refund that drops progressAmount back below
-- requiredAmount can claw the reward back precisely (independent audit,
-- GitHub issue #28).

ALTER TABLE "referral_challenge_participants"
  ADD COLUMN "referrerBonusLotId" TEXT,
  ADD COLUMN "refereeBonusLotId" TEXT;
