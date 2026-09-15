/**
 * One-time recovery for the bootstrap administrator's password, on staging.
 *
 * ## Why this exists
 *
 * `seed-baseline` creates the bootstrap administrator once and then
 * deliberately never touches an existing admin's password again — an
 * idempotent seed that silently reset a credential on every restart would be
 * a permanent backdoor sized exactly like whoever can edit an environment
 * variable. That is the right default, and it leaves one hole: an operator
 * locked out of a running staging environment has no way back in. Render's
 * free tier gives no shell, so there is nowhere to run a one-off command
 * either.
 *
 * So: an explicit, separate, loud path. Not a softening of the seed.
 *
 * ## What holds it shut
 *
 * Four independent conditions, none of them a default:
 *
 *  1. `NODE_ENV` is exactly `staging` — production and development cannot
 *     run this at all, and the check is a refusal, not a skip, so an
 *     operator who sets the flag in the wrong place finds out immediately
 *     instead of believing a reset happened;
 *  2. `RESET_STAGING_ADMIN_PASSWORD` is exactly `true` — a deliberate,
 *     separate switch from anything the deployment normally sets;
 *  3. `SEED_ADMIN_PASSWORD` is present and at least 12 characters — the same
 *     bar `seed-baseline` holds, reusing the same variable so recovery adds
 *     no new secret to store;
 *  4. exactly one account can be affected: the bootstrap administrator,
 *     looked up by its own phone number, which is a constant in this file
 *     rather than anything the environment can point elsewhere.
 *
 * ## What it changes, and what it must never touch
 *
 * Authentication state only: the password hash, the forced-rotation flag,
 * the failed-attempt counter and the lockout, plus revoking that user's
 * refresh tokens so a session opened with the compromised password does not
 * outlive it. No wallet, no referral code, no partner, no purchase, no
 * money row of any kind — `reset-staging-admin-password.spec.ts` fails the
 * build if this file so much as reaches for another Prisma delegate.
 *
 * The new password is never logged, and neither is its hash.
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

/** The only account this script may ever touch — `seed-baseline` creates it. */
export const BOOTSTRAP_ADMIN_PHONE = '+37400000000';

/** The one environment this may run in. */
export const REQUIRED_NODE_ENV = 'staging';

/** Must be exactly this string; anything else, including `TRUE`, is off. */
export const RESET_FLAG_ENV = 'RESET_STAGING_ADMIN_PASSWORD';
export const RESET_FLAG_VALUE = 'true';

/** Same bar as `seed-baseline`, and the same variable, so no new secret exists. */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * Raised when the flag is on but the environment is not one this may run in.
 * Deliberately an error rather than a quiet return: a refused reset that
 * looked like a successful one would leave an operator waiting for a login
 * that will never work.
 */
export class StagingAdminResetRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StagingAdminResetRefused';
  }
}

export type ResetResult =
  | { status: 'skipped' }
  | { status: 'reset'; userId: string; revokedRefreshTokens: number };

type ResetEnv = Record<string, string | undefined>;

/**
 * Resets the bootstrap administrator's password, or refuses, or does
 * nothing — in that order of preference.
 *
 * Returns `skipped` when the flag is absent: that is the normal state of
 * every deployment, and it must not be an error. Every other failure throws,
 * because past this point the operator is expecting a working password.
 */
export async function resetStagingAdminPassword(
  prisma: PrismaClient,
  env: ResetEnv = process.env,
): Promise<ResetResult> {
  if (env[RESET_FLAG_ENV] !== RESET_FLAG_VALUE) {
    return { status: 'skipped' };
  }

  if (env.NODE_ENV !== REQUIRED_NODE_ENV) {
    throw new StagingAdminResetRefused(
      `${RESET_FLAG_ENV} is set but NODE_ENV is "${env.NODE_ENV ?? '<unset>'}". ` +
        `This recovery path exists for ${REQUIRED_NODE_ENV} only and refuses to run anywhere else. ` +
        'Unset the flag.',
    );
  }

  const newPassword = env.SEED_ADMIN_PASSWORD;
  if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new StagingAdminResetRefused(
      `SEED_ADMIN_PASSWORD must be set to at least ${MIN_PASSWORD_LENGTH} characters ` +
        'before the bootstrap administrator can be recovered. Set a fresh one in the ' +
        'deployment environment and redeploy.',
    );
  }

  const admin = await prisma.user.findUnique({
    where: { phone: BOOTSTRAP_ADMIN_PHONE },
    select: { id: true },
  });
  if (!admin) {
    throw new StagingAdminResetRefused(
      `No bootstrap administrator (${BOOTSTRAP_ADMIN_PHONE}) exists in this database. ` +
        'Nothing was changed. Run the baseline seed first (SEED_BASELINE=true).',
    );
  }

  const passwordHash = await argon2.hash(newPassword);

  // One transaction: a password changed without its sessions revoked is a
  // half-done recovery that still leaves the compromised credential's
  // sessions alive, and that is exactly the state this is meant to end.
  return prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: admin.id },
      data: {
        passwordHash,
        // The recovered credential is a bootstrap, same as the seeded one:
        // it reaches the login screen and nothing else until rotated.
        mustChangePassword: true,
        // A lockout from the failed attempts that led here would otherwise
        // outlive the password that caused them.
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });

    const revoked = await tx.refreshToken.updateMany({
      where: { userId: admin.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return { status: 'reset', userId: admin.id, revokedRefreshTokens: revoked.count };
  });
}

/** Entry point when run directly: `node dist/scripts/reset-staging-admin-password.js`. */
if (require.main === module) {
  const prisma = new PrismaClient();
  resetStagingAdminPassword(prisma)
    .then((result) => {
      if (result.status === 'skipped') {
        console.log(`${RESET_FLAG_ENV} is not set — nothing to do.`);
        return;
      }
      // Deliberately says what happened and to whom, and never what the
      // password or its hash is.
      console.log(
        `Bootstrap administrator (${BOOTSTRAP_ADMIN_PHONE}) recovered: password replaced, ` +
          `lockout cleared, password rotation required at next login, ` +
          `${result.revokedRefreshTokens} refresh token(s) revoked.`,
      );
      console.log(`Remove ${RESET_FLAG_ENV} and redeploy now — it must not survive this recovery.`);
    })
    .catch((e: unknown) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
