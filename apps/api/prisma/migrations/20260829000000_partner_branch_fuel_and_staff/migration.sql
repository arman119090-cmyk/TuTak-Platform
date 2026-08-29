-- Fuel-station branches task (Arman, 2026-08-29). Three additive pieces:
--
-- 1. `BranchFuelType` on `partner_branches` — the real, per-branch product
--    classification (PETROL / METHANE_CNG / PROPANE_LPG) that
--    `Partner.sellsGas`/`sellsPetrol` (20260826030000) was never precise
--    enough to answer: those two flags say the *partner* sells "gas" and/or
--    "petrol" somewhere across its network, not which branch sells which.
--    Left NULL for every existing branch, fuel or not — there is no signal
--    in `sellsGas`/`sellsPetrol` (both boolean, both frequently true
--    together for "sells both") that can be mapped onto one specific branch
--    without guessing, and guessing a fuel type wrong is a safety-adjacent
--    mistake this migration will not make. An owner/admin classifies each
--    fuel branch explicitly after this ships
--    (`PartnerBranchesService.setFuelType`).
--
-- 2. `allBranches` on `user_roles` — an explicit, owner/admin-granted
--    exception letting a trusted `PARTNER_MANAGER` act at every branch of a
--    partner, the same reach `PARTNER_OWNER` already has unconditionally.
--    Defaults false, so no existing role is silently promoted.
--
-- 3. `PartnerBranchStaffAssignment` / `PartnerBranchQrCode` — see each
--    model's own docblock in schema.prisma. In short: which branch(es) a
--    partner-scoped `PARTNER_STAFF`/`PARTNER_MANAGER` may actually act at
--    (nothing before this answered that question — a partner-scoped role
--    was, in effect, access to every branch), and a branch's own
--    cryptographically random, independently revocable/rotatable scan-to-pay
--    token (extending the existing `QrCode.token` pattern rather than a
--    second QR system).
--
-- Every existing `PARTNER_STAFF`/`PARTNER_MANAGER` role lands with zero rows
-- in `partner_branch_staff_assignments` and `allBranches = false` the moment
-- this ships. For a partner with branches, that is a deliberate, restrictive
-- "unassigned" state — `hasBranchScope` refuses a branch-scoped action for
-- such a user until an owner/admin explicitly assigns them to a branch. For
-- a partner with none (`partner_branches` has no rows for it, e.g. a single
-- location grocery/cafe), nothing observable changes at all: no
-- `PurchaseIntent` of theirs ever carries a `partnerBranchId`, so the branch
-- check every endpoint adds is skipped entirely — see
-- `common/auth/branch-scope.ts`.

-- CreateEnum
CREATE TYPE "BranchFuelType" AS ENUM ('PETROL', 'METHANE_CNG', 'PROPANE_LPG');

-- CreateEnum
CREATE TYPE "BranchStaffRole" AS ENUM ('STAFF', 'MANAGER');

-- CreateEnum
CREATE TYPE "PartnerBranchQrStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'BRANCH_STAFF_ASSIGNED';
ALTER TYPE "AuditAction" ADD VALUE 'BRANCH_STAFF_DEACTIVATED';
ALTER TYPE "AuditAction" ADD VALUE 'BRANCH_QR_ISSUED';
ALTER TYPE "AuditAction" ADD VALUE 'BRANCH_QR_REVOKED';

-- AlterTable
ALTER TABLE "partner_branches" ADD COLUMN "fuelType" "BranchFuelType";

-- AlterTable
ALTER TABLE "user_roles" ADD COLUMN "allBranches" BOOLEAN NOT NULL DEFAULT false;

-- Lets `partner_branch_staff_assignments`/`partner_branch_qr_codes` declare
-- a composite FK on (partnerId, id) below — the DB-level guarantee that an
-- assignment or QR code can never name a branch belonging to a different
-- partner than the one it also names, with no trigger required.
-- CreateIndex
CREATE UNIQUE INDEX "partner_branches_partnerId_id_key" ON "partner_branches"("partnerId", "id");

-- CreateTable
CREATE TABLE "partner_branch_staff_assignments" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "partnerBranchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "BranchStaffRole" NOT NULL DEFAULT 'STAFF',
    "employeeDisplayCode" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "assignedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deactivatedAt" TIMESTAMP(3),
    "deactivatedByUserId" TEXT,

    CONSTRAINT "partner_branch_staff_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "partner_branch_staff_assignments_partnerId_employeeDisplayC_key" ON "partner_branch_staff_assignments"("partnerId", "employeeDisplayCode");

-- CreateIndex
CREATE INDEX "partner_branch_staff_assignments_userId_idx" ON "partner_branch_staff_assignments"("userId");

-- CreateIndex
CREATE INDEX "partner_branch_staff_assignments_partnerBranchId_isActive_idx" ON "partner_branch_staff_assignments"("partnerBranchId", "isActive");

-- Partial unique index: at most one ACTIVE assignment per (user, branch).
-- Prisma has no `@@unique` syntax for a `WHERE` clause, so this is hand
-- written, same technique `PartnerBranchQrCode`'s own "one ACTIVE QR per
-- branch" constraint uses below. A deactivated row is deliberately left in
-- place (history), so a plain (non-partial) unique constraint here would
-- permanently block ever reassigning the same person to the same branch
-- again after a single deactivation.
-- CreateIndex
CREATE UNIQUE INDEX "partner_branch_staff_assignments_active_user_branch_key" ON "partner_branch_staff_assignments"("userId", "partnerBranchId") WHERE "isActive";

-- AddForeignKey
ALTER TABLE "partner_branch_staff_assignments" ADD CONSTRAINT "partner_branch_staff_assignments_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_branch_staff_assignments" ADD CONSTRAINT "partner_branch_staff_assignments_partnerId_partnerBranchId_fkey" FOREIGN KEY ("partnerId", "partnerBranchId") REFERENCES "partner_branches"("partnerId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_branch_staff_assignments" ADD CONSTRAINT "partner_branch_staff_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_branch_staff_assignments" ADD CONSTRAINT "partner_branch_staff_assignments_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_branch_staff_assignments" ADD CONSTRAINT "partner_branch_staff_assignments_deactivatedByUserId_fkey" FOREIGN KEY ("deactivatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "partner_branch_qr_codes" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "partnerBranchId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" "PartnerBranchQrStatus" NOT NULL DEFAULT 'ACTIVE',
    "issuedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,

    CONSTRAINT "partner_branch_qr_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "partner_branch_qr_codes_token_key" ON "partner_branch_qr_codes"("token");

-- CreateIndex
CREATE INDEX "partner_branch_qr_codes_partnerBranchId_status_idx" ON "partner_branch_qr_codes"("partnerBranchId", "status");

-- Partial unique index: at most one ACTIVE QR code per branch. Rotating a
-- branch's code is revoke-then-issue (`PartnerBranchQrService.rotate()`),
-- never an update of an existing row, so this can stay a simple partial
-- unique index rather than a conditional UPDATE guard.
-- CreateIndex
CREATE UNIQUE INDEX "partner_branch_qr_codes_active_branch_key" ON "partner_branch_qr_codes"("partnerBranchId") WHERE "status" = 'ACTIVE';

-- AddForeignKey
ALTER TABLE "partner_branch_qr_codes" ADD CONSTRAINT "partner_branch_qr_codes_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_branch_qr_codes" ADD CONSTRAINT "partner_branch_qr_codes_partnerId_partnerBranchId_fkey" FOREIGN KEY ("partnerId", "partnerBranchId") REFERENCES "partner_branches"("partnerId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_branch_qr_codes" ADD CONSTRAINT "partner_branch_qr_codes_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_branch_qr_codes" ADD CONSTRAINT "partner_branch_qr_codes_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
