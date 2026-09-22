#!/usr/bin/env bash
#
# Does `prisma migrate deploy` — the command production actually runs — do the
# right thing to a database that already has people and purchases in it?
#
# `scripts/verify-employee-code-migration.sh` answers a narrower question. It
# applies the migration files with psql, by name, because it has to stop at a
# cutoff and `migrate deploy` resolves its own directory and applies
# everything. That proves the SQL does what it claims. It does not exercise
# the command, the `_prisma_migrations` bookkeeping, checksum validation, or
# the "pending" set deploy computes for itself.
#
# This is that half. Two real `migrate deploy` runs against one database:
#
#   1. every migration that existed before this work, giving a history a
#      production database would recognise;
#   2. the four new ones, applied exactly as a release would apply them.
#
# Then: migrate status, drift, the constraints, and the data.
#
#   scripts/verify-migrate-deploy-rehearsal.sh
#
# Reads PGHOST/PGPORT/PGUSER/PGPASSWORD (defaults suit the dev compose file).
# Creates and drops its own database; touches nothing else.
set -euo pipefail

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-tutak}"
PGPASSWORD="${PGPASSWORD:-tutak_dev_password}"
export PGHOST PGPORT PGUSER PGPASSWORD

DB="tutak_deploy_rehearsal_$$"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API="$ROOT/apps/api"
PRISMA="$API/node_modules/.bin/prisma"
STAGE="$(mktemp -d)"
export DATABASE_URL="postgresql://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/$DB?schema=public"

# The last migration that existed before this work.
CUTOFF="20260922140000_legal_documents_and_consent"
NEW_MIGRATIONS=(
  "20260922160000_partner_employee_codes"
  "20260922160100_purchase_confirmation_source"
  "20260922170000_partner_employee_code_sequence"
  "20260922180000_purchase_confirmation_consistency"
  "20260922190000_partner_branch_state"
)

failures=0
pass() { printf '  \033[32mOK\033[0m   %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; failures=$((failures + 1)); }

cleanup() {
  psql -d postgres -q -c "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE);" >/dev/null 2>&1 || true
  rm -rf "$STAGE"
}
trap cleanup EXIT

q() { psql -d "$DB" -tAc "$1"; }

check() {
  local what="$1" expected="$2" actual
  actual="$(q "$3" | tr -d '[:space:]')"
  if [ "$actual" = "$expected" ]; then pass "$what"; else fail "$what — ожидалось '$expected', получено '$actual'"; fi
}

# `refuses <description> <sql>` — the statement must be rejected by the database.
refuses() {
  local what="$1"
  if psql -d "$DB" -q -v ON_ERROR_STOP=1 -c "$2" >/dev/null 2>&1; then
    fail "$what — запись прошла, хотя должна была быть отклонена"
  else
    pass "$what"
  fi
}

echo "База $DB"
psql -d postgres -q -c "CREATE DATABASE \"$DB\";"

# ── The staging directory prisma will read ───────────────────────────────
#
# Its own config, so the CLI resolves the schema and the migrations from here
# rather than from apps/api — which is what made the first attempt at this
# apply every migration in one go.
cp "$API/prisma/schema.prisma" "$STAGE/schema.prisma"
cat > "$STAGE/prisma.config.ts" <<'CONFIG'
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'schema.prisma',
  migrations: { path: 'migrations' },
});
CONFIG
mkdir -p "$STAGE/migrations"

echo
echo "1. Штатный deploy истории до $CUTOFF"
staged=0
for dir in "$API"/prisma/migrations/*/; do
  name="$(basename "$dir")"
  [[ "$name" > "$CUTOFF" ]] && continue
  cp -r "$dir" "$STAGE/migrations/$name"
  staged=$((staged + 1))
done
(cd "$STAGE" && "$PRISMA" migrate deploy) | sed 's/^/   /'
echo "   подготовлено миграций: $staged"

check "история Prisma записана, а не подделана" "$staged" \
  "SELECT count(*) FROM \"_prisma_migrations\" WHERE finished_at IS NOT NULL;"
check "ни одна миграция не откатана" "0" \
  "SELECT count(*) FROM \"_prisma_migrations\" WHERE rolled_back_at IS NOT NULL;"

# ── Data, so the second deploy runs against a database in use ────────────
echo
echo "2. Данные до обновления"
psql -d "$DB" -q <<'SQL'
INSERT INTO "partners" ("id","legalName","displayName","category","updatedAt")
VALUES ('p1','Partner One LLC','Partner One','retail', NOW());

INSERT INTO "partner_branches" ("id","partnerId","name","address","city","latitude","longitude")
VALUES ('b1','p1','North','North 1','Yerevan',40.18,44.51),
       ('b2','p1','South','South 2','Yerevan',40.17,44.52);

INSERT INTO "users" ("id","phone","passwordHash","firstName","lastName","updatedAt")
VALUES ('u1','+37491000001','x','Արամ','Հակոբյան', NOW()),
       ('u2','+37491000002','x','Ани','Петросян', NOW()),
       ('u3','+37491000003','x','Owner','One', NOW());

INSERT INTO "partner_branch_staff_assignments"
  ("id","partnerId","partnerBranchId","userId","employeeDisplayCode","assignedByUserId","isActive","createdAt")
VALUES ('a1','p1','b1','u1','EMP-003','u3', true,  '2026-03-01 10:00:00'),
       ('a2','p1','b2','u1','EMP-009','u3', true,  '2026-05-01 10:00:00'),
       ('a3','p1','b1','u2','EMP-042','u3', false, '2026-02-01 09:00:00');

INSERT INTO "purchase_intents"
  ("id","customerId","partnerId","grossAmount","ordinaryPaymentRemainder",
   "negotiatedRateBps","maxBonusPaymentPercent","status","expiresAt","confirmedByUserId","confirmedAt")
VALUES ('pi-old','u2','p1',5000,5000,500,50,'CONFIRMED',
        NOW() + interval '1 day', 'u1', '2026-01-15 11:00:00');
SQL
before_assignments="$(q 'SELECT count(*) FROM "partner_branch_staff_assignments";')"
echo "   партнёр 1, сотрудники 3, назначения $before_assignments, покупка 1"

# ── The release under test ───────────────────────────────────────────────
echo
echo "3. Штатный deploy ${#NEW_MIGRATIONS[@]} новых миграций"
for name in "${NEW_MIGRATIONS[@]}"; do
  cp -r "$API/prisma/migrations/$name" "$STAGE/migrations/$name"
done
(cd "$STAGE" && "$PRISMA" migrate deploy) | sed 's/^/   /'

echo
echo "4. Проверки"

check "применены ровно новые миграции и ничего сверх" "$((staged + ${#NEW_MIGRATIONS[@]}))" \
  "SELECT count(*) FROM \"_prisma_migrations\" WHERE finished_at IS NOT NULL;"
names="$(printf "'%s'," "${NEW_MIGRATIONS[@]}")"
check "каждая новая записана в историю" "${#NEW_MIGRATIONS[@]}" \
  "SELECT count(*) FROM \"_prisma_migrations\" WHERE migration_name IN (${names%,});"
check "ни одна не отмечена как откатанная" "0" \
  "SELECT count(*) FROM \"_prisma_migrations\" WHERE rolled_back_at IS NOT NULL;"

status_out="$( (cd "$STAGE" && "$PRISMA" migrate status) 2>&1 || true)"
if grep -q "Database schema is up to date" <<<"$status_out"; then
  pass "migrate status: база в актуальном состоянии"
else
  fail "migrate status: $(head -n 3 <<<"$status_out" | tr '\n' ' ')"
fi

# Drift: the schema the code expects against the database the deploy produced.
drift_out="$( (cd "$STAGE" && "$PRISMA" migrate diff \
  --from-url "$DATABASE_URL" --to-schema-datamodel "$STAGE/schema.prisma" --exit-code) 2>&1 || true)"
if grep -q "No difference" <<<"$drift_out"; then
  pass "drift между схемой и базой отсутствует"
else
  fail "drift: $(head -n 5 <<<"$drift_out" | tr '\n' ' ')"
fi

# ── The data the upgrade had to leave alone, and the backfill it had to do ─
check "назначения не тронуты" "$before_assignments" \
  "SELECT count(*) FROM \"partner_branch_staff_assignments\";"
check "исторические коды назначений не переписаны" "EMP-003,EMP-009,EMP-042" \
  "SELECT string_agg(\"employeeDisplayCode\", ',' ORDER BY \"id\") FROM \"partner_branch_staff_assignments\";"
check "у p1 два сотрудника с постоянным кодом" "2" \
  "SELECT count(*) FROM \"partner_employees\" WHERE \"partnerId\"='p1';"
check "u1 получил код раннего назначения" "EMP-003" \
  "SELECT \"code\" FROM \"partner_employees\" WHERE \"userId\"='u1';"
check "u2 сохранил код деактивированного назначения" "EMP-042" \
  "SELECT \"code\" FROM \"partner_employees\" WHERE \"userId\"='u2';"
check "счётчик встал выше самого большого выданного кода" "42" \
  "SELECT \"employeeCodeSeq\" FROM \"partners\" WHERE \"id\"='p1';"
check "старой покупке не придуман источник подтверждения" "" \
  "SELECT coalesce(\"confirmationSource\"::text,'') || coalesce(\"confirmedByEmployeeCode\",'') FROM \"purchase_intents\" WHERE \"id\"='pi-old';"
check "старая покупка сохранила исполнителя и время" "u12026-01-1511:00:00" \
  "SELECT \"confirmedByUserId\" || \"confirmedAt\" FROM \"purchase_intents\" WHERE \"id\"='pi-old';"

check "филиалы получили состояние, выведенное из isActive" "ACTIVE|ACTIVE" \
  "SELECT string_agg(\"state\"::text, '|' ORDER BY \"id\") FROM \"partner_branches\";"

refuses "база отклоняет архивный филиал, который всё ещё торгует" \
  "UPDATE \"partner_branches\" SET \"state\" = 'ARCHIVED' WHERE \"id\" = 'b1';"

# ── The constraints the deploy was supposed to install ───────────────────
check "все три новых ограничения существуют" "3" \
  "SELECT count(*) FROM pg_constraint WHERE conname IN ('purchase_intents_confirmation_is_consistent','purchase_intents_confirmation_posting_is_whole','partner_branches_state_matches_is_active');"

refuses "база отклоняет подтверждение кассира без кода сотрудника" \
  "UPDATE \"purchase_intents\" SET \"confirmationSource\"='STAFF' WHERE \"id\"='pi-old';"
refuses "база отклоняет колбэк провайдера с назначенным кассиром" \
  "UPDATE \"purchase_intents\" SET \"confirmationSource\"='PROVIDER_CALLBACK', \"confirmedByEmployeeCode\"='EMP-003' WHERE \"id\"='pi-old';"
refuses "база отклоняет назначение без роли, под которой действовали" \
  "UPDATE \"purchase_intents\" SET \"confirmedByAssignmentId\"='a1' WHERE \"id\"='pi-old';"

echo
if [ "$failures" -eq 0 ]; then
  printf '\033[32mВсе проверки пройдены.\033[0m\n'
else
  printf '\033[31mПровалено проверок: %d\033[0m\n' "$failures"
  exit 1
fi
