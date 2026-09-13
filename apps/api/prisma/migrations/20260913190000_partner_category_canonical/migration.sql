-- A partner's category is stored the way every reader already assumes it is.
--
-- `Partner.category` is free text, and the two sides of it disagreed. Reads
-- go through `toPartnerCategory` (trim, lowercase, anything unrecognised
-- becomes `other`); the map's filter was an exact SQL match on the raw
-- column. A restaurant stored as "Restaurant" — the capital letter its own
-- owner typed into the application form — therefore drew a restaurant pin
-- and was invisible to the restaurant chip, and no panel could fix it: the
-- category is not editable after the application, so it took a SQL prompt.
--
-- Two statements, in this order, because the second one cannot pass until
-- the first has run.
--
-- Cost and lock: an UPDATE touching only rows that are not already canonical,
-- then a CHECK validated over the table. `partners` is a table of businesses
-- — hundreds, not millions — so both are milliseconds under an ACCESS
-- EXCLUSIVE lock held for that long. Deliberately not `NOT VALID` + a
-- separate VALIDATE: that pattern exists to avoid a long scan, and there is
-- no long scan here.
--
-- Rollback: `ALTER TABLE "partners" DROP CONSTRAINT "partners_category_canonical";`
-- The lowercasing itself is not reversible — the original casing is not
-- recorded anywhere — but it is also not information: every consumer in the
-- codebase lowercased it before looking at it.

UPDATE "partners"
   SET "category" = lower(btrim("category"))
 WHERE "category" <> lower(btrim("category"));

-- Makes the defect unrepresentable rather than merely fixed. Without it the
-- column can drift back the first time a row is written by anything that is
-- not `PartnersService` — a seed, a support script, a future endpoint.
ALTER TABLE "partners"
  ADD CONSTRAINT "partners_category_canonical"
  CHECK ("category" = lower(btrim("category")));
