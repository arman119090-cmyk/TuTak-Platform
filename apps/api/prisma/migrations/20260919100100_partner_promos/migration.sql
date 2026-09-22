-- ────────────────────────────────────────────────────────────────────────
-- Home "Partner Spotlight": curated featured-partner placements.
--
-- Not an advertising platform. A platform administrator writes each card,
-- chooses its artwork and decides when it runs; a partner cannot create one
-- from their own panel, for the same reason a partner cannot publish their
-- own logo without review — an owner-account compromise must not reach every
-- customer's Home screen.
-- ────────────────────────────────────────────────────────────────────────

-- CreateEnum
CREATE TYPE "PartnerPromoDestination" AS ENUM ('PARTNER', 'PARTNERS_MAP');

-- CreateTable
CREATE TABLE "partner_promos" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "benefitLabel" TEXT NOT NULL,
    "artworkAssetId" TEXT,
    "destination" "PartnerPromoDestination" NOT NULL DEFAULT 'PARTNER',
    "sponsored" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "impressionCount" INTEGER NOT NULL DEFAULT 0,
    "openCount" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_promos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "partner_promos_active_priority_idx" ON "partner_promos"("active", "priority");

-- CreateIndex
CREATE INDEX "partner_promos_partnerId_idx" ON "partner_promos"("partnerId");

-- AddForeignKey
ALTER TABLE "partner_promos" ADD CONSTRAINT "partner_promos_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_promos" ADD CONSTRAINT "partner_promos_artworkAssetId_fkey" FOREIGN KEY ("artworkAssetId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A window that ends before it starts is not a schedule, it is a typo, and
-- the service's date filter would silently show the card never.
ALTER TABLE "partner_promos"
  ADD CONSTRAINT "partner_promos_window_is_ordered"
  CHECK ("startAt" IS NULL OR "endAt" IS NULL OR "endAt" > "startAt");

-- Counters never go negative; the only write path is an atomic increment.
ALTER TABLE "partner_promos"
  ADD CONSTRAINT "partner_promos_counters_non_negative"
  CHECK ("impressionCount" >= 0 AND "openCount" >= 0);

-- Promo artwork is partner-scoped like a cover (so an administrator can only
-- attach a partner's own artwork to that partner's card), but a partner may
-- run several cards at once, so the "one ACTIVE asset per partner and kind"
-- rule — which is about *the* logo and *the* cover — must not apply to it.
ALTER TABLE "media_assets" DROP CONSTRAINT "media_assets_subject_matches_kind";
ALTER TABLE "media_assets"
  ADD CONSTRAINT "media_assets_subject_matches_kind" CHECK (
    (kind = 'USER_AVATAR'   AND "userId" IS NOT NULL AND "partnerId" IS NULL) OR
    (kind IN ('PARTNER_LOGO', 'PARTNER_COVER', 'PROMO_ARTWORK') AND "partnerId" IS NOT NULL AND "userId" IS NULL)
  );

DROP INDEX "media_assets_one_active_per_partner_kind";
CREATE UNIQUE INDEX "media_assets_one_active_per_partner_kind"
  ON "media_assets" ("partnerId", "kind")
  WHERE status = 'ACTIVE' AND "partnerId" IS NOT NULL AND kind <> 'PROMO_ARTWORK';
