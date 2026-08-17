-- Independent audit, GitHub issue #28: `EvCdrReconciliationService` had no
-- per-row claim before doing money work. Its only concurrency guard was the
-- sweep's advisory Redis lock, which is documented as not authoritative — a
-- run stalled past the lock's TTL by a slow/unreachable CPO can overlap with
-- the next scheduled run, and `correctOvercharge`'s wallet-crediting step has
-- no dedupe of its own. Same claim idiom as `EvSession.stoppedAt`.
ALTER TABLE "ev_cdrs" ADD COLUMN "reconcilingAt" TIMESTAMP(3);
