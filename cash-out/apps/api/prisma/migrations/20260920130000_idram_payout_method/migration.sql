-- AlterEnum
ALTER TYPE "PayoutMethodKind" ADD VALUE IF NOT EXISTS 'IDRAM';

-- AlterTable
ALTER TABLE "payout_methods" ADD COLUMN "holderName" TEXT,
ADD COLUMN "verifiedAt" TIMESTAMP(3);
