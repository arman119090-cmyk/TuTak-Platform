#!/usr/bin/env bash
#
# Rehearse this branch's migrations against a database that looks like main's.
#
# `fresh database → latest schema` is not evidence. It proves the migrations
# are internally consistent and nothing about what they do to rows that
# already exist — which is the only thing that can go wrong on a real deploy.
# Three of this branch's migrations rewrite or constrain existing data:
#
#   * free-text `unit` → the `UnitOfMeasure` enum, by an explicit mapping
#     that stops rather than guessing;
#   * the one-live-purchase preflight, which must refuse and change nothing;
#   * back-fills on `partner_contribution_rules` and `purchase_intents`.
#
# So: build main's schema, fill it with rows that look like production's,
# apply this branch on top, and check what happened to them.
#
# Usage: apps/api/scripts/migration-rehearsal.sh [database-name]
set -euo pipefail

DB="${1:-tutak_rehearsal}"
HOST="${PGHOST:-localhost}"
USER="${PGUSER:-tutak}"
export PGPASSWORD="${PGPASSWORD:-tutak_dev_password}"
API_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR="$(cd "$API_DIR/../.." && pwd)"
URL="postgresql://$USER:$PGPASSWORD@$HOST:5432/$DB?schema=public"
WORKTREE="${TMPDIR:-/tmp}/tutak-main-schema"
BASE_REF="${BASE_REF:-origin/main}"

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
fail() { printf '\n\033[31mREHEARSAL FAILED: %s\033[0m\n' "$*" >&2; exit 1; }

say "1. A database holding $BASE_REF's schema"
psql -h "$HOST" -U "$USER" -d postgres -c "DROP DATABASE IF EXISTS \"$DB\"" >/dev/null
psql -h "$HOST" -U "$USER" -d postgres -c "CREATE DATABASE \"$DB\"" >/dev/null

rm -rf "$WORKTREE"
git -C "$ROOT_DIR" worktree add -f --detach "$WORKTREE" "$BASE_REF" >/dev/null 2>&1
ln -sfn "$ROOT_DIR/node_modules" "$WORKTREE/node_modules"
ln -sfn "$API_DIR/node_modules" "$WORKTREE/apps/api/node_modules"
( cd "$WORKTREE/apps/api" && DATABASE_URL="$URL" node node_modules/prisma/build/index.js migrate deploy ) \
  | tail -2

say "2. Legacy rows, of the shapes the new migrations touch"
psql -h "$HOST" -U "$USER" -d "$DB" -v ON_ERROR_STOP=1 -f "$API_DIR/scripts/migration-rehearsal-seed.sql" >/dev/null
psql -h "$HOST" -U "$USER" -d "$DB" -tAc "
  SELECT 'users=' || (SELECT count(*) FROM users)
      || ' partners=' || (SELECT count(*) FROM partners)
      || ' purchases=' || (SELECT count(*) FROM purchase_intents)
      || ' payments=' || (SELECT count(*) FROM payments)
      || ' refunds=' || (SELECT count(*) FROM refunds)"

say "3a. The migrations must REFUSE while duplicates exist"
set +e
REFUSAL=$( cd "$API_DIR" && DATABASE_URL="$URL" node node_modules/prisma/build/index.js migrate deploy 2>&1 )
RC=$?
set -e
if [ $RC -eq 0 ]; then
  fail "migrate deploy succeeded with duplicate live purchases present — the preflight did not fire"
fi
if ! echo "$REFUSAL" | grep -q "Follow the rollout"; then
  echo "$REFUSAL" | tail -5
  fail "it refused, but not with the rollout instructions — an operator cannot act on that"
fi
echo "$REFUSAL" | grep -oE "Cannot create purchase_intents[^\\]{0,200}" | head -1
echo "refused ✓"

LIVE_AFTER_REFUSAL=$( psql -h "$HOST" -U "$USER" -d "$DB" -tAc \
  "SELECT count(*) FROM purchase_intents WHERE status = 'AWAITING_CONFIRMATION'" )
if [ "$LIVE_AFTER_REFUSAL" != "2" ]; then
  fail "the refused migration closed purchases: $LIVE_AFTER_REFUSAL live, expected 2"
fi
echo "nothing was touched: still 2 live purchases ✓"

say "3b. The documented rollout: drain, wait out the timeout, sweep"
psql -h "$HOST" -U "$USER" -d "$DB" -v ON_ERROR_STOP=1 -f "$API_DIR/scripts/migration-rehearsal-rollout.sql" \
  | grep -A 2 "remaining duplicate pairs"

say "3c. Clear the failed migration row"
# Prisma records the refused attempt in `_prisma_migrations` and will not
# continue until somebody says what happened to it. That is correct — a
# half-applied migration should block a deploy — but it means the rollout has
# a step the migration's own header did not mention until this rehearsal
# found it. Nothing was applied, so it is rolled back, not rolled forward.
( cd "$API_DIR" && DATABASE_URL="$URL" node node_modules/prisma/build/index.js migrate resolve \
    --rolled-back 20260915150000_one_live_purchase_per_customer_partner ) 2>&1 | tail -1

say "3d. Now the migrations apply"
if ! ( cd "$API_DIR" && DATABASE_URL="$URL" node node_modules/prisma/build/index.js migrate deploy ) 2>&1 | tail -3; then
  fail "migrate deploy did not complete after the rollout"
fi

say "4. What happened to the rows"
psql -h "$HOST" -U "$USER" -d "$DB" -v ON_ERROR_STOP=1 -f "$API_DIR/scripts/migration-rehearsal-verify.sql"

say "5. migrate diff must be empty"
DIFF=$( cd "$API_DIR" && node node_modules/prisma/build/index.js migrate diff \
          --from-url "$URL" --to-schema-datamodel prisma/schema.prisma --script 2>/dev/null \
        | grep -v '^warn\|^For more' )
if [ "$(echo "$DIFF" | tr -d '[:space:]')" != "--Thisisanemptymigration." ]; then
  echo "$DIFF"
  fail "the deployed database does not match the schema"
fi
echo "empty ✓"

git -C "$ROOT_DIR" worktree remove "$WORKTREE" --force >/dev/null 2>&1 || true
printf '\n\033[32mREHEARSAL PASSED\033[0m — %s still holds this branch'"'"'s schema for inspection.\n' "$DB"
