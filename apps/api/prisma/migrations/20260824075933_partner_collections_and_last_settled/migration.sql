-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_COLLECTION_RECORDED';

-- AlterTable
ALTER TABLE "partners" ADD COLUMN     "lastSettledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "partner_collections" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'AMD',
    "bankReference" TEXT NOT NULL,
    "ledgerTransactionId" TEXT,
    "recordedByUserId" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_collections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "partner_collections_ledgerTransactionId_key" ON "partner_collections"("ledgerTransactionId");

-- CreateIndex
CREATE INDEX "partner_collections_partnerId_createdAt_idx" ON "partner_collections"("partnerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "partner_collections_recordedByUserId_idempotencyKey_key" ON "partner_collections"("recordedByUserId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "partner_collections" ADD CONSTRAINT "partner_collections_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_collections" ADD CONSTRAINT "partner_collections_ledgerTransactionId_fkey" FOREIGN KEY ("ledgerTransactionId") REFERENCES "ledger_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
