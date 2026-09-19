-- CreateEnum
CREATE TYPE "PspCallbackKind" AS ENUM ('PRECHECK', 'FINAL');

-- CreateEnum
CREATE TYPE "PspInboxStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'DUPLICATE', 'REJECTED', 'DEAD');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PermissionName" ADD VALUE 'PSP_READ';
ALTER TYPE "PermissionName" ADD VALUE 'PSP_RECONCILE';
ALTER TYPE "PermissionName" ADD VALUE 'SETTLEMENT_MANAGE';
ALTER TYPE "PermissionName" ADD VALUE 'SETTLEMENT_READ';
ALTER TYPE "PermissionName" ADD VALUE 'CONTRIBUTION_RULE_PROPOSE';
ALTER TYPE "PermissionName" ADD VALUE 'CONTRIBUTION_RULE_APPROVE';
ALTER TYPE "PermissionName" ADD VALUE 'ACQUIRER_SETTLEMENT_MANAGE';
ALTER TYPE "PermissionName" ADD VALUE 'TREASURY_READ';

-- CreateTable
CREATE TABLE "psp_callback_inbox" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "kind" "PspCallbackKind" NOT NULL,
    "status" "PspInboxStatus" NOT NULL DEFAULT 'RECEIVED',
    "dedupeKey" TEXT NOT NULL,
    "billId" TEXT,
    "providerTransactionId" TEXT,
    "reportedAmount" DECIMAL(18,4),
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "rejectedReason" TEXT,
    "rawPayload" JSONB NOT NULL,
    "pendingKey" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "pspPaymentAttemptId" TEXT,

    CONSTRAINT "psp_callback_inbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "psp_callback_inbox_dedupeKey_key" ON "psp_callback_inbox"("dedupeKey");

-- CreateIndex
CREATE INDEX "psp_callback_inbox_status_nextAttemptAt_idx" ON "psp_callback_inbox"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "psp_callback_inbox_billId_idx" ON "psp_callback_inbox"("billId");

-- CreateIndex
CREATE INDEX "psp_callback_inbox_receivedAt_idx" ON "psp_callback_inbox"("receivedAt");


-- ────────────────────────────────────────────────────────────────────────
-- The durable inbox's own rules.
--
-- Measured problem, not a theoretical one: ten concurrent callbacks for one
-- bill each opened a settlement transaction, the pool holds five, and every
-- one of them failed with "Unable to start a transaction in the given time".
-- Nothing was double-counted because nothing happened at all — and the
-- customer had paid. Raising the pool moves that cliff; it does not remove
-- it. So the HTTP boundary proves the callback genuine, writes it down, and
-- answers; the money moves later, once, in a worker.
-- ────────────────────────────────────────────────────────────────────────

-- `pendingKey` is set exactly while the row is not terminal, which is what
-- lets a partial index find outstanding work without scanning history.
ALTER TABLE "psp_callback_inbox"
  ADD CONSTRAINT "psp_callback_inbox_pending_key_tracks_status"
  CHECK (
    CASE WHEN "status" IN ('RECEIVED', 'PROCESSING')
      THEN "pendingKey" IS NOT NULL
      ELSE "pendingKey" IS NULL
    END
  );

CREATE INDEX "psp_callback_inbox_outstanding"
  ON "psp_callback_inbox" ("nextAttemptAt")
  WHERE "pendingKey" IS NOT NULL;

-- A row that says it was verified must not also carry a rejection, and one
-- that was rejected must say why. Without this, "verified" and
-- "rejectedReason" could disagree and nobody could say which was true.
ALTER TABLE "psp_callback_inbox"
  ADD CONSTRAINT "psp_callback_inbox_verdict_is_coherent"
  CHECK (
    CASE WHEN "verified"
      THEN "rejectedReason" IS NULL
      ELSE TRUE
    END
    AND ("status" <> 'REJECTED' OR "rejectedReason" IS NOT NULL)
  );

-- Only a verified FINAL callback may ever be marked processed. A precheck
-- settles nothing by construction, and an unverified callback is an
-- anonymous HTTP request claiming somebody paid.
ALTER TABLE "psp_callback_inbox"
  ADD CONSTRAINT "psp_callback_inbox_only_verified_final_settles"
  CHECK (
    "pspPaymentAttemptId" IS NULL
    OR ("verified" AND "kind" = 'FINAL')
  );

ALTER TABLE "psp_callback_inbox"
  ADD CONSTRAINT "psp_callback_inbox_attempts_non_negative"
  CHECK ("attempts" >= 0);

-- ── A processed row is history ──────────────────────────────────────────
--
-- The same discipline the ledger and the attempts table already have. Once a
-- callback has had its financial effect, the record of what arrived and what
-- it did is not editable — it is what a dispute is argued from.
CREATE OR REPLACE FUNCTION "psp_callback_inbox_processed_is_immutable"()
RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'PROCESSED' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION
        'psp_callback_inbox: callback % has been processed and cannot be deleted', OLD."id"
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW."rawPayload"::text IS DISTINCT FROM OLD."rawPayload"::text
       OR NEW."dedupeKey" IS DISTINCT FROM OLD."dedupeKey"
       OR NEW."status" IS DISTINCT FROM OLD."status"
       OR NEW."pspPaymentAttemptId" IS DISTINCT FROM OLD."pspPaymentAttemptId"
       OR NEW."verified" IS DISTINCT FROM OLD."verified" THEN
      RAISE EXCEPTION
        'psp_callback_inbox: callback % has been processed and cannot be changed', OLD."id"
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "psp_callback_inbox_processed_immutable"
  BEFORE UPDATE OR DELETE ON "psp_callback_inbox"
  FOR EACH ROW EXECUTE FUNCTION "psp_callback_inbox_processed_is_immutable"();
