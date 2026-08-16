-- Launch-readiness audit finding: `auth_otp_tokens` (added by
-- 20260816120000_auth_otp_tokens) is the only member of the
-- hashed-code/attempts-counted challenge-table family
-- (PhoneVerificationToken, PasswordResetToken, AuthOtpToken) missing the
-- `attempts >= 0` sanity CHECK its siblings both carry
-- (phone_verification_attempts_non_negative,
-- password_reset_attempts_non_negative). Same fix, same shape.

ALTER TABLE "auth_otp_tokens"
  DROP CONSTRAINT IF EXISTS "auth_otp_tokens_attempts_non_negative";
ALTER TABLE "auth_otp_tokens"
  ADD CONSTRAINT "auth_otp_tokens_attempts_non_negative" CHECK ("attempts" >= 0);
