#!/usr/bin/env bash
#
# Does the employee-code migration do the right thing to a database that
# already has people in it?
#
# Applying migrations to an empty database proves they parse. It proves
# nothing about the part that matters here: a backfill that has to pick one
# permanent code per person out of the branch assignments they already have,
# without touching history and without changing anybody's access.
#
# So this builds a database in the state *before* the three new migrations,
# fills it with the awkward shapes a real partner produces — somebody posted
# to two branches, somebody whose only posting was ended, two people with the
# same name, a code typed by hand, assignments created in the same
# millisecond — then applies the migrations and checks the result.
#
#   scripts/verify-employee-code-migration.sh
#
# Reads PGHOST/PGPORT/PGUSER/PGPASSWORD (defaults suit the dev compose file).
# Creates and drops its own database; touches nothing else.
set -euo pipefail

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-tutak}"
PGPASSWORD="${PGPASSWORD:-tutak_dev_password}"
export PGHOST PGPORT PGUSER PGPASSWORD

DB="tutak_migration_rehearsal_$$"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API="$ROOT/apps/api"
TMP="$(mktemp -d)"

# The last migration that existed before this work. Everything after it is
# what we are putting on trial.
CUTOFF="20260922140000_legal_documents_and_consent"
NEW_MIGRATIONS=(
  "20260922160000_partner_employee_codes"
  "20260922160100_purchase_confirmation_source"
  "20260922170000_partner_employee_code_sequence"
)

failures=0
pass() { printf '  \033[32mOK\033[0m   %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; failures=$((failures + 1)); }

cleanup() {
  psql -d postgres -q -c "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE);" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

q() { psql -d "$DB" -tAc "$1"; }

# `check <description> <expected> <sql>` — one assertion, printed either way.
check() {
  local what="$1" expected="$2" actual
  actual="$(q "$3" | tr -d '[:space:]')"
  if [ "$actual" = "$expected" ]; then pass "$what"; else fail "$what — ожидалось '$expected', получено '$actual'"; fi
}

echo "База $DB"
psql -d postgres -q -c "CREATE DATABASE \"$DB\";"

# ── 1. The schema as it was before this work ─────────────────────────────
#
# A copy of the migrations directory with the new ones removed, so
# `migrate deploy` stops exactly where production stands today.
echo
echo "1. Миграции до $CUTOFF"
# Applied with psql rather than `prisma migrate deploy`: deploy resolves the
# migrations directory from the project's own config and applies *all* of
# them, which is the one thing this rehearsal must not do. Running the files
# in name order is what deploy does anyway, minus bookkeeping this throwaway
# database has no use for.
applied=0
for dir in "$API"/prisma/migrations/*/; do
  name="$(basename "$dir")"
  [[ "$name" > "$CUTOFF" ]] && continue
  psql -d "$DB" -q -v ON_ERROR_STOP=1 -f "$dir/migration.sql"
  applied=$((applied + 1))
done
echo "   применено: $applied"

# ── 2. The awkward shapes a real partner produces ────────────────────────
echo
echo "2. Данные до миграции"
psql -d "$DB" -q <<'SQL'
INSERT INTO "partners" ("id","legalName","displayName","category","updatedAt")
VALUES ('p1','Partner One LLC','Partner One','retail', NOW()),
       ('p2','Partner Two LLC','Partner Two','retail', NOW());

INSERT INTO "partner_branches" ("id","partnerId","name","address","city","latitude","longitude")
VALUES ('b1','p1','North','North 1','Yerevan',40.18,44.51),
       ('b2','p1','South','South 2','Yerevan',40.17,44.52),
       ('b3','p2','Only','Only 3','Yerevan',40.16,44.53);

-- Two people with the same name, which is why the backfill may never match
-- on one. u1 works two branches; u2 has two postings created in the same
-- millisecond; u3's only posting was ended; u4 has none at all.
INSERT INTO "users" ("id","phone","passwordHash","firstName","lastName","updatedAt")
VALUES ('u1','+37491000001','x','Արամ','Հակոբյան', NOW()),
       ('u2','+37491000002','x','Արամ','Հակոբյան', NOW()),
       ('u3','+37491000003','x','Ани','Петросян', NOW()),
       ('u4','+37491000004','x','Нарек','Саркисян', NOW()),
       ('u5','+37491000005','x','Owner','One', NOW()),
       ('u6','+37491000006','x','Other','Partner', NOW());

-- u1: two branches, different times. The earlier one is EMP-003.
INSERT INTO "partner_branch_staff_assignments"
  ("id","partnerId","partnerBranchId","userId","employeeDisplayCode","assignedByUserId","isActive","createdAt")
VALUES
  ('a1','p1','b1','u1','EMP-003','u5', true,  '2026-03-01 10:00:00'),
  ('a2','p1','b2','u1','EMP-009','u5', true,  '2026-05-01 10:00:00'),
  -- u2: identical createdAt, so only the id can break the tie.
  ('a3','p1','b1','u2','EMP-005','u5', true,  '2026-04-01 12:00:00'),
  ('a4','p1','b2','u2','EMP-004','u5', true,  '2026-04-01 12:00:00'),
  -- u3: the one posting they had was ended. They still confirmed sales.
  ('a5','p1','b1','u3','EMP-042','u5', false, '2026-02-01 09:00:00'),
  -- u6 belongs to the other partner entirely.
  ('a6','p2','b3','u6','EMP-001','u5', true,  '2026-06-01 09:00:00');

-- A purchase confirmed long before any of these columns existed.
INSERT INTO "purchase_intents"
  ("id","customerId","partnerId","grossAmount","ordinaryPaymentRemainder",
   "negotiatedRateBps","maxBonusPaymentPercent","status","expiresAt","confirmedByUserId","confirmedAt")
VALUES ('pi-old','u4','p1',5000,5000,500,50,'CONFIRMED',
        NOW() + interval '1 day', NULL, '2026-01-15 11:00:00');
SQL
echo "   партнёры 2, сотрудники 6, назначения 6, покупка 1"

before_assignments="$(q 'SELECT count(*) FROM "partner_branch_staff_assignments";')"
before_codes="$(q 'SELECT string_agg("employeeDisplayCode", $$,$$ ORDER BY "id") FROM "partner_branch_staff_assignments";')"
before_roles="$(q 'SELECT count(*) FROM "user_roles";')"

# ── 3. The migrations under test ─────────────────────────────────────────
echo
echo "3. Применение новых миграций"
for name in "${NEW_MIGRATIONS[@]}"; do
  psql -d "$DB" -q -v ON_ERROR_STOP=1 -f "$API/prisma/migrations/$name/migration.sql"
  echo "   $name"
done

# ── 4. What has to be true afterwards ────────────────────────────────────
echo
echo "4. Проверки"

# Three, not four: u1, u2 and u3 each have an assignment to adopt a code
# from, and u4 has none. The lazy allocator gives u4 one the first time they
# actually need it.
check "у p1 три сотрудника с кодом — те, у кого есть назначение" "3" \
  "SELECT count(*) FROM \"partner_employees\" WHERE \"partnerId\"='p1';"

check "u1 получил код раннего назначения, а не позднего" "EMP-003" \
  "SELECT \"code\" FROM \"partner_employees\" WHERE \"partnerId\"='p1' AND \"userId\"='u1';"

check "u2 при одинаковом createdAt выбран детерминированно по id" "EMP-005" \
  "SELECT \"code\" FROM \"partner_employees\" WHERE \"partnerId\"='p1' AND \"userId\"='u2';"

check "у u3 код сохранён, хотя назначение деактивировано" "EMP-042" \
  "SELECT \"code\" FROM \"partner_employees\" WHERE \"partnerId\"='p1' AND \"userId\"='u3';"

check "u4 без назначений строки не получил" "0" \
  "SELECT count(*) FROM \"partner_employees\" WHERE \"userId\"='u4';"

check "тёзки u1 и u2 получили разные коды" "2" \
  "SELECT count(DISTINCT \"code\") FROM \"partner_employees\" WHERE \"userId\" IN ('u1','u2');"

check "один человек — одна строка (u1 на двух филиалах)" "1" \
  "SELECT count(*) FROM \"partner_employees\" WHERE \"partnerId\"='p1' AND \"userId\"='u1';"

check "партнёры разделены: EMP-001 у p2 принадлежит u6" "u6" \
  "SELECT \"userId\" FROM \"partner_employees\" WHERE \"partnerId\"='p2' AND \"code\"='EMP-001';"

check "счётчик p1 встал выше самого большого выданного кода (42)" "42" \
  "SELECT \"employeeCodeSeq\" FROM \"partners\" WHERE \"id\"='p1';"

check "счётчик p2 считает только свои коды" "1" \
  "SELECT \"employeeCodeSeq\" FROM \"partners\" WHERE \"id\"='p2';"

check "назначения не тронуты: столько же строк" "$before_assignments" \
  "SELECT count(*) FROM \"partner_branch_staff_assignments\";"

check "исторические коды назначений не переписаны" "$(echo "$before_codes" | tr -d '[:space:]')" \
  "SELECT string_agg(\"employeeDisplayCode\", ',' ORDER BY \"id\") FROM \"partner_branch_staff_assignments\";"

check "права не изменились: строк в user_roles столько же" "$before_roles" \
  "SELECT count(*) FROM \"user_roles\";"

check "членства партнёра не создавались (правила самодилинга не тронуты)" "0" \
  "SELECT count(*) FROM \"partner_memberships\";"

check "старой покупке не придуман исполнитель" "" \
  "SELECT coalesce(\"confirmedByEmployeeCode\", '') || coalesce(\"confirmationSource\"::text, '') FROM \"purchase_intents\" WHERE \"id\"='pi-old';"

check "старая покупка сохранила время подтверждения" "2026-01-1511:00:00" \
  "SELECT \"confirmedAt\" FROM \"purchase_intents\" WHERE \"id\"='pi-old';"

echo
if [ "$failures" -eq 0 ]; then
  printf '\033[32mВсе проверки пройдены.\033[0m\n'
else
  printf '\033[31mПровалено проверок: %d\033[0m\n' "$failures"
  exit 1
fi
