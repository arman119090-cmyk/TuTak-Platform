-- CreateEnum
CREATE TYPE "PartnerOrderPaymentStatus" AS ENUM ('PAYMENT_PENDING', 'PAID', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "PartnerOrderStatus" AS ENUM ('CREATED', 'PAID', 'PARTNER_SEEN', 'STOCK_CONFIRMED', 'OUT_OF_STOCK', 'SOURCING_REQUIRED', 'SOURCING_IN_PROGRESS', 'CUSTOMER_DECISION_REQUIRED', 'ACCEPTED', 'PREPARING', 'READY', 'SHIPPED', 'PICKUP_READY', 'COMPLETED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PartnerOrderAdjustmentType" AS ENUM ('PRICE_DECREASE', 'PRICE_INCREASE', 'ALTERNATE_PRODUCT', 'SOURCING_FAILED_REFUND', 'OUT_OF_STOCK_REFUND');

-- CreateEnum
CREATE TYPE "PartnerOrderAdjustmentStatus" AS ENUM ('PENDING_CUSTOMER', 'CUSTOMER_ACCEPTED', 'CUSTOMER_DECLINED', 'APPLIED');

-- CreateEnum
CREATE TYPE "SourcingTaskStatus" AS ENUM ('OPEN', 'SEARCHING', 'FOUND_EXACT', 'FOUND_ALTERNATE', 'NOT_FOUND', 'RESOLVED');

-- CreateEnum
CREATE TYPE "SourcingResultSourceType" AS ENUM ('OTHER_TUTAK_PARTNER', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "OrderEscalationType" AS ENUM ('NOT_SEEN_5MIN', 'STOCK_NOT_CONFIRMED_30MIN', 'STOCK_NOT_CONFIRMED_REPEAT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_ORDER_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_ORDER_PAID';
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
ALTER TYPE "LedgerAccountType" ADD VALUE 'PARTNER_ORDER_ESCROW';

-- AlterEnum
ALTER TYPE "PermissionName" ADD VALUE 'PARTNER_ORDER_MANAGE';

-- AlterTable
ALTER TABLE "partners" ADD COLUMN     "allowExternalSourcing" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "partner_orders" (
    "id" TEXT NOT NULL,
    "orderNumber" SERIAL NOT NULL,
    "customerId" TEXT,
    "partnerId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "externalOrderId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'AMD',
    "subtotal" DECIMAL(18,4) NOT NULL,
    "totalAmount" DECIMAL(18,4) NOT NULL,
    "commissionRuleId" TEXT,
    "commissionRateBps" INTEGER NOT NULL,
    "commissionAmount" DECIMAL(18,4) NOT NULL,
    "partnerAmount" DECIMAL(18,4) NOT NULL,
    "paymentStatus" "PartnerOrderPaymentStatus" NOT NULL DEFAULT 'PAYMENT_PENDING',
    "orderStatus" "PartnerOrderStatus" NOT NULL DEFAULT 'CREATED',
    "sourcingAllowed" BOOLEAN NOT NULL,
    "refundedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "captureLedgerTransactionId" TEXT,
    "settlementLedgerTransactionId" TEXT,
    "refundLedgerTransactionId" TEXT,
    "partnerSeenByUserId" TEXT,
    "stockConfirmedByUserId" TEXT,
    "stockRejectedByUserId" TEXT,
    "rejectionReason" TEXT,
    "cancelledReason" TEXT,
    "notSeenAlertSentAt" TIMESTAMP(3),
    "stockAlertLastSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "partnerSeenAt" TIMESTAMP(3),
    "stockConfirmedAt" TIMESTAMP(3),
    "stockRejectedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
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
CREATE TABLE "commission_rules" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT,
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
CREATE TABLE "partner_order_adjustments" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" "PartnerOrderAdjustmentType" NOT NULL,
    "status" "PartnerOrderAdjustmentStatus" NOT NULL DEFAULT 'PENDING_CUSTOMER',
    "previousTotalAmount" DECIMAL(18,4) NOT NULL,
    "newTotalAmount" DECIMAL(18,4) NOT NULL,
    "deltaAmount" DECIMAL(18,4) NOT NULL,
    "description" TEXT,
    "reason" TEXT,
    "customerRespondedAt" TIMESTAMP(3),
    "additionalPaymentStatus" "PartnerOrderPaymentStatus",
    "ledgerTransactionId" TEXT,
    "idempotencyKey" TEXT,
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

-- CreateIndex
CREATE UNIQUE INDEX "partner_orders_orderNumber_key" ON "partner_orders"("orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "partner_orders_captureLedgerTransactionId_key" ON "partner_orders"("captureLedgerTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "partner_orders_settlementLedgerTransactionId_key" ON "partner_orders"("settlementLedgerTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "partner_orders_refundLedgerTransactionId_key" ON "partner_orders"("refundLedgerTransactionId");

-- CreateIndex
CREATE INDEX "partner_orders_partnerId_orderStatus_idx" ON "partner_orders"("partnerId", "orderStatus");

-- CreateIndex
CREATE INDEX "partner_orders_customerId_createdAt_idx" ON "partner_orders"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "partner_orders_orderStatus_createdAt_idx" ON "partner_orders"("orderStatus", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "partner_orders_integrationId_externalOrderId_key" ON "partner_orders"("integrationId", "externalOrderId");

-- CreateIndex
CREATE INDEX "partner_order_items_orderId_idx" ON "partner_order_items"("orderId");

-- CreateIndex
CREATE INDEX "commission_rules_partnerId_category_isActive_idx" ON "commission_rules"("partnerId", "category", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "partner_order_adjustments_ledgerTransactionId_key" ON "partner_order_adjustments"("ledgerTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "partner_order_adjustments_idempotencyKey_key" ON "partner_order_adjustments"("idempotencyKey");

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

-- AddForeignKey
ALTER TABLE "partner_orders" ADD CONSTRAINT "partner_orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_orders" ADD CONSTRAINT "partner_orders_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_orders" ADD CONSTRAINT "partner_orders_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "partner_integrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_orders" ADD CONSTRAINT "partner_orders_commissionRuleId_fkey" FOREIGN KEY ("commissionRuleId") REFERENCES "commission_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_orders" ADD CONSTRAINT "partner_orders_captureLedgerTransactionId_fkey" FOREIGN KEY ("captureLedgerTransactionId") REFERENCES "ledger_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_orders" ADD CONSTRAINT "partner_orders_settlementLedgerTransactionId_fkey" FOREIGN KEY ("settlementLedgerTransactionId") REFERENCES "ledger_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_orders" ADD CONSTRAINT "partner_orders_refundLedgerTransactionId_fkey" FOREIGN KEY ("refundLedgerTransactionId") REFERENCES "ledger_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_order_items" ADD CONSTRAINT "partner_order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "partner_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_order_adjustments" ADD CONSTRAINT "partner_order_adjustments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "partner_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_order_adjustments" ADD CONSTRAINT "partner_order_adjustments_ledgerTransactionId_fkey" FOREIGN KEY ("ledgerTransactionId") REFERENCES "ledger_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sourcing_tasks" ADD CONSTRAINT "sourcing_tasks_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "partner_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sourcing_tasks" ADD CONSTRAINT "sourcing_tasks_resultSourcePartnerId_fkey" FOREIGN KEY ("resultSourcePartnerId") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_escalations" ADD CONSTRAINT "order_escalations_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "partner_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Money invariants enforced by the database ────────────────────────────
-- Same discipline as 20260806150000_harden_money_invariants: DTO validation
-- and service-layer guards are not the last line of defence for money.

ALTER TABLE "partner_orders"
  ADD CONSTRAINT "partner_orders_amounts_sane" CHECK (
    "subtotal" >= 0
    AND "totalAmount" >= 0
    AND "commissionAmount" >= 0
    AND "commissionAmount" <= "totalAmount"
    AND "partnerAmount" >= 0
    AND "partnerAmount" = "totalAmount" - "commissionAmount"
    AND "refundedAmount" >= 0
    AND "refundedAmount" <= "totalAmount"
  );

ALTER TABLE "partner_orders"
  ADD CONSTRAINT "partner_orders_commission_rate_bounded" CHECK (
    "commissionRateBps" >= 0 AND "commissionRateBps" <= 10000
  );

ALTER TABLE "partner_order_items"
  ADD CONSTRAINT "partner_order_items_amounts_sane" CHECK (
    "quantity" > 0 AND "unitPrice" >= 0 AND "totalPrice" >= 0
  );

ALTER TABLE "commission_rules"
  ADD CONSTRAINT "commission_rules_rate_bounded" CHECK (
    "rateBps" >= 0 AND "rateBps" <= 10000
  );

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
