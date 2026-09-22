-- An offer of a job at a partner, made to a phone number.
--
-- Until now an owner could only post staff who already had a partner-scoped
-- role, and nothing in the product created that role: somebody with database
-- access did. This is the missing step, and it is the one that hands out
-- access to other people's money, so the shape matters more than the feature.
--
-- What the table deliberately does not contain: the token. A readable
-- invitation token is a working key to somebody's job, available to anything
-- that can read one table — a backup, a support query, a log line that
-- printed a row. Only its SHA-256 is stored, and lookups hash what was
-- presented and search by that. A stolen copy of this table contains nothing
-- anybody can use.
--
-- Expiry is not a status. A row past `expiresAt` stays PENDING and every
-- reader computes "expired" from the clock, because a status that only
-- becomes true when a sweep runs leaves a window in which an invitation is
-- accepted after it expired.

CREATE TYPE "PartnerStaffInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED');

CREATE TABLE "partner_staff_invitations" (
    "id"               TEXT NOT NULL,
    "partnerId"        TEXT NOT NULL,
    "phone"            TEXT NOT NULL,
    "role"             "RoleName" NOT NULL,
    "branchIds"        TEXT[],
    "tokenHash"        TEXT NOT NULL,
    "status"           "PartnerStaffInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt"        TIMESTAMP(3) NOT NULL,
    "attemptCount"     INTEGER NOT NULL DEFAULT 0,
    "createdByUserId"  TEXT NOT NULL,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt"       TIMESTAMP(3),
    "acceptedByUserId" TEXT,
    "revokedAt"        TIMESTAMP(3),
    "revokedByUserId"  TEXT,

    CONSTRAINT "partner_staff_invitations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "partner_staff_invitations_tokenHash_key"
    ON "partner_staff_invitations"("tokenHash");

CREATE INDEX "partner_staff_invitations_partnerId_status_createdAt_idx"
    ON "partner_staff_invitations"("partnerId", "status", "createdAt");

CREATE INDEX "partner_staff_invitations_partnerId_phone_idx"
    ON "partner_staff_invitations"("partnerId", "phone");

ALTER TABLE "partner_staff_invitations"
    ADD CONSTRAINT "partner_staff_invitations_partnerId_fkey"
    FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "partner_staff_invitations_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "partner_staff_invitations_acceptedByUserId_fkey"
    FOREIGN KEY ("acceptedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- An accepted invitation names who accepted it and when; a revoked one names
-- when it was called back. A row that claims one without the other is a
-- record nobody can audit, and the two states are reached from exactly one
-- place each.
ALTER TABLE "partner_staff_invitations"
    ADD CONSTRAINT "partner_staff_invitations_outcome_is_complete"
    CHECK (
      ("status" = 'PENDING'  AND "acceptedAt" IS NULL AND "acceptedByUserId" IS NULL AND "revokedAt" IS NULL)
      OR ("status" = 'ACCEPTED' AND "acceptedAt" IS NOT NULL AND "acceptedByUserId" IS NOT NULL AND "revokedAt" IS NULL)
      OR ("status" = 'REVOKED'  AND "revokedAt" IS NOT NULL AND "acceptedAt" IS NULL)
    );

-- At most one open offer per number per partner.
--
-- Not a nicety: two live invitations to the same phone are two tokens that
-- both work, so revoking "the" invitation leaves one behind. Resending is
-- therefore revoke-then-create, which this index forces rather than merely
-- recommends.
CREATE UNIQUE INDEX "partner_staff_invitations_one_open_per_phone"
    ON "partner_staff_invitations"("partnerId", "phone")
    WHERE "status" = 'PENDING';
