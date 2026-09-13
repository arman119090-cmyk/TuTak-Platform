-- Maker/checker for refunds — owner's decision, 2026-09-12.
--
-- A refund moves merchandise value back and claws back bonus that referrers
-- may already have spent, so the person at the till may start one but may
-- not settle it. This table is the "maker" half: a request with no
-- financial effect whatsoever until an owner or manager approves it. It is
-- deliberately separate from `purchase_intent_refunds`, where a row means
-- money and bonus have already moved.
CREATE TYPE "RefundRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "purchase_intent_refund_requests" (
    "id" TEXT NOT NULL,
    "purchaseIntentId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "partnerBranchId" TEXT,
    "amount" DECIMAL(18,4),
    "reason" TEXT NOT NULL,
    "status" "RefundRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedByUserId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "refundId" TEXT,

    CONSTRAINT "purchase_intent_refund_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "purchase_intent_refund_requests_refundId_key"
ON "purchase_intent_refund_requests"("refundId");

CREATE INDEX "purchase_intent_refund_requests_partnerId_status_idx"
ON "purchase_intent_refund_requests"("partnerId", "status");

CREATE INDEX "purchase_intent_refund_requests_purchaseIntentId_idx"
ON "purchase_intent_refund_requests"("purchaseIntentId");

-- At most one undecided request per purchase. Two pending requests against
-- the same purchase would each have been written against a `remaining` the
-- other is about to change, and an approver would be deciding on a number
-- that is no longer true. Same partial-unique-index form the branch QR and
-- branch staff tables already use.
CREATE UNIQUE INDEX "purchase_intent_refund_requests_one_pending_per_intent_key"
ON "purchase_intent_refund_requests"("purchaseIntentId")
WHERE "status" = 'PENDING';

ALTER TABLE "purchase_intent_refund_requests"
  ADD CONSTRAINT "purchase_intent_refund_requests_purchaseIntentId_fkey"
  FOREIGN KEY ("purchaseIntentId") REFERENCES "purchase_intents"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "purchase_intent_refund_requests_partnerId_fkey"
  FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "purchase_intent_refund_requests_partnerBranchId_fkey"
  FOREIGN KEY ("partnerBranchId") REFERENCES "partner_branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "purchase_intent_refund_requests_requestedByUserId_fkey"
  FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "purchase_intent_refund_requests_decidedByUserId_fkey"
  FOREIGN KEY ("decidedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "purchase_intent_refund_requests_refundId_fkey"
  FOREIGN KEY ("refundId") REFERENCES "purchase_intent_refunds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Audit actions for both halves of the split.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PURCHASE_INTENT_REFUND_REQUESTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PURCHASE_INTENT_REFUND_REJECTED';
