-- Launch-readiness audit finding: `referral_codes`' "exactly one of userId/
-- partnerId" and `referral_invites`' "exactly one of referrerUserId/
-- referrerPartnerId, matching referrerType" invariants (both documented in
-- schema.prisma comments) were app-only — every current call site only ever
-- creates a row with a single owner field set, so this is not exploitable
-- today, but nothing in the database prevented a future write path from
-- setting both. `ledger_accounts` already carries the identical shape of
-- constraint for the same "exactly one owner" idea
-- (ledger_accounts_single_owner, 20260807000000_double_entry_ledger) —
-- same rule, same tables' actual owner columns.

ALTER TABLE "referral_codes"
  DROP CONSTRAINT IF EXISTS "referral_codes_single_owner",
  ADD CONSTRAINT "referral_codes_single_owner" CHECK (
    NOT ("userId" IS NOT NULL AND "partnerId" IS NOT NULL)
  );

ALTER TABLE "referral_invites"
  DROP CONSTRAINT IF EXISTS "referral_invites_single_referrer",
  ADD CONSTRAINT "referral_invites_single_referrer" CHECK (
    NOT ("referrerUserId" IS NOT NULL AND "referrerPartnerId" IS NOT NULL)
  );
