-- Snapshots the pool split's confirmed amounts on PurchaseIntent, so a
-- later PurchaseIntentRefundService refund reverses the historical
-- allocation instead of recomputing green/deferred/referrer basis points
-- from whatever purchasePolicy configuration is live at refund time.
-- Independent audit, GitHub issue #28, HEAD 0a9c7d5.

ALTER TABLE "purchase_intents"
  ADD COLUMN "poolAmount" DECIMAL(18,4),
  ADD COLUMN "greenAmount" DECIMAL(18,4),
  ADD COLUMN "deferredAmount" DECIMAL(18,4),
  ADD COLUMN "referrerAmount" DECIMAL(18,4);
