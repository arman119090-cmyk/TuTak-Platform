-- Business decision (2026-08-18): FastCharge/EV settles like every other
-- purchase now, not as its own flat-rate special case. These snapshot
-- columns record the pool split `EvSessionsService.stopOnce` actually
-- posted, mirroring `purchase_intents`' own `poolAmount`/`greenAmount`/
-- `deferredAmount`/`referrerAmount` columns, so a later CDR correction
-- reverses the historical allocation rather than recomputing bps from
-- whatever `purchasePolicy` says today.
ALTER TABLE "ev_sessions" ADD COLUMN "poolAmount" DECIMAL(18,4);
ALTER TABLE "ev_sessions" ADD COLUMN "tutakUpfrontAmount" DECIMAL(18,4);
ALTER TABLE "ev_sessions" ADD COLUMN "greenAmount" DECIMAL(18,4);
ALTER TABLE "ev_sessions" ADD COLUMN "deferredAmount" DECIMAL(18,4);
ALTER TABLE "ev_sessions" ADD COLUMN "referrerAmount" DECIMAL(18,4);
