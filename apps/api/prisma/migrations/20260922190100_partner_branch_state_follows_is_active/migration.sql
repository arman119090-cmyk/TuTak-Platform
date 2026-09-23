-- Keep the older writer working.
--
-- `partner_branches_state_matches_is_active` stops the two columns drifting,
-- which is what it is for. It also breaks a writer that sets only `isActive`
-- — and for the length of every rolling deploy there is exactly such a
-- writer: the release being replaced, whose "deactivate this branch" button
-- flips the boolean and knows nothing about `state`. During that window an
-- owner pressing it would get an error.
--
-- So the database derives the missing half rather than refusing the write.
-- The check constraint stays as the backstop for the case this cannot fix:
-- a writer that sets *both*, inconsistently, means something the database
-- has no business guessing at.
--
-- Precedence is deliberate. A statement that names `state` is saying which
-- of the two kinds of closure it means, and that is the more specific
-- intent: it wins, and `isActive` follows it. A statement that names only
-- `isActive` is the old vocabulary, in which "off" has always meant the
-- reversible closure — so it becomes SUSPENDED, never ARCHIVED. Nothing
-- archives a location by accident.

CREATE OR REPLACE FUNCTION "partner_branch_state_follows_is_active"()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- `state` defaults to ACTIVE, so an insert naming only `isActive = false`
    -- would fail the constraint. A non-default `state` is an explicit choice
    -- and takes the boolean with it.
    IF NEW."state" <> 'ACTIVE' THEN
      NEW."isActive" := false;
    ELSIF NEW."isActive" = false THEN
      NEW."state" := 'SUSPENDED';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."state" IS DISTINCT FROM OLD."state" THEN
    -- The statement said which closure it means; only fill in the boolean if
    -- the statement did not set it itself.
    IF NEW."isActive" IS NOT DISTINCT FROM OLD."isActive" THEN
      NEW."isActive" := (NEW."state" = 'ACTIVE');
    END IF;
  ELSIF NEW."isActive" IS DISTINCT FROM OLD."isActive" THEN
    -- The old vocabulary: off means shut for now, and on means open again.
    -- Reopening an archived branch this way is refused by the application
    -- (`PartnersService.setBranchActive`) rather than here, because the
    -- reason belongs in a message a person can read.
    NEW."state" := CASE WHEN NEW."isActive" THEN 'ACTIVE' ELSE 'SUSPENDED' END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "partner_branch_state_follows_is_active"
  BEFORE INSERT OR UPDATE ON "partner_branches"
  FOR EACH ROW EXECUTE FUNCTION "partner_branch_state_follows_is_active"();
