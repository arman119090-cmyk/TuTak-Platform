-- CreateEnum
CREATE TYPE "MediaAssetKind" AS ENUM ('USER_AVATAR', 'PARTNER_LOGO', 'PARTNER_COVER');

-- CreateEnum
CREATE TYPE "MediaAssetStatus" AS ENUM ('PENDING_REVIEW', 'ACTIVE', 'REPLACED', 'REVOKED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'MEDIA_ASSET_UPLOADED';
ALTER TYPE "AuditAction" ADD VALUE 'MEDIA_ASSET_APPROVED';
ALTER TYPE "AuditAction" ADD VALUE 'MEDIA_ASSET_REPLACED';
ALTER TYPE "AuditAction" ADD VALUE 'MEDIA_ASSET_REVOKED';
ALTER TYPE "AuditAction" ADD VALUE 'MEDIA_AVATAR_CONSENT_CHANGED';

-- AlterTable
ALTER TABLE "partners" ADD COLUMN     "coverAssetId" TEXT,
ADD COLUMN     "logoAssetId" TEXT;

-- AlterTable
ALTER TABLE "purchase_intents" ADD COLUMN     "brandDisplayName" TEXT,
ADD COLUMN     "brandLogoAssetId" TEXT;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "brandDisplayName" TEXT,
ADD COLUMN     "brandLogoAssetId" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatarAssetId" TEXT,
ADD COLUMN     "avatarConsentReferralList" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "media_assets" (
    "id" TEXT NOT NULL,
    "kind" "MediaAssetKind" NOT NULL,
    "status" "MediaAssetStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "userId" TEXT,
    "partnerId" TEXT,
    "storageKey" TEXT NOT NULL,
    "displayKey" TEXT NOT NULL,
    "thumbnailKey" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedByUserId" TEXT,
    "approvedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "replacedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_storageKey_key" ON "media_assets"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_displayKey_key" ON "media_assets"("displayKey");

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_thumbnailKey_key" ON "media_assets"("thumbnailKey");

-- CreateIndex
CREATE INDEX "media_assets_partnerId_kind_status_idx" ON "media_assets"("partnerId", "kind", "status");

-- CreateIndex
CREATE INDEX "media_assets_userId_kind_status_idx" ON "media_assets"("userId", "kind", "status");

-- CreateIndex
CREATE INDEX "media_assets_status_createdAt_idx" ON "media_assets"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_avatarAssetId_fkey" FOREIGN KEY ("avatarAssetId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_brandLogoAssetId_fkey" FOREIGN KEY ("brandLogoAssetId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_brandLogoAssetId_fkey" FOREIGN KEY ("brandLogoAssetId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partners" ADD CONSTRAINT "partners_logoAssetId_fkey" FOREIGN KEY ("logoAssetId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partners" ADD CONSTRAINT "partners_coverAssetId_fkey" FOREIGN KEY ("coverAssetId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- Integrity guards Prisma's schema language cannot express.
-- Same discipline as `partners_commission_rate_on_grid`: the API validates
-- these too, but the database is the boundary that cannot be bypassed by a
-- script, a console session, or a future code path nobody re-checked.
-- ─────────────────────────────────────────────────────────────────────────

-- An asset belongs to exactly one subject, and that subject must match its
-- kind. A PARTNER_LOGO hanging off a userId, or an asset owned by nobody at
-- all, is not a state any caller should be able to reach.
ALTER TABLE "media_assets"
  ADD CONSTRAINT "media_assets_subject_matches_kind" CHECK (
    (kind = 'USER_AVATAR'   AND "userId" IS NOT NULL AND "partnerId" IS NULL) OR
    (kind IN ('PARTNER_LOGO', 'PARTNER_COVER') AND "partnerId" IS NOT NULL AND "userId" IS NULL)
  );

-- A status that has moved past PENDING_REVIEW must say when, and by whom for
-- the transitions that have an actor. Nothing rewrites these once stamped.
ALTER TABLE "media_assets"
  ADD CONSTRAINT "media_assets_approval_stamped" CHECK (
    (status = 'PENDING_REVIEW' AND "approvedAt" IS NULL) OR
    (status <> 'PENDING_REVIEW' AND "approvedAt" IS NOT NULL)
  );

-- At most one live asset, and at most one queued submission, per subject and
-- kind. Two ACTIVE logos for one partner would make "the partner's logo"
-- ambiguous; two PENDING_REVIEW ones would make an administrator's approval
-- ambiguous about which file they actually looked at.
CREATE UNIQUE INDEX "media_assets_one_active_per_partner_kind"
  ON "media_assets" ("partnerId", "kind")
  WHERE status = 'ACTIVE' AND "partnerId" IS NOT NULL;

CREATE UNIQUE INDEX "media_assets_one_pending_per_partner_kind"
  ON "media_assets" ("partnerId", "kind")
  WHERE status = 'PENDING_REVIEW' AND "partnerId" IS NOT NULL;

CREATE UNIQUE INDEX "media_assets_one_active_avatar_per_user"
  ON "media_assets" ("userId")
  WHERE status = 'ACTIVE' AND kind = 'USER_AVATAR';
