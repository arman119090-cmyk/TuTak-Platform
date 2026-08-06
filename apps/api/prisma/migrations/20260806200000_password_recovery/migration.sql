-- Password recovery and forced rotation.
--
-- Background: docs/AUDIT_2026-08-B.md §C2 (a committed super-admin password
-- that no product path could rotate) and §C3 (no change-password, no reset,
-- no recovery of any kind — a customer who forgot their password lost their
-- balance permanently).

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "passwordChangedAt" TIMESTAMP(3);

-- Only the hash of a reset code is stored, on the same reasoning as refresh
-- tokens: a database dump must not yield a working reset for every request
-- that happens to be open.
CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
  "id"         TEXT NOT NULL,
  "userId"     TEXT NOT NULL,
  "codeHash"   TEXT NOT NULL,
  "expiresAt"  TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "attempts"   INTEGER NOT NULL DEFAULT 0,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "password_reset_tokens_userId_consumedAt_idx"
  ON "password_reset_tokens"("userId", "consumedAt");
CREATE INDEX IF NOT EXISTS "password_reset_tokens_expiresAt_idx"
  ON "password_reset_tokens"("expiresAt");

ALTER TABLE "password_reset_tokens"
  DROP CONSTRAINT IF EXISTS "password_reset_tokens_userId_fkey";
ALTER TABLE "password_reset_tokens"
  ADD CONSTRAINT "password_reset_tokens_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Attempts are bounded in code; the constraint makes a bypass unrepresentable.
ALTER TABLE "password_reset_tokens"
  DROP CONSTRAINT IF EXISTS "password_reset_attempts_non_negative";
ALTER TABLE "password_reset_tokens"
  ADD CONSTRAINT "password_reset_attempts_non_negative" CHECK ("attempts" >= 0);
