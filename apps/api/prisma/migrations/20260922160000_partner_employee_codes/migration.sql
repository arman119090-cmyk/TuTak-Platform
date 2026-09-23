-- A person's permanent, readable identity inside one partner organisation.
--
-- The problem this closes: `partner_branch_staff_assignments.employeeDisplayCode`
-- names an assignment to a *branch*, not a person. Moving somebody to another
-- branch ends one assignment and starts another with a new code; working two
-- branches gives one human two codes. A partner reading "who confirmed this
-- sale" then sees two identities for one person, and a transfer silently
-- rewrites what last month's receipts appear to say.
--
-- Additive in every direction. No existing table is altered, no existing
-- `employeeDisplayCode` is rewritten, and nothing here changes a single
-- authorisation decision.
--
-- ## Why a new table rather than `partner_memberships`
--
-- That table already carries `(partnerId, userId)` and looks like the right
-- home, and is not. Production code creates a row only for a partner's
-- founding owner (`PartnersService.create`/`apply`); every other staff member
-- is attached through a partner-scoped `user_roles` row and never gets one.
-- `isMember` branches on the row's presence for self-dealing checks, so
-- backfilling memberships for staff would change who may pay themselves —
-- a financial authorisation change smuggled inside a display feature. It is
-- not made here.

CREATE TABLE "partner_employees" (
    "id"        TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "code"      TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_employees_pkey" PRIMARY KEY ("id")
);

-- One identity per person per partner, and a code that belongs to exactly one
-- person. The second index is what makes "never reused" enforceable rather
-- than merely intended: a code released by a leaver cannot be handed to
-- somebody else while the row stands, and the row is never deleted.
CREATE UNIQUE INDEX "partner_employees_partnerId_userId_key"
    ON "partner_employees"("partnerId", "userId");
CREATE UNIQUE INDEX "partner_employees_partnerId_code_key"
    ON "partner_employees"("partnerId", "code");

ALTER TABLE "partner_employees"
    ADD CONSTRAINT "partner_employees_partnerId_fkey"
    FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "partner_employees"
    ADD CONSTRAINT "partner_employees_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Adopting the codes that already exist ────────────────────────────────
--
-- Every person who already has at least one branch assignment keeps a code
-- they have already been given, rather than being issued a new one: their
-- **earliest** assignment's code, by `createdAt` then `id` so the choice is
-- deterministic on a tie.
--
-- This is derived from the assignment row itself, which names the user by id.
-- Nothing is matched on a name, a phone number or any other resemblance — the
-- brief forbids it and it would be wrong anyway: two people called the same
-- thing at one partner is ordinary, not exotic.
--
-- A person's *other* assignment codes are deliberately left where they are.
-- They stay attached to those assignment rows as history, and stay reserved
-- against reuse by the partner-unique index on that table, so a snapshot
-- naming one still resolves. What they stop being is that person's identity.
--
-- Staff with no assignment at all (a partner with no branches, or somebody
-- never assigned) get no row here. They are issued a code the first time one
-- is actually needed — see `PartnerEmployeeService.codeFor`. Inventing codes
-- now for people who may never confirm a sale would fill the namespace with
-- identities nobody can point at.
INSERT INTO "partner_employees" ("id", "partnerId", "userId", "code", "createdAt")
SELECT
    gen_random_uuid()::text,
    earliest."partnerId",
    earliest."userId",
    earliest."employeeDisplayCode",
    earliest."createdAt"
FROM (
    SELECT DISTINCT ON (a."partnerId", a."userId")
        a."partnerId",
        a."userId",
        a."employeeDisplayCode",
        a."createdAt"
    FROM "partner_branch_staff_assignments" a
    ORDER BY a."partnerId", a."userId", a."createdAt" ASC, a."id" ASC
) AS earliest;
