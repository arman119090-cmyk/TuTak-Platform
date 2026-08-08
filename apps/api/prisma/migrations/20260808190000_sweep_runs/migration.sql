-- Records when each recurring sweep last completed.
--
-- In Postgres rather than Redis on purpose: the failure this exists to detect
-- is Redis losing state. BullMQ keeps repeatable-job definitions there, so a
-- restart, an eviction or a failover silently removes the entire schedule and
-- every sweep stops without anything failing. Keeping the evidence in the
-- store that can lose it would hide the outage in exactly the case that
-- matters.
CREATE TABLE "sweep_runs" (
    "name" TEXT NOT NULL,
    "lastSuccessAt" TIMESTAMP(3) NOT NULL,
    "lastDurationMs" INTEGER NOT NULL,
    "didWork" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "sweep_runs_pkey" PRIMARY KEY ("name")
);
