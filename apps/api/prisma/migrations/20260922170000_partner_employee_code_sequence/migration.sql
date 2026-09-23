-- One counter per partner, so two codes are never picked at the same time.
--
-- The first version of `PartnerEmployeeService.nextCode` read the highest
-- `EMP-<n>` from `partner_employees` and `partner_branch_staff_assignments`
-- and inserted one past it. That is a read followed by a hope: two requests
-- read the same maximum, both choose the same code, and the one that loses
-- the unique index is a request that simply fails. Reproduced, before this
-- migration existed, by eight concurrent allocations in
-- `partner-employee-code.int-spec.ts` — "Unique constraint failed on the
-- fields: (partnerId, code)".
--
-- A counter on the partner row replaces it. `UPDATE ... SET seq = seq + 1
-- RETURNING seq` is one statement: PostgreSQL takes the row lock, every
-- concurrent caller is serialised behind it, and each gets a different
-- number. No advisory lock to release, no retry loop to get wrong, and the
-- guarantee is the database's rather than the application's.
--
-- Both allocation paths use it — the permanent employee code and the older
-- per-assignment display code — because they share one `EMP-` namespace per
-- partner and a counter that only half the writers respect is not a counter.

ALTER TABLE "partners"
    ADD COLUMN "employeeCodeSeq" INTEGER NOT NULL DEFAULT 0;

-- Start each partner past every code it has already issued, in either table.
-- Codes that do not parse as `EMP-<digits>` (a partner-supplied label such as
-- "B-014", which the assignment API allows) contribute nothing: they are
-- outside this namespace and the unique indexes still protect them.
UPDATE "partners" p
SET "employeeCodeSeq" = COALESCE(issued.max_n, 0)
FROM (
    SELECT
        "partnerId",
        MAX(n) AS max_n
    FROM (
        SELECT "partnerId", CAST(substring("code" FROM '^EMP-(\d+)$') AS INTEGER) AS n
        FROM "partner_employees"
        WHERE "code" ~ '^EMP-\d+$'
        UNION ALL
        SELECT "partnerId", CAST(substring("employeeDisplayCode" FROM '^EMP-(\d+)$') AS INTEGER) AS n
        FROM "partner_branch_staff_assignments"
        WHERE "employeeDisplayCode" ~ '^EMP-\d+$'
    ) AS all_codes
    GROUP BY "partnerId"
) AS issued
WHERE p."id" = issued."partnerId";
