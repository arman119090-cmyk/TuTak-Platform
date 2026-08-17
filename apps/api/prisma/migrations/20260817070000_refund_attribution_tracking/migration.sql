-- Traceability for two refund-attribution gaps (independent audit, GitHub
-- issue #28): a purchase's turnover contribution to *other* deferred bonus
-- lots, and a purchase's contribution to a Referral Challenge participant's
-- progress. Both previously had no record of which purchase contributed how
-- much, so a refund of that purchase could not reverse either effect.

CREATE TABLE "deferred_bonus_lot_contributions" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "sourceTransactionId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "reversedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deferred_bonus_lot_contributions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "deferred_bonus_lot_contributions_lotId_sourceTransactionId_key"
    ON "deferred_bonus_lot_contributions"("lotId", "sourceTransactionId");

CREATE INDEX "deferred_bonus_lot_contributions_sourceTransactionId_idx"
    ON "deferred_bonus_lot_contributions"("sourceTransactionId");

ALTER TABLE "deferred_bonus_lot_contributions"
    ADD CONSTRAINT "deferred_bonus_lot_contributions_lotId_fkey"
    FOREIGN KEY ("lotId") REFERENCES "deferred_bonus_lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "deferred_bonus_lot_contributions"
    ADD CONSTRAINT "deferred_bonus_lot_contributions_amounts_sane"
    CHECK ("amount" > 0 AND "reversedAmount" >= 0 AND "reversedAmount" <= "amount");

CREATE TABLE "referral_challenge_contributions" (
    "id" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "reversedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_challenge_contributions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "referral_challenge_contributions_transactionId_key"
    ON "referral_challenge_contributions"("transactionId");

ALTER TABLE "referral_challenge_contributions"
    ADD CONSTRAINT "referral_challenge_contributions_participantId_fkey"
    FOREIGN KEY ("participantId") REFERENCES "referral_challenge_participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "referral_challenge_contributions"
    ADD CONSTRAINT "referral_challenge_contributions_amounts_sane"
    CHECK ("amount" > 0 AND "reversedAmount" >= 0 AND "reversedAmount" <= "amount");
