-- AlterTable
ALTER TABLE "partners" ADD COLUMN     "about" TEXT;

-- CreateTable
CREATE TABLE "partner_offering_items" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(18,4) NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_offering_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "partner_offering_items_partnerId_idx" ON "partner_offering_items"("partnerId");

-- AddForeignKey
ALTER TABLE "partner_offering_items" ADD CONSTRAINT "partner_offering_items_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;
