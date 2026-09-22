-- Partner Spotlight cards speak the customer's language.
--
-- `title`, `subtitle` and `benefitLabel` were single strings, so an Armenian
-- interface showed whatever language the administrator happened to type.
-- They become one JSON object keyed by interface locale (hy / ru / en); the
-- rows that exist move their copy under `ru`, which is what they were.

ALTER TABLE "partner_promos" ADD COLUMN "translations" JSONB NOT NULL DEFAULT '{}';

UPDATE "partner_promos"
SET "translations" = jsonb_build_object(
  'ru',
  jsonb_strip_nulls(jsonb_build_object(
    'title', "title",
    'subtitle', "subtitle",
    'benefitLabel', "benefitLabel"
  ))
);

ALTER TABLE "partner_promos" DROP COLUMN "title";
ALTER TABLE "partner_promos" DROP COLUMN "subtitle";
ALTER TABLE "partner_promos" DROP COLUMN "benefitLabel";

-- The column holds an object of locales, never a string or an array — the
-- shape the API validates, stated once more where it cannot be forgotten.
ALTER TABLE "partner_promos"
  ADD CONSTRAINT "partner_promos_translations_is_object"
  CHECK (jsonb_typeof("translations") = 'object');
