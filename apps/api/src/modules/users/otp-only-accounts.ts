import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Accounts whose password their owner has never known.
 *
 * OTP-first registration used to create the account with
 * `argon2.hash(randomBytes(32))`: the customer proved the number, was signed
 * in, and never chose anything. The hash on their row corresponds to a string
 * nobody has ever seen, so the password field on the sign-in screen can never
 * be satisfied for them.
 *
 * Registration now takes the customer's own password, so this set is closed:
 * it can only shrink, and `report-otp-only-users.ts` is the CLI over it.
 *
 * ## Why this is a module and not four lines inside that script
 *
 * The criterion is the part that has to be right. Getting it wrong in either
 * direction is a real cost — too wide and a report names people who are fine,
 * too narrow and a migration silently skips someone — and a query buried in a
 * script is a query nothing can check. It is tested in
 * `otp-only-accounts.int-spec.ts` against all three shapes of account.
 */

/** What the report needs, and deliberately nothing that identifies a person. */
export interface AccountWithUnknownPassword {
  id: string;
  createdAt: Date;
  isActive: boolean;
  isPhoneVerified: boolean;
}

/**
 * Both halves of the criterion, and why neither alone is enough.
 *
 *  1. An audit row saying the account was *created* by the OTP-only flow:
 *     `USER_LOGIN` with `metadata.via = 'register_otp'`, written by
 *     `AuthService.verifyRegistrationOtp` in the same request that created
 *     the user. The password-first path writes `via: 'register'`, so the two
 *     are distinguishable rather than merely countable — and `RetentionService`
 *     prunes notifications, sessions, QR codes, idempotency records and the
 *     outbox but never `audit_logs`, so the marker does not expire.
 *
 *  2. `passwordChangedAt IS NULL`. The first half says how the account
 *     *started*, not where it stands now: anyone who has since used "forgot
 *     password" has a password they chose, and `PasswordService` stamps this
 *     column when it sets one. Without this half the report would name people
 *     who are perfectly fine.
 *
 * A third property closes the set from the other end: accounts created from
 * now on stamp `passwordChangedAt` at creation, so a new registration cannot
 * enter it even if its audit row carried the old marker.
 *
 * Soft-deleted accounts are excluded — they have no access to lose.
 */
export async function findAccountsWithUnknownPassword(
  prisma: PrismaClient | Prisma.TransactionClient,
): Promise<AccountWithUnknownPassword[]> {
  const registeredByOtp = await prisma.auditLog.findMany({
    where: {
      action: 'USER_LOGIN',
      entityType: 'User',
      metadata: { path: ['via'], equals: 'register_otp' },
    },
    select: { entityId: true },
  });

  const ids = [
    ...new Set(registeredByOtp.map((row) => row.entityId).filter((id): id is string => !!id)),
  ];
  if (ids.length === 0) return [];

  return prisma.user.findMany({
    where: { id: { in: ids }, passwordChangedAt: null, deletedAt: null },
    select: { id: true, createdAt: true, isActive: true, isPhoneVerified: true },
    orderBy: { createdAt: 'asc' },
  });
}

/** How many accounts the OTP-only flow ever created, whatever became of them. */
export async function countAccountsEverRegisteredByOtp(
  prisma: PrismaClient | Prisma.TransactionClient,
): Promise<number> {
  const rows = await prisma.auditLog.findMany({
    where: {
      action: 'USER_LOGIN',
      entityType: 'User',
      metadata: { path: ['via'], equals: 'register_otp' },
    },
    select: { entityId: true },
  });
  return new Set(rows.map((r) => r.entityId).filter(Boolean)).size;
}
