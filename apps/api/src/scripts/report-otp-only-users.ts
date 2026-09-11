/**
 * Who holds an account whose password they have never known — a count, and
 * nothing else.
 *
 * ## What produced these accounts
 *
 * OTP-first registration used to create the account with
 * `argon2.hash(randomBytes(32))`. The customer proved the number, was signed
 * in, and never chose a password; the hash on their row corresponds to a
 * string nobody has ever seen. They can sign in by SMS and they can use
 * "forgot password", but the password field on the sign-in screen can never
 * be satisfied.
 *
 * Registration now takes the customer's own password, so the set below is
 * closed: it can only shrink.
 *
 * ## Why this reads and does not write
 *
 * Changing these accounts is a business decision with real ways to get it
 * wrong, and the first thing that decision needs is the size of the problem.
 * Anything that edits rows belongs in a separate, separately-reviewed script
 * — see docs/REGISTRATION_PASSWORD_2026-09-11.md §6 for why forcing a
 * password on them is not as simple as `mustChangePassword`.
 *
 * ## How an account is identified, and why both halves are needed
 *
 *  1. `AuditLog` carries `action = USER_LOGIN` with `metadata.via =
 *     'register_otp'` for the moment the account was created — written in the
 *     same request that created it, and never pruned (`RetentionService`
 *     touches notifications, sessions, QR codes, idempotency records and the
 *     outbox; it does not touch `audit_logs`). The password-first path writes
 *     `via: 'register'` instead, so the two are distinguishable rather than
 *     merely countable.
 *
 *  2. `passwordChangedAt IS NULL` — because the first half says how the
 *     account *started*, not where it stands now. Anyone who has since used
 *     "forgot password" has a password they chose; `PasswordService` stamps
 *     this column when it sets one. Without this half the report would name
 *     people who are perfectly fine.
 *
 * A third property holds them together: accounts created from now on stamp
 * `passwordChangedAt` at creation, so a new registration can never enter this
 * set even if its audit row were somehow written with the old marker.
 *
 * Usage:
 *   node dist/scripts/report-otp-only-users.js
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const registeredByOtp = await prisma.auditLog.findMany({
    where: {
      action: 'USER_LOGIN',
      entityType: 'User',
      // Prisma's JSON path filter. `via` is written by
      // `AuthService.verifyRegistrationOtp` and by nothing else.
      metadata: { path: ['via'], equals: 'register_otp' },
    },
    select: { entityId: true },
  });

  const ids = [...new Set(registeredByOtp.map((row) => row.entityId).filter((id): id is string => !!id))];

  if (ids.length === 0) {
    console.log('No account in this database was created by the OTP-only flow.');
    return;
  }

  const stillWithoutAKnownPassword = await prisma.user.findMany({
    where: { id: { in: ids }, passwordChangedAt: null, deletedAt: null },
    select: { id: true, createdAt: true, isActive: true, isPhoneVerified: true },
    orderBy: { createdAt: 'asc' },
  });

  // The phone number is the account identifier on this platform and is
  // deliberately not printed: this report is about how many and how old, and
  // a list of numbers in a terminal scrollback is a customer list.
  console.log(`Accounts created by the OTP-only flow:            ${ids.length}`);
  console.log(`…of those, still with no password they chose:    ${stillWithoutAKnownPassword.length}`);
  console.log('');

  for (const user of stillWithoutAKnownPassword) {
    console.log(
      `  ${user.id}  created ${user.createdAt.toISOString().slice(0, 10)}` +
        `  active=${user.isActive}  phoneVerified=${user.isPhoneVerified}`,
    );
  }

  console.log('');
  console.log('These accounts are not locked out: SMS sign-in works, and');
  console.log('"forgot password" sets a password with a fresh code to the same');
  console.log('number. Nothing here needs a migration to keep working.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
