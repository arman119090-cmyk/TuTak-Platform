-- Durable alert delivery (audit 22.09.2026, D05).
--
-- Expand-only: one new enum, one new table, nothing existing is touched, so
-- the deployed code (which never reads either) keeps working during the
-- rollout and a rollback needs no down-migration.

CREATE TYPE "AlertDeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'UNDELIVERABLE');

CREATE TABLE "alert_outbox_events" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "context" JSONB,
    "status" "AlertDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "lastError" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alert_outbox_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "alert_outbox_events_status_nextAttemptAt_idx" ON "alert_outbox_events"("status", "nextAttemptAt");
CREATE INDEX "alert_outbox_events_key_idx" ON "alert_outbox_events"("key");
