-- CreateTable
CREATE TABLE "encryption_key_rotations" (
    "id" UUID NOT NULL,
    "activeKeyId" TEXT NOT NULL,
    "dryRun" BOOLEAN NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "startedByAdminId" UUID,
    "counts" JSONB,
    "lastError" TEXT,

    CONSTRAINT "encryption_key_rotations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "encryption_key_rotations_startedAt_idx" ON "encryption_key_rotations"("startedAt");

