import { z } from 'zod';
import { moneySchema, paginationSchema } from './common';
import { withdrawalStateSchema } from './withdrawal';

export const adminRoleSchema = z.enum([
  /** Read-only across the product. */
  'VIEWER',
  /** Day-to-day operations: retry, resolve manual review, verify drivers. */
  'OPERATOR',
  /** Everything an operator can do, plus fees, limits and manual ledger adjustments. */
  'FINANCE',
  /** User and role administration. */
  'ADMIN',
]);
export type AdminRole = z.infer<typeof adminRoleSchema>;

export const adminPermissionSchema = z.enum([
  'dashboard:read',
  'parks:read',
  'parks:write',
  'drivers:read',
  'drivers:write',
  'withdrawals:read',
  'withdrawals:retry',
  'withdrawals:resolve',
  'ledger:read',
  'ledger:adjust',
  'fees:read',
  'fees:write',
  'limits:read',
  'limits:write',
  'reconciliation:read',
  'reconciliation:run',
  'integrations:read',
  'audit:read',
  'admins:write',
]);
export type AdminPermission = z.infer<typeof adminPermissionSchema>;

/**
 * Roles are a fixed grant of permissions. The mapping lives in code and is
 * checked on every request; there is no implicit "admins can do anything".
 */
export const ROLE_PERMISSIONS: Readonly<Record<AdminRole, readonly AdminPermission[]>> = {
  VIEWER: [
    'dashboard:read',
    'parks:read',
    'drivers:read',
    'withdrawals:read',
    'ledger:read',
    'fees:read',
    'limits:read',
    'reconciliation:read',
    'integrations:read',
  ],
  OPERATOR: [
    'dashboard:read',
    'parks:read',
    'parks:write',
    'drivers:read',
    'drivers:write',
    'withdrawals:read',
    'withdrawals:retry',
    'withdrawals:resolve',
    'ledger:read',
    'fees:read',
    'limits:read',
    'reconciliation:read',
    'reconciliation:run',
    'integrations:read',
    'audit:read',
  ],
  FINANCE: [
    'dashboard:read',
    'parks:read',
    'drivers:read',
    'withdrawals:read',
    'withdrawals:retry',
    'withdrawals:resolve',
    'ledger:read',
    'ledger:adjust',
    'fees:read',
    'fees:write',
    'limits:read',
    'limits:write',
    'reconciliation:read',
    'reconciliation:run',
    'integrations:read',
    'audit:read',
  ],
  ADMIN: [
    'dashboard:read',
    'parks:read',
    'parks:write',
    'drivers:read',
    'drivers:write',
    'withdrawals:read',
    'withdrawals:retry',
    'withdrawals:resolve',
    'ledger:read',
    'ledger:adjust',
    'fees:read',
    'fees:write',
    'limits:read',
    'limits:write',
    'reconciliation:read',
    'reconciliation:run',
    'integrations:read',
    'audit:read',
    'admins:write',
  ],
};

export function permissionsFor(role: AdminRole): readonly AdminPermission[] {
  return ROLE_PERMISSIONS[role];
}

export function roleHasPermission(role: AdminRole, permission: AdminPermission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export const adminWithdrawalFilterSchema = paginationSchema.extend({
  state: withdrawalStateSchema.optional(),
  driverId: z.string().uuid().optional(),
  parkId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  needsAttention: z.coerce.boolean().optional(),
});
export type AdminWithdrawalFilter = z.infer<typeof adminWithdrawalFilterSchema>;

export const dashboardMetricsSchema = z.object({
  window: z.enum(['24h', '7d', '30d']),
  withdrawalsCount: z.number().int().nonnegative(),
  withdrawalsVolume: moneySchema,
  platformRevenue: moneySchema,
  successRatePpm: z.number().int().nonnegative(),
  inFlightCount: z.number().int().nonnegative(),
  manualReviewCount: z.number().int().nonnegative(),
  stuckCount: z.number().int().nonnegative(),
  suspenseBalance: moneySchema,
});
export type DashboardMetricsDto = z.infer<typeof dashboardMetricsSchema>;

export const resolveManualReviewSchema = z.object({
  /** What the operator decided actually happened in the outside world. */
  resolution: z.enum(['MARK_COMPLETED', 'COMPENSATE', 'MARK_FAILED', 'RETRY_PAYOUT']),
  /** Mandatory: why. It lands in the audit log verbatim. */
  reason: z.string().min(10).max(2000),
  /** Evidence the operator checked, e.g. a PSP transaction id. */
  evidenceReference: z.string().max(200).optional(),
});
export type ResolveManualReviewDto = z.infer<typeof resolveManualReviewSchema>;

// ------------------------------------------------------------------- parks

export const parkStatusAdminSchema = z.enum(['ACTIVE', 'SUSPENDED']);

export const createParkSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(48)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits and dashes'),
  name: z.string().min(2).max(120),
  yandexParkId: z.string().min(4).max(64),
  currency: z.enum(['AMD', 'RUB', 'USD', 'EUR', 'GEL', 'KZT']).default('AMD'),
});
export type CreateParkDto = z.infer<typeof createParkSchema>;

export const updateParkSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  status: parkStatusAdminSchema.optional(),
  suspendedReason: z.string().max(300).nullable().optional(),
});
export type UpdateParkDto = z.infer<typeof updateParkSchema>;

/** The key is written once and never read back. */
export const setParkCredentialSchema = z.object({
  clientId: z.string().min(2).max(120),
  apiKey: z.string().min(8).max(512),
});
export type SetParkCredentialDto = z.infer<typeof setParkCredentialSchema>;

export const rosterRowSchema = z.object({
  phone: z.string().min(6).max(24),
  externalProfileId: z.string().min(2).max(64),
  firstName: z.string().max(80).optional(),
  lastName: z.string().max(80).optional(),
});
export type RosterRowDto = z.infer<typeof rosterRowSchema>;

export const importRosterSchema = z.object({
  rows: z.array(rosterRowSchema).min(1).max(5000),
});
export type ImportRosterDto = z.infer<typeof importRosterSchema>;

export const updateMembershipSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'REMOVED']).optional(),
  eligibility: z.enum(['ELIGIBLE', 'INELIGIBLE', 'PENDING_REVIEW']).optional(),
  reason: z.string().min(3).max(300),
});
export type UpdateMembershipDto = z.infer<typeof updateMembershipSchema>;
