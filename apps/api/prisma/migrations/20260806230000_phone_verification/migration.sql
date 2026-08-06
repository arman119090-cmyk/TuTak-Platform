-- Phone ownership verification.
--
-- `isPhoneVerified` existed from the first schema and was never set and never
-- checked, so any +374XXXXXXXX string created a funded wallet. Accounts being
-- free is what made every abuse path repeatable at scale.

CREATE TABLE IF NOT EXISTS "phone_verification_tokens" (
  "id"         TEXT NOT NULL,
  "userId"     TEXT NOT NULL,
  "codeHash"   TEXT NOT NULL,
  "expiresAt"  TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "attempts"   INTEGER NOT NULL DEFAULT 0,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "phone_verification_tokens_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "phone_verification_tokens_userId_consumedAt_idx"
  ON "phone_verification_tokens"("userId", "consumedAt");
CREATE INDEX IF NOT EXISTS "phone_verification_tokens_expiresAt_idx"
  ON "phone_verification_tokens"("expiresAt");

ALTER TABLE "phone_verification_tokens"
  DROP CONSTRAINT IF EXISTS "phone_verification_tokens_userId_fkey";
ALTER TABLE "phone_verification_tokens"
  ADD CONSTRAINT "phone_verification_tokens_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "phone_verification_tokens"
  DROP CONSTRAINT IF EXISTS "phone_verification_attempts_non_negative";
ALTER TABLE "phone_verification_tokens"
  ADD CONSTRAINT "phone_verification_attempts_non_negative" CHECK ("attempts" >= 0);

-- Accounts that already exist predate verification. Marking them verified
-- would be a lie; leaving them unverified would lock out every early tester.
-- They are grandfathered explicitly, and the column comment records why.
COMMENT ON COLUMN "users"."isPhoneVerified" IS
  'Set by POST /v1/auth/verify-phone/confirm. Accounts created before the '
  'verification migration were grandfathered as verified.';
UPDATE "users" SET "isPhoneVerified" = true WHERE "createdAt" < NOW();
