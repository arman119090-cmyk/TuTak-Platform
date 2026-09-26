-- Partner Commerce — final fixes after 7e44ad8 (docs/PARTNER_COMMERCE.md).
--
-- Additive on top of 20260926090000_partner_commerce: no table or column is
-- dropped. Three enum values and two columns introduced by that (never
-- deployed) migration are RENAMED in place so no row loses its data:
--   PartnerOrderOperationalStatus.HANDED_OVER  → DELIVERED           (item 7)
--   AuditAction.PARTNER_ORDER_HANDED_OVER      → PARTNER_ORDER_DELIVERED
--   LedgerAccountType.PARTNER_ORDER_ESCROW     → PARTNER_ORDER_MONEY_ESCROW (item 9)
--   partner_orders.handedOverAt / handedOverByUserId → deliveredAt / deliveredByUserId
--
-- Item 9 splits the escrow: the old shared account only ever held money for
-- QR purchases, so renaming it to the money escrow is exact for them. A
-- DISCOUNT leg captured under the old code would sit in the wrong account —
-- refuse to run while any exists (Partner Commerce v2 was never deployed,
-- so in every real environment there is none).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "partner_order_payment_legs"
    WHERE "type" = 'DISCOUNT' AND "status" = 'CAPTURED'
  ) THEN
    RAISE EXCEPTION 'In-flight Partner Commerce DISCOUNT legs exist in the shared escrow; settle or cancel them before this migration';
  END IF;
END $$;

-- RenameEnumValue (data kept)
ALTER TYPE "PartnerOrderOperationalStatus" RENAME VALUE 'HANDED_OVER' TO 'DELIVERED';
ALTER TYPE "AuditAction" RENAME VALUE 'PARTNER_ORDER_HANDED_OVER' TO 'PARTNER_ORDER_DELIVERED';
ALTER TYPE "LedgerAccountType" RENAME VALUE 'PARTNER_ORDER_ESCROW' TO 'PARTNER_ORDER_MONEY_ESCROW';

-- RenameColumn (data kept)
ALTER TABLE "partner_orders" RENAME COLUMN "handedOverAt" TO "deliveredAt";
ALTER TABLE "partner_orders" RENAME COLUMN "handedOverByUserId" TO "deliveredByUserId";

-- AlterEnum
ALTER TYPE "PartnerOrderOperationalStatus" ADD VALUE 'OUT_FOR_DELIVERY' BEFORE 'DELIVERED';
ALTER TYPE "PartnerOrderOperationalStatus" ADD VALUE 'READY_FOR_PICKUP' BEFORE 'DELIVERED';

-- AlterEnum
ALTER TYPE "LedgerAccountType" ADD VALUE 'PARTNER_ORDER_DISCOUNT_ESCROW';
ALTER TYPE "LedgerAccountType" ADD VALUE 'CUSTOMER_SHORTFALL_CLEARING';

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_ORDER_OUT_FOR_DELIVERY';
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_ORDER_READY_FOR_PICKUP';
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_ORDER_PAYMENT_ISSUE';
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_ORDER_CANCELLATION_REQUESTED';
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_ORDER_CANCELLATION_COST_CLAIMED';
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_ORDER_CANCELLATION_DECIDED';
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_ORDER_CANCELLATION_WITHDRAWN';
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_ORDER_RETURN_SHORTFALL_SETTLED';
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_ORDER_RETURN_SHORTFALL_REFUSED';
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_ORDER_RETURN_REVIEWED';
ALTER TYPE "AuditAction" ADD VALUE 'PURCHASE_INTENT_REFUND_PENDING';
ALTER TYPE "AuditAction" ADD VALUE 'PURCHASE_INTENT_REFUND_SHORTFALL_SETTLED';
ALTER TYPE "AuditAction" ADD VALUE 'PURCHASE_INTENT_REFUND_SHORTFALL_REFUSED';
ALTER TYPE "AuditAction" ADD VALUE 'PURCHASE_INTENT_REFUND_REVIEWED';
ALTER TYPE "AuditAction" ADD VALUE 'REFERRAL_WITHHOLDING_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'REFERRAL_WITHHOLDING_RECOVERED';

-- CreateEnum
CREATE TYPE "FinancialPolicyVersion" AS ENUM ('LEGACY_V1', 'COMMERCE_V2');

-- CreateEnum
CREATE TYPE "PurchaseIntentRefundStatus" AS ENUM ('COMPLETED', 'AWAITING_SHORTFALL_SETTLEMENT', 'MANUAL_REVIEW', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "FulfillmentMethod" AS ENUM ('DELIVERY', 'PICKUP');

-- CreateEnum
CREATE TYPE "PartnerOrderCancellationStatus" AS ENUM ('NONE', 'REQUESTED', 'COST_REVIEW');

-- CreateEnum
CREATE TYPE "PartnerOrderCancellationRequestStatus" AS ENUM ('AWAITING_PARTNER', 'COST_REVIEW', 'COMPLETED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "CancellationCostDecision" AS ENUM ('NO_CLAIM', 'NO_COST', 'APPROVED', 'REDUCED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReferralWithholdingStatus" AS ENUM ('OPEN', 'SETTLED');


-- AlterEnum
ALTER TYPE "BonusEntryType" ADD VALUE 'WITHHOLDING';


-- AlterEnum
ALTER TYPE "OrderEscalationType" ADD VALUE 'PAYMENT_ISSUE_24H';
ALTER TYPE "OrderEscalationType" ADD VALUE 'CANCELLATION_COST_REVIEW';
ALTER TYPE "OrderEscalationType" ADD VALUE 'RETURN_SHORTFALL_REVIEW';


-- AlterEnum
ALTER TYPE "PartnerOrderReturnStatus" ADD VALUE 'AWAITING_SHORTFALL_SETTLEMENT';
ALTER TYPE "PartnerOrderReturnStatus" ADD VALUE 'WITHDRAWN';

-- AlterTable
ALTER TABLE "bonus_lots" ADD COLUMN     "expiredWrittenBackAmount" DECIMAL(18,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "partner_order_payment_legs" ADD COLUMN     "retainedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "partner_order_returns" ADD COLUMN     "expiredWrittenBack" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "externalRefundGross" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "grossRefund" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "netRefund" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "recoveredShortfall" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "referralWithheld" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "refusalNote" TEXT,
ADD COLUMN     "refusedAt" TIMESTAMP(3),
ADD COLUMN     "refusedByUserId" TEXT,
ADD COLUMN     "revenueReversed" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedByUserId" TEXT,
ADD COLUMN     "settledAt" TIMESTAMP(3),
ADD COLUMN     "settledByUserId" TEXT,
ADD COLUMN     "settledShiftId" TEXT,
ADD COLUMN     "shortfallCollected" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "shortfallFromExternal" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "shortfallFromMoney" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "shortfallRecoveryLedgerTransactionId" TEXT,
ADD COLUMN     "tutakMoneyGross" DECIMAL(18,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "partner_orders" ADD COLUMN     "cancellationStatus" "PartnerOrderCancellationStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "cancellationTerms" TEXT,
ADD COLUMN     "courierNote" TEXT,
ADD COLUMN     "financialPolicyVersion" "FinancialPolicyVersion" NOT NULL DEFAULT 'COMMERCE_V2',
ADD COLUMN     "fulfillmentMethod" "FulfillmentMethod",
ADD COLUMN     "outForDeliveryAt" TIMESTAMP(3),
ADD COLUMN     "outForDeliveryByUserId" TEXT,
ADD COLUMN     "paymentIssueEscalatedAt" TIMESTAMP(3),
ADD COLUMN     "prepaymentCoveredAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "readyForPickupAt" TIMESTAMP(3),
ADD COLUMN     "readyForPickupByUserId" TEXT;

-- AlterTable
ALTER TABLE "purchase_intent_refunds" ADD COLUMN     "cashRefundGross" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "cashRefundNet" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "customerShortfall" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "expiredWrittenBack" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "financialPolicyVersion" "FinancialPolicyVersion" NOT NULL DEFAULT 'LEGACY_V1',
ADD COLUMN     "grossRefund" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "netRefund" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "recoveredShortfall" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "referralWithheld" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "refusalNote" TEXT,
ADD COLUMN     "refusedAt" TIMESTAMP(3),
ADD COLUMN     "refusedByUserId" TEXT,
ADD COLUMN     "revenueReversed" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedByUserId" TEXT,
ADD COLUMN     "settledAt" TIMESTAMP(3),
ADD COLUMN     "settledByUserId" TEXT,
ADD COLUMN     "settledShiftId" TEXT,
ADD COLUMN     "shortfallCollected" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "shortfallFromCash" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "shortfallFromMoney" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "status" "PurchaseIntentRefundStatus" NOT NULL DEFAULT 'COMPLETED';

-- AlterTable
ALTER TABLE "purchase_intents" ADD COLUMN     "financialPolicyVersion" "FinancialPolicyVersion" NOT NULL DEFAULT 'LEGACY_V1';

-- CreateTable
CREATE TABLE "partner_order_cancellations" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "PartnerOrderCancellationRequestStatus" NOT NULL DEFAULT 'AWAITING_PARTNER',
    "requestedByUserId" TEXT NOT NULL,
    "reason" TEXT,
    "partnerDeadlineAt" TIMESTAMP(3) NOT NULL,
    "claimedCostAmount" DECIMAL(18,4),
    "costReason" TEXT,
    "costEvidence" TEXT,
    "costEvidenceUrls" TEXT[],
    "claimedByUserId" TEXT,
    "claimedShiftId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "decision" "CancellationCostDecision",
    "approvedCostAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "costFromExternal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "costFromMoney" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "costLedgerTransactionId" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "partner_order_cancellations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_withholdings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "remainingAmount" DECIMAL(18,4) NOT NULL,
    "status" "ReferralWithholdingStatus" NOT NULL DEFAULT 'OPEN',
    "beneficiaryPartnerId" TEXT NOT NULL,
    "sourceTransactionId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "referral_withholdings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_withholding_recoveries" (
    "id" TEXT NOT NULL,
    "withholdingId" TEXT NOT NULL,
    "bonusLotId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "ledgerTransactionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_withholding_recoveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "partner_order_cancellations_costLedgerTransactionId_key" ON "partner_order_cancellations"("costLedgerTransactionId");

-- CreateIndex
CREATE INDEX "partner_order_cancellations_orderId_idx" ON "partner_order_cancellations"("orderId");

-- CreateIndex
CREATE INDEX "partner_order_cancellations_status_partnerDeadlineAt_idx" ON "partner_order_cancellations"("status", "partnerDeadlineAt");

-- CreateIndex
CREATE INDEX "referral_withholdings_userId_status_createdAt_idx" ON "referral_withholdings"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "referral_withholdings_beneficiaryPartnerId_status_idx" ON "referral_withholdings"("beneficiaryPartnerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "referral_withholdings_sourceType_sourceId_level_key" ON "referral_withholdings"("sourceType", "sourceId", "level");

-- CreateIndex
CREATE UNIQUE INDEX "referral_withholding_recoveries_ledgerTransactionId_key" ON "referral_withholding_recoveries"("ledgerTransactionId");

-- CreateIndex
CREATE INDEX "referral_withholding_recoveries_withholdingId_idx" ON "referral_withholding_recoveries"("withholdingId");

-- CreateIndex
CREATE INDEX "referral_withholding_recoveries_bonusLotId_idx" ON "referral_withholding_recoveries"("bonusLotId");

-- CreateIndex
CREATE UNIQUE INDEX "partner_order_returns_shortfallRecoveryLedgerTransactionId_key" ON "partner_order_returns"("shortfallRecoveryLedgerTransactionId");

-- CreateIndex
CREATE INDEX "purchase_intent_refunds_status_createdAt_idx" ON "purchase_intent_refunds"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "partner_order_cancellations" ADD CONSTRAINT "partner_order_cancellations_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "partner_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_withholdings" ADD CONSTRAINT "referral_withholdings_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_withholding_recoveries" ADD CONSTRAINT "referral_withholding_recoveries_withholdingId_fkey" FOREIGN KEY ("withholdingId") REFERENCES "referral_withholdings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Backfill the Q9 breakdown on rows written before it existed ──────────
-- Every earlier return/refund moved its gross amounts with no netting, so
-- gross = net and nothing was recovered. (Legacy QR refunds: the cash share
-- the partner repaid outside TuTak is amount − bonus − TuTak money.)
UPDATE "partner_order_returns" SET
  "tutakMoneyGross" = "tutakMoneyRefunded",
  "externalRefundGross" = "externalRefundDue",
  "grossRefund" = "tutakMoneyRefunded" + "externalRefundDue",
  "netRefund" = "tutakMoneyRefunded" + "externalRefundDue";

UPDATE "purchase_intent_refunds" SET
  "cashRefundGross" = GREATEST("amount" - "bonusRestored" - "tutakMoneyRefunded", 0),
  "cashRefundNet" = GREATEST("amount" - "bonusRestored" - "tutakMoneyRefunded", 0),
  "grossRefund" = "tutakMoneyRefunded" + GREATEST("amount" - "bonusRestored" - "tutakMoneyRefunded", 0),
  "netRefund" = "tutakMoneyRefunded" + GREATEST("amount" - "bonusRestored" - "tutakMoneyRefunded", 0),
  "completedAt" = "createdAt";

-- ── Money invariants ─────────────────────────────────────────────────────

-- Item 8: a leg's returned and retained parts never exceed it, and the
-- discount is never kept as a cancellation cost.
ALTER TABLE "partner_order_payment_legs" DROP CONSTRAINT "partner_order_payment_legs_amounts_sane";
ALTER TABLE "partner_order_payment_legs"
  ADD CONSTRAINT "partner_order_payment_legs_amounts_sane" CHECK (
    "amount" > 0
    AND "refundedAmount" >= 0
    AND "retainedAmount" >= 0
    AND "refundedAmount" + "retainedAmount" <= "amount"
  ),
  ADD CONSTRAINT "partner_order_payment_legs_discount_never_retained" CHECK (
    "type" <> 'DISCOUNT' OR "retainedAmount" = 0
  );

-- Q13: what secured the prepayment at submit (a snapshot — a later accepted
-- price decrease does not rewrite it).
ALTER TABLE "partner_orders"
  ADD CONSTRAINT "partner_orders_prepayment_covered_sane" CHECK ("prepaymentCoveredAmount" >= 0);

-- Q9: gross, recovered and net are separate figures that always reconcile.
ALTER TABLE "partner_order_returns"
  ADD CONSTRAINT "partner_order_returns_breakdown_consistent" CHECK (
    "tutakMoneyGross" >= 0 AND "externalRefundGross" >= 0
    AND "shortfallFromMoney" >= 0 AND "shortfallFromExternal" >= 0 AND "shortfallCollected" >= 0
    AND "referralWithheld" >= 0 AND "expiredWrittenBack" >= 0 AND "revenueReversed" >= 0
    AND "shortfallFromMoney" = "tutakMoneyGross" - "tutakMoneyRefunded"
    AND "shortfallFromExternal" = "externalRefundGross" - "externalRefundDue"
    AND "grossRefund" = "tutakMoneyGross" + "externalRefundGross"
    AND "netRefund" = "tutakMoneyRefunded" + "externalRefundDue"
    AND "recoveredShortfall" = "shortfallFromMoney" + "shortfallFromExternal" + "shortfallCollected"
  ),
  -- Once executed, exactly the customer's shortfall was recovered — no
  -- more, no less, nothing left as a hidden debt.
  ADD CONSTRAINT "partner_order_returns_settled_shortfall_recovered" CHECK (
    "status" NOT IN ('COMPLETED', 'PENDING_EXTERNAL_REFUND') OR "recoveredShortfall" = "shortfallAmount"
  );

ALTER TABLE "purchase_intent_refunds"
  ADD CONSTRAINT "purchase_intent_refunds_breakdown_consistent" CHECK (
    "customerShortfall" >= 0 AND "shortfallFromMoney" >= 0 AND "shortfallFromCash" >= 0
    AND "shortfallCollected" >= 0 AND "cashRefundGross" >= 0 AND "cashRefundNet" >= 0
    AND "referralWithheld" >= 0 AND "expiredWrittenBack" >= 0 AND "revenueReversed" >= 0
    AND "shortfallFromCash" = "cashRefundGross" - "cashRefundNet"
    AND "grossRefund" = "tutakMoneyRefunded" + "shortfallFromMoney" + "cashRefundGross"
    AND "netRefund" = "tutakMoneyRefunded" + "cashRefundNet"
    AND "recoveredShortfall" = "shortfallFromMoney" + "shortfallFromCash" + "shortfallCollected"
  ),
  ADD CONSTRAINT "purchase_intent_refunds_completed_shortfall_recovered" CHECK (
    "status" <> 'COMPLETED' OR "recoveredShortfall" = "customerShortfall"
  );

-- Q8: a withholding only ever shrinks, and is SETTLED exactly when repaid.
ALTER TABLE "referral_withholdings"
  ADD CONSTRAINT "referral_withholdings_amounts_sane" CHECK (
    "amount" > 0
    AND "remainingAmount" >= 0
    AND "remainingAmount" <= "amount"
    AND "level" BETWEEN 1 AND 3
    AND (("status" = 'SETTLED') = ("remainingAmount" = 0))
  );

ALTER TABLE "referral_withholding_recoveries"
  ADD CONSTRAINT "referral_withholding_recoveries_amount_positive" CHECK ("amount" > 0);

ALTER TABLE "bonus_lots"
  ADD CONSTRAINT "bonus_lots_expired_written_back_non_negative" CHECK ("expiredWrittenBackAmount" >= 0);

-- Item 8: only an actual, positive claim; the approved cost never exceeds it
-- and is always fully accounted for by the real-money sources that fund it.
ALTER TABLE "partner_order_cancellations"
  ADD CONSTRAINT "partner_order_cancellations_amounts_sane" CHECK (
    ("claimedCostAmount" IS NULL OR "claimedCostAmount" > 0)
    AND "approvedCostAmount" >= 0
    AND "costFromExternal" >= 0
    AND "costFromMoney" >= 0
    AND "approvedCostAmount" = "costFromExternal" + "costFromMoney"
    AND "approvedCostAmount" <= COALESCE("claimedCostAmount", 0)
  );

-- At most one active cancellation request per order.
CREATE UNIQUE INDEX "partner_order_cancellations_one_active_per_order"
  ON "partner_order_cancellations" ("orderId")
  WHERE "status" IN ('AWAITING_PARTNER', 'COST_REVIEW');

-- Q9: at most one not-yet-executed refund per QR purchase — a second one
-- could otherwise compute its share from the same watermark.
CREATE UNIQUE INDEX "purchase_intent_refunds_one_open_per_intent"
  ON "purchase_intent_refunds" ("purchaseIntentId")
  WHERE "status" IN ('AWAITING_SHORTFALL_SETTLEMENT', 'MANUAL_REVIEW');
