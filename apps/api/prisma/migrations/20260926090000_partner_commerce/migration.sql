-- Partner Commerce (docs/PARTNER_COMMERCE.md) — one consolidated, purely
-- additive migration.
--
-- Supersedes the unreleased v1 migration `20260925173529_partner_commerce`,
-- which only ever existed on the feature branch and was never applied to any
-- shared database (staging and production both build from the default
-- branch). Folding v1 and v2 into one step means production receives a
-- single clean change instead of a v1 schema immediately reshaped by v2.
--
-- Nothing here drops, renames or rewrites an existing column. Existing rows
-- keep their meaning:
--   * partners.settlementPeriod      = BIWEEKLY (their existing 14-day cycle)
--   * partners.shiftsRequiredFrom    = migration time + 14 days (rollout
--                                      window); new partners: creation time
--   * purchase_intents.tutakMoneyAmount = 0, so for every existing row
--     ordinaryPaymentRemainder is still gross − bonus
--   * partner_branches.timezone/businessDayStartMinute = Asia/Yerevan, 05:00

-- CreateEnum
CREATE TYPE "PartnerOrderOperationalStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'SEEN', 'STOCK_CONFIRMED', 'HANDED_OVER', 'RECEIVED', 'COMPLETED', 'OUT_OF_STOCK', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PartnerOrderPaymentStatus" AS ENUM ('UNFUNDED', 'PARTIALLY_FUNDED', 'RESERVED', 'FUNDED', 'SETTLED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PartnerOrderSourcingStatus" AS ENUM ('NONE', 'REQUIRED', 'SEARCHING', 'AWAITING_CUSTOMER', 'RESOLVED', 'FAILED');

-- CreateEnum
CREATE TYPE "PartnerOrderDisputeStatus" AS ENUM ('NONE', 'OPEN', 'RESOLVED_CUSTOMER', 'RESOLVED_PARTNER', 'RESOLVED_SPLIT');

-- CreateEnum
CREATE TYPE "PartnerOrderActorType" AS ENUM ('CUSTOMER', 'PARTNER', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "PaymentLegType" AS ENUM ('DISCOUNT', 'TUTAK_MONEY', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "PaymentLegStatus" AS ENUM ('PENDING', 'CAPTURED', 'CONFIRMED', 'CORRECTED', 'SETTLED', 'RETURN_PENDING', 'RETURNED');

-- CreateEnum
CREATE TYPE "PaymentLegPurpose" AS ENUM ('ORDER', 'ADDITIONAL');

-- CreateEnum
CREATE TYPE "PrepaymentMode" AS ENUM ('PERCENT', 'FIXED');

-- CreateEnum
CREATE TYPE "PartnerOrderAdjustmentType" AS ENUM ('PRICE_DECREASE', 'PRICE_INCREASE', 'ALTERNATE_PRODUCT', 'SAME_ITEM_OTHER_SOURCE', 'SOURCING_FAILED_REFUND', 'OUT_OF_STOCK_REFUND');

-- CreateEnum
CREATE TYPE "PartnerOrderAdjustmentStatus" AS ENUM ('PENDING_CUSTOMER', 'CUSTOMER_ACCEPTED', 'CUSTOMER_DECLINED', 'APPLIED');

-- CreateEnum
CREATE TYPE "SourcingTaskStatus" AS ENUM ('OPEN', 'SEARCHING', 'FOUND_EXACT', 'FOUND_ALTERNATE', 'NOT_FOUND', 'RESOLVED');

-- CreateEnum
CREATE TYPE "SourcingResultSourceType" AS ENUM ('OTHER_TUTAK_PARTNER', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "OrderEscalationType" AS ENUM ('NOT_SEEN_5MIN', 'STOCK_NOT_CONFIRMED_30MIN', 'STOCK_NOT_CONFIRMED_REPEAT', 'RECEIPT_NOT_CONFIRMED_48H', 'PAYMENT_ISSUE');

-- CreateEnum
CREATE TYPE "PartnerOrderReturnStatus" AS ENUM ('PENDING_EXTERNAL_REFUND', 'COMPLETED', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "OrderDisputeType" AS ENUM ('ORDER', 'PAYMENT');

-- CreateEnum
CREATE TYPE "OrderDisputeStatus" AS ENUM ('OPEN', 'RESOLVED_CUSTOMER', 'RESOLVED_PARTNER', 'RESOLVED_SPLIT');

-- CreateEnum
CREATE TYPE "SettlementPeriod" AS ENUM ('DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "ShiftEndReason" AS ENUM ('MANUAL', 'NEW_BUSINESS_DAY', 'DEACTIVATED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_ORDER_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_ORDER_SUBMITTED';
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_ORDER_HANDED_OVER';
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_ORDER_RECEIVED';
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_ORDER_EXPIRED';
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_ORDER_MANUAL_REVIEW';
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_ORDER_EXTERNAL_PAYMENT_CONFIRMED';
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_ORDER_EXTERNAL_PAYMENT_CORRECTED';
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_ORDER_EXTERNAL_REFUND_CONFIRMED';
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_ORDER_RETURN_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_ORDER_RETURN_COMPLETED';
ALTER TYPE "AuditAction" ADD VALUE 'ORDER_DISPUTE_OPENED';
ALTER TYPE "AuditAction" ADD VALUE 'ORDER_DISPUTE_COMMENTED';
ALTER TYPE "AuditAction" ADD VALUE 'ORDER_DISPUTE_RESOLVED';
ALTER TYPE "AuditAction" ADD VALUE 'PREPAYMENT_RULE_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'PREPAYMENT_RULE_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_SETTLEMENT_PERIOD_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_SHIFTS_REQUIRED_FROM_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'SETTLEMENT_STATEMENT_GENERATED';
ALTER TYPE "AuditAction" ADD VALUE 'EMPLOYEE_SHIFT_STARTED';
ALTER TYPE "AuditAction" ADD VALUE 'EMPLOYEE_SHIFT_ENDED';
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_ORDER_SEEN';
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_ORDER_STOCK_CONFIRMED';
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_ORDER_STOCK_REJECTED';
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_ORDER_SOURCING_TASK_CLAIMED';
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_ORDER_SOURCING_RESULT_RECORDED';
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_ORDER_ADJUSTMENT_CUSTOMER_RESPONDED';
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_ORDER_ADDITIONAL_PAYMENT_PAID';
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_ORDER_REFUNDED';
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_ORDER_COMPLETED';
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_ORDER_CANCELLED';
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_ORDER_ESCALATION_RAISED';
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_ORDER_ESCALATION_CLAIMED';
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_ORDER_ESCALATION_RESOLVED';
ALTER TYPE "AuditAction" ADD VALUE 'COMMISSION_RULE_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'COMMISSION_RULE_UPDATED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LedgerAccountType" ADD VALUE 'PARTNER_ORDER_ESCROW';
ALTER TYPE "LedgerAccountType" ADD VALUE 'PARTNER_DISPUTE_HOLD';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PermissionName" ADD VALUE 'PARTNER_ORDER_MANAGE';
ALTER TYPE "PermissionName" ADD VALUE 'PARTNER_ORDER_OPERATE';
ALTER TYPE "PermissionName" ADD VALUE 'ORDER_DISPUTE_RESOLVE';

-- AlterTable
ALTER TABLE "partner_branches" ADD COLUMN     "businessDayStartMinute" INTEGER NOT NULL DEFAULT 300,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Asia/Yerevan';

-- AlterTable
ALTER TABLE "partners" ADD COLUMN     "allowExternalSourcing" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "settlementPeriod" "SettlementPeriod" NOT NULL DEFAULT 'BIWEEKLY',
ADD COLUMN     "shiftsRequiredFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "purchase_intent_refunds" ADD COLUMN     "moneyLedgerTransactionId" TEXT,
ADD COLUMN     "shiftId" TEXT,
ADD COLUMN     "tutakMoneyRefunded" DECIMAL(18,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "purchase_intents" ADD COLUMN     "confirmedShiftId" TEXT,
ADD COLUMN     "confirmedWithoutShift" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "moneyCaptureLedgerTransactionId" TEXT,
ADD COLUMN     "moneyReleaseLedgerTransactionId" TEXT,
ADD COLUMN     "moneyReturnLedgerTransactionId" TEXT,
ADD COLUMN     "rejectedByUserId" TEXT,
ADD COLUMN     "rejectedShiftId" TEXT,
ADD COLUMN     "tutakMoneyAmount" DECIMAL(18,4) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "partner_orders" (
    "id" TEXT NOT NULL,
    "orderNumber" SERIAL NOT NULL,
    "customerId" TEXT,
    "partnerId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "externalOrderId" TEXT NOT NULL,
    "branchId" TEXT,
    "serviceType" TEXT,
    "category" TEXT,
    "currency" "Currency" NOT NULL DEFAULT 'AMD',
    "subtotal" DECIMAL(18,4) NOT NULL,
    "totalAmount" DECIMAL(18,4) NOT NULL,
    "commissionRuleId" TEXT,
    "commissionRateBps" INTEGER NOT NULL,
    "commissionAmount" DECIMAL(18,4) NOT NULL,
    "sourcingAllowed" BOOLEAN NOT NULL,
    "discountAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "tutakMoneyAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "externalAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "prepaymentRuleId" TEXT,
    "prepaymentRequiredAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "refundedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "operationalStatus" "PartnerOrderOperationalStatus" NOT NULL DEFAULT 'DRAFT',
    "paymentStatus" "PartnerOrderPaymentStatus" NOT NULL DEFAULT 'UNFUNDED',
    "sourcingStatus" "PartnerOrderSourcingStatus" NOT NULL DEFAULT 'NONE',
    "disputeStatus" "PartnerOrderDisputeStatus" NOT NULL DEFAULT 'NONE',
    "poolAmount" DECIMAL(18,4),
    "greenAmount" DECIMAL(18,4),
    "deferredAmount" DECIMAL(18,4),
    "programVersion" "ReferralProgramVersion",
    "referrer1Type" "ReferrerType",
    "referrer1UserId" TEXT,
    "referrer1PartnerId" TEXT,
    "referrer1Amount" DECIMAL(18,4),
    "referrer2Type" "ReferrerType",
    "referrer2UserId" TEXT,
    "referrer2PartnerId" TEXT,
    "referrer2Amount" DECIMAL(18,4),
    "referrer3Type" "ReferrerType",
    "referrer3UserId" TEXT,
    "referrer3PartnerId" TEXT,
    "referrer3Amount" DECIMAL(18,4),
    "tutakAmount" DECIMAL(18,4),
    "sourceTransactionId" TEXT,
    "completionLedgerTransactionId" TEXT,
    "submitIdempotencyKey" TEXT,
    "partnerSeenByUserId" TEXT,
    "stockConfirmedByUserId" TEXT,
    "stockRejectedByUserId" TEXT,
    "handedOverByUserId" TEXT,
    "rejectionReason" TEXT,
    "cancelledByType" "PartnerOrderActorType",
    "cancelledByUserId" TEXT,
    "cancelledReason" TEXT,
    "manualReviewReason" TEXT,
    "notSeenAlertSentAt" TIMESTAMP(3),
    "stockAlertLastSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "draftExpiresAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "partnerSeenAt" TIMESTAMP(3),
    "stockConfirmedAt" TIMESTAMP(3),
    "stockRejectedAt" TIMESTAMP(3),
    "handedOverAt" TIMESTAMP(3),
    "customerReceivedAt" TIMESTAMP(3),
    "receiptReminderSentAt" TIMESTAMP(3),
    "manualReviewAt" TIMESTAMP(3),
    "paymentIssueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_order_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "externalProductId" TEXT,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "oemNumber" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "totalPrice" DECIMAL(18,4) NOT NULL,
    "imageUrl" TEXT,
    "description" TEXT,
    "metadata" JSONB,

    CONSTRAINT "partner_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_order_payment_legs" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" "PaymentLegType" NOT NULL,
    "purpose" "PaymentLegPurpose" NOT NULL DEFAULT 'ORDER',
    "status" "PaymentLegStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(18,4) NOT NULL,
    "adjustmentId" TEXT,
    "refundedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "bonusReservationId" TEXT,
    "captureLedgerTransactionId" TEXT,
    "returnLedgerTransactionId" TEXT,
    "confirmedByUserId" TEXT,
    "confirmedShiftId" TEXT,
    "confirmedBranchId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "correctedByUserId" TEXT,
    "correctedShiftId" TEXT,
    "correctedAt" TIMESTAMP(3),
    "correctionReason" TEXT,
    "returnConfirmedByUserId" TEXT,
    "returnConfirmedShiftId" TEXT,
    "returnConfirmedAt" TIMESTAMP(3),
    "capturedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_order_payment_legs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_rules" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "serviceType" TEXT,
    "category" TEXT,
    "name" TEXT NOT NULL,
    "rateBps" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prepayment_rules" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "serviceType" TEXT,
    "category" TEXT,
    "mode" "PrepaymentMode" NOT NULL,
    "percentBps" INTEGER,
    "fixedAmount" DECIMAL(18,4),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prepayment_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_order_adjustments" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" "PartnerOrderAdjustmentType" NOT NULL,
    "status" "PartnerOrderAdjustmentStatus" NOT NULL DEFAULT 'PENDING_CUSTOMER',
    "previousTotalAmount" DECIMAL(18,4) NOT NULL,
    "newTotalAmount" DECIMAL(18,4) NOT NULL,
    "deltaAmount" DECIMAL(18,4) NOT NULL,
    "description" TEXT,
    "details" JSONB,
    "imageUrl" TEXT,
    "reason" TEXT,
    "customerRespondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "partner_order_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sourcing_tasks" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "SourcingTaskStatus" NOT NULL DEFAULT 'OPEN',
    "assignedToUserId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "resultSourceType" "SourcingResultSourceType",
    "resultSourcePartnerId" TEXT,
    "resultProductName" TEXT,
    "resultDescription" TEXT,
    "resultImageUrl" TEXT,
    "resultPrice" DECIMAL(18,4),
    "resultNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "sourcing_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_escalations" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" "OrderEscalationType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedByUserId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "metadata" JSONB,

    CONSTRAINT "order_escalations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_order_returns" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "PartnerOrderReturnStatus" NOT NULL,
    "origin" "PartnerOrderActorType" NOT NULL,
    "disputeId" TEXT,
    "discountRestored" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "tutakMoneyRefunded" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "externalRefundDue" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "poolReversed" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "shortfallAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "manualReviewReason" TEXT,
    "contributionReversalLedgerTransactionId" TEXT,
    "moneyRefundLedgerTransactionId" TEXT,
    "discountRefundLedgerTransactionId" TEXT,
    "requestedByUserId" TEXT NOT NULL,
    "requestedShiftId" TEXT,
    "externalRefundConfirmedByUserId" TEXT,
    "externalRefundConfirmedShiftId" TEXT,
    "externalRefundConfirmedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "partner_order_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_disputes" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" "OrderDisputeType" NOT NULL,
    "status" "OrderDisputeStatus" NOT NULL DEFAULT 'OPEN',
    "reason" TEXT NOT NULL,
    "description" TEXT,
    "openedByUserId" TEXT NOT NULL,
    "openedByType" "PartnerOrderActorType" NOT NULL,
    "disputedAmount" DECIMAL(18,4) NOT NULL,
    "openedAfterSettlement" BOOLEAN NOT NULL,
    "frozenAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "holdLedgerTransactionId" TEXT,
    "releaseLedgerTransactionId" TEXT,
    "customerRefundAmount" DECIMAL(18,4),
    "resolutionNote" TEXT,
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_dispute_comments" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "authorType" "PartnerOrderActorType" NOT NULL,
    "body" TEXT NOT NULL,
    "attachmentUrls" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_dispute_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_settlement_statements" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "period" "SettlementPeriod" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "openingBalance" DECIMAL(18,4) NOT NULL,
    "closingBalance" DECIMAL(18,4) NOT NULL,
    "frozenBalance" DECIMAL(18,4) NOT NULL,
    "totalsByKind" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_settlement_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_settlement_statement_lines" (
    "id" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "postingId" TEXT NOT NULL,
    "ledgerTransactionId" TEXT NOT NULL,
    "accountType" "LedgerAccountType" NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "signedAmount" DECIMAL(18,4) NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_settlement_statement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_shifts" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endReason" "ShiftEndReason",
    "endedByUserId" TEXT,

    CONSTRAINT "employee_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "partner_orders_orderNumber_key" ON "partner_orders"("orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "partner_orders_sourceTransactionId_key" ON "partner_orders"("sourceTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "partner_orders_completionLedgerTransactionId_key" ON "partner_orders"("completionLedgerTransactionId");

-- CreateIndex
CREATE INDEX "partner_orders_partnerId_operationalStatus_idx" ON "partner_orders"("partnerId", "operationalStatus");

-- CreateIndex
CREATE INDEX "partner_orders_customerId_createdAt_idx" ON "partner_orders"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "partner_orders_operationalStatus_submittedAt_idx" ON "partner_orders"("operationalStatus", "submittedAt");

-- CreateIndex
CREATE INDEX "partner_orders_operationalStatus_draftExpiresAt_idx" ON "partner_orders"("operationalStatus", "draftExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "partner_orders_integrationId_externalOrderId_key" ON "partner_orders"("integrationId", "externalOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "partner_orders_customerId_submitIdempotencyKey_key" ON "partner_orders"("customerId", "submitIdempotencyKey");

-- CreateIndex
CREATE INDEX "partner_order_items_orderId_idx" ON "partner_order_items"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "partner_order_payment_legs_captureLedgerTransactionId_key" ON "partner_order_payment_legs"("captureLedgerTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "partner_order_payment_legs_returnLedgerTransactionId_key" ON "partner_order_payment_legs"("returnLedgerTransactionId");

-- CreateIndex
CREATE INDEX "partner_order_payment_legs_orderId_type_idx" ON "partner_order_payment_legs"("orderId", "type");

-- CreateIndex
CREATE INDEX "partner_order_payment_legs_type_status_idx" ON "partner_order_payment_legs"("type", "status");

-- CreateIndex
CREATE INDEX "commission_rules_partnerId_isActive_idx" ON "commission_rules"("partnerId", "isActive");

-- CreateIndex
CREATE INDEX "prepayment_rules_partnerId_isActive_idx" ON "prepayment_rules"("partnerId", "isActive");

-- CreateIndex
CREATE INDEX "partner_order_adjustments_orderId_idx" ON "partner_order_adjustments"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "sourcing_tasks_orderId_key" ON "sourcing_tasks"("orderId");

-- CreateIndex
CREATE INDEX "sourcing_tasks_status_createdAt_idx" ON "sourcing_tasks"("status", "createdAt");

-- CreateIndex
CREATE INDEX "order_escalations_orderId_type_idx" ON "order_escalations"("orderId", "type");

-- CreateIndex
CREATE INDEX "order_escalations_resolvedAt_createdAt_idx" ON "order_escalations"("resolvedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "partner_order_returns_contributionReversalLedgerTransaction_key" ON "partner_order_returns"("contributionReversalLedgerTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "partner_order_returns_moneyRefundLedgerTransactionId_key" ON "partner_order_returns"("moneyRefundLedgerTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "partner_order_returns_discountRefundLedgerTransactionId_key" ON "partner_order_returns"("discountRefundLedgerTransactionId");

-- CreateIndex
CREATE INDEX "partner_order_returns_orderId_idx" ON "partner_order_returns"("orderId");

-- CreateIndex
CREATE INDEX "partner_order_returns_status_createdAt_idx" ON "partner_order_returns"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "partner_order_returns_requestedByUserId_idempotencyKey_key" ON "partner_order_returns"("requestedByUserId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "order_disputes_holdLedgerTransactionId_key" ON "order_disputes"("holdLedgerTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "order_disputes_releaseLedgerTransactionId_key" ON "order_disputes"("releaseLedgerTransactionId");

-- CreateIndex
CREATE INDEX "order_disputes_status_createdAt_idx" ON "order_disputes"("status", "createdAt");

-- CreateIndex
CREATE INDEX "order_disputes_orderId_idx" ON "order_disputes"("orderId");

-- CreateIndex
CREATE INDEX "order_dispute_comments_disputeId_createdAt_idx" ON "order_dispute_comments"("disputeId", "createdAt");

-- CreateIndex
CREATE INDEX "partner_settlement_statements_partnerId_periodEnd_idx" ON "partner_settlement_statements"("partnerId", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "partner_settlement_statements_partnerId_periodStart_key" ON "partner_settlement_statements"("partnerId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "partner_settlement_statement_lines_postingId_key" ON "partner_settlement_statement_lines"("postingId");

-- CreateIndex
CREATE INDEX "partner_settlement_statement_lines_statementId_idx" ON "partner_settlement_statement_lines"("statementId");

-- CreateIndex
CREATE INDEX "partner_settlement_statement_lines_sourceType_sourceId_idx" ON "partner_settlement_statement_lines"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "employee_shifts_branchId_endedAt_idx" ON "employee_shifts"("branchId", "endedAt");

-- CreateIndex
CREATE INDEX "employee_shifts_userId_endedAt_idx" ON "employee_shifts"("userId", "endedAt");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_intent_refunds_moneyLedgerTransactionId_key" ON "purchase_intent_refunds"("moneyLedgerTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_intents_moneyCaptureLedgerTransactionId_key" ON "purchase_intents"("moneyCaptureLedgerTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_intents_moneyReleaseLedgerTransactionId_key" ON "purchase_intents"("moneyReleaseLedgerTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_intents_moneyReturnLedgerTransactionId_key" ON "purchase_intents"("moneyReturnLedgerTransactionId");

-- AddForeignKey
ALTER TABLE "partner_orders" ADD CONSTRAINT "partner_orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_orders" ADD CONSTRAINT "partner_orders_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_orders" ADD CONSTRAINT "partner_orders_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "partner_integrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_orders" ADD CONSTRAINT "partner_orders_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "partner_branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_orders" ADD CONSTRAINT "partner_orders_commissionRuleId_fkey" FOREIGN KEY ("commissionRuleId") REFERENCES "commission_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_orders" ADD CONSTRAINT "partner_orders_prepaymentRuleId_fkey" FOREIGN KEY ("prepaymentRuleId") REFERENCES "prepayment_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_order_items" ADD CONSTRAINT "partner_order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "partner_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_order_payment_legs" ADD CONSTRAINT "partner_order_payment_legs_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "partner_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_order_payment_legs" ADD CONSTRAINT "partner_order_payment_legs_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "partner_order_adjustments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_order_payment_legs" ADD CONSTRAINT "partner_order_payment_legs_confirmedShiftId_fkey" FOREIGN KEY ("confirmedShiftId") REFERENCES "employee_shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_order_payment_legs" ADD CONSTRAINT "partner_order_payment_legs_correctedShiftId_fkey" FOREIGN KEY ("correctedShiftId") REFERENCES "employee_shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_order_payment_legs" ADD CONSTRAINT "partner_order_payment_legs_returnConfirmedShiftId_fkey" FOREIGN KEY ("returnConfirmedShiftId") REFERENCES "employee_shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prepayment_rules" ADD CONSTRAINT "prepayment_rules_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_order_adjustments" ADD CONSTRAINT "partner_order_adjustments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "partner_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sourcing_tasks" ADD CONSTRAINT "sourcing_tasks_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "partner_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sourcing_tasks" ADD CONSTRAINT "sourcing_tasks_resultSourcePartnerId_fkey" FOREIGN KEY ("resultSourcePartnerId") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_escalations" ADD CONSTRAINT "order_escalations_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "partner_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_order_returns" ADD CONSTRAINT "partner_order_returns_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "partner_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_order_returns" ADD CONSTRAINT "partner_order_returns_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "order_disputes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_disputes" ADD CONSTRAINT "order_disputes_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "partner_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_dispute_comments" ADD CONSTRAINT "order_dispute_comments_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "order_disputes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_settlement_statements" ADD CONSTRAINT "partner_settlement_statements_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_settlement_statement_lines" ADD CONSTRAINT "partner_settlement_statement_lines_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "partner_settlement_statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_shifts" ADD CONSTRAINT "employee_shifts_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_shifts" ADD CONSTRAINT "employee_shifts_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "partner_branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_shifts" ADD CONSTRAINT "employee_shifts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Rollout of mandatory employee shifts (Q4) ───────────────────────────
-- Every partner that exists right now gets a one-off 14-day window; the
-- column default (CURRENT_TIMESTAMP) applies to every partner created later.
UPDATE "partners" SET "shiftsRequiredFrom" = CURRENT_TIMESTAMP + INTERVAL '14 days';

-- ── Money and state invariants enforced by the database ──────────────────
-- Same discipline as 20260806150000_harden_money_invariants: DTO validation
-- and service-layer guards are not the last line of defence for money.

ALTER TABLE "partner_branches"
  ADD CONSTRAINT "partner_branches_business_day_start_bounded" CHECK (
    "businessDayStartMinute" >= 0 AND "businessDayStartMinute" < 1440
  );

-- NOT VALID: enforced for every row written from now on, without rescanning
-- the existing purchase history (every existing row has tutakMoneyAmount = 0
-- and ordinaryPaymentRemainder = gross − bonus by construction).
ALTER TABLE "purchase_intents"
  ADD CONSTRAINT "purchase_intents_payment_split_sums_to_gross" CHECK (
    "tutakMoneyAmount" >= 0
    AND "bonusAmountRequested" + "tutakMoneyAmount" + "ordinaryPaymentRemainder" = "grossAmount"
  ) NOT VALID;

ALTER TABLE "purchase_intent_refunds"
  ADD CONSTRAINT "purchase_intent_refunds_money_non_negative" CHECK ("tutakMoneyRefunded" >= 0);

ALTER TABLE "partner_orders"
  ADD CONSTRAINT "partner_orders_amounts_sane" CHECK (
    "subtotal" >= 0
    AND "totalAmount" >= 0
    AND "commissionAmount" >= 0
    AND "commissionAmount" <= "totalAmount"
    AND "discountAmount" >= 0
    AND "tutakMoneyAmount" >= 0
    AND "externalAmount" >= 0
    AND "prepaymentRequiredAmount" >= 0
    AND "prepaymentRequiredAmount" <= "totalAmount"
    AND "refundedAmount" >= 0
    AND "refundedAmount" <= "totalAmount"
  ),
  -- Once the customer has confirmed the order, the three sources always add
  -- up to exactly the commission base (spec §10.1, Q1).
  ADD CONSTRAINT "partner_orders_split_sums_to_total" CHECK (
    "submittedAt" IS NULL
    OR "discountAmount" + "tutakMoneyAmount" + "externalAmount" = "totalAmount"
  ),
  -- Q11 (pending): AMD only — never BONUS_POINT, never an unconverted USD.
  ADD CONSTRAINT "partner_orders_currency_amd" CHECK ("currency" = 'AMD'),
  -- Same fixed rate card as partners.bonusAccrualRateBps.
  ADD CONSTRAINT "partner_orders_commission_rate_on_grid" CHECK (
    "commissionRateBps" >= 50 AND "commissionRateBps" <= 2000 AND "commissionRateBps" % 50 = 0
  );

ALTER TABLE "partner_order_items"
  ADD CONSTRAINT "partner_order_items_amounts_sane" CHECK (
    "quantity" > 0 AND "unitPrice" >= 0 AND "totalPrice" >= 0
  );

ALTER TABLE "partner_order_payment_legs"
  ADD CONSTRAINT "partner_order_payment_legs_amounts_sane" CHECK (
    "amount" > 0 AND "refundedAmount" >= 0 AND "refundedAmount" <= "amount"
  );

ALTER TABLE "commission_rules"
  ADD CONSTRAINT "commission_rules_rate_on_grid" CHECK (
    "rateBps" >= 50 AND "rateBps" <= 2000 AND "rateBps" % 50 = 0
  ),
  -- An override always narrows something; the partner-wide rate is
  -- partners.bonusAccrualRateBps and nothing else (Q5, E4).
  ADD CONSTRAINT "commission_rules_scoped" CHECK (
    "serviceType" IS NOT NULL OR "category" IS NOT NULL
  );

-- One active override per (partner, serviceType, category) — so resolution
-- can never find two competing rates for the same order.
CREATE UNIQUE INDEX "commission_rules_one_active_per_scope"
  ON "commission_rules" ("partnerId", COALESCE("serviceType", ''), COALESCE("category", ''))
  WHERE "isActive";

ALTER TABLE "prepayment_rules"
  ADD CONSTRAINT "prepayment_rules_mode_consistent" CHECK (
    ("mode" = 'PERCENT' AND "percentBps" BETWEEN 1 AND 10000 AND "fixedAmount" IS NULL)
    OR ("mode" = 'FIXED' AND "fixedAmount" > 0 AND "percentBps" IS NULL)
  );

CREATE UNIQUE INDEX "prepayment_rules_one_active_per_scope"
  ON "prepayment_rules" ("partnerId", COALESCE("serviceType", ''), COALESCE("category", ''))
  WHERE "isActive";

ALTER TABLE "partner_order_adjustments"
  ADD CONSTRAINT "partner_order_adjustments_amounts_sane" CHECK (
    "previousTotalAmount" >= 0
    AND "newTotalAmount" >= 0
    AND "deltaAmount" = "newTotalAmount" - "previousTotalAmount"
  );

ALTER TABLE "sourcing_tasks"
  ADD CONSTRAINT "sourcing_tasks_result_price_non_negative" CHECK (
    "resultPrice" IS NULL OR "resultPrice" >= 0
  );

ALTER TABLE "partner_order_returns"
  ADD CONSTRAINT "partner_order_returns_amounts_sane" CHECK (
    "amount" > 0
    AND "discountRestored" >= 0
    AND "tutakMoneyRefunded" >= 0
    AND "externalRefundDue" >= 0
    AND "poolReversed" >= 0
    AND "shortfallAmount" >= 0
  );

ALTER TABLE "order_disputes"
  ADD CONSTRAINT "order_disputes_amounts_sane" CHECK (
    "disputedAmount" > 0
    AND "frozenAmount" >= 0
    AND ("customerRefundAmount" IS NULL OR "customerRefundAmount" >= 0)
  );

-- At most one OPEN dispute per order: two admins, or a customer and a
-- partner, can never race two holds onto the same order.
CREATE UNIQUE INDEX "order_disputes_one_open_per_order"
  ON "order_disputes" ("orderId")
  WHERE "status" = 'OPEN';

-- At most one open shift per employee (several employees per branch are
-- fine — Q4).
CREATE UNIQUE INDEX "employee_shifts_one_open_per_user"
  ON "employee_shifts" ("userId")
  WHERE "endedAt" IS NULL;

ALTER TABLE "employee_shifts"
  ADD CONSTRAINT "employee_shifts_end_consistent" CHECK (
    ("endedAt" IS NULL AND "endReason" IS NULL)
    OR ("endedAt" IS NOT NULL AND "endReason" IS NOT NULL AND "endedAt" >= "startedAt")
  );

ALTER TABLE "partner_settlement_statements"
  ADD CONSTRAINT "partner_settlement_statements_period_ordered" CHECK ("periodEnd" > "periodStart");
