-- Opt-in flag for nearby-partner recommendations ranked by the customer's
-- own purchase history. Nothing new is collected -- the ranking is computed
-- on demand from the existing Transaction table; this is only the consent
-- switch, off by default like every other behavioural-personalisation flag
-- in this schema.

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'PERSONALIZATION_CONSENT_CHANGED';

-- AlterTable
ALTER TABLE "users" ADD COLUMN "personalizedRecommendationsConsent" BOOLEAN NOT NULL DEFAULT false;
