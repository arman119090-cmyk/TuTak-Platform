#!/usr/bin/env bash
# Adversarial self-test for verify-restored-db.sh. Every destructive case runs
# on a fresh throwaway copy of the local test database (template copy), so
# cases cannot pollute each other; minimal rows are seeded where the copy may
# be empty. Needs psql + createdb rights on the local server.
#   scripts/verify-restored-db.test.sh "postgresql://tutak:...@localhost:5432/tutak_test"
set -u
SRC="${1:?source (local test) database URL}"; SRC="${SRC%%\?*}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; V="$HERE/verify-restored-db.sh"
ADMIN="${SRC%/*}/postgres"; TEMPLATE="$(basename "$SRC")"
DB="verify_rt_$$"; COPY="${SRC%/*}/$DB"; EMPTY="verify_rt_empty_$$"
cleanup() { psql "$ADMIN" -X -q -c "drop database if exists $DB (force)" >/dev/null 2>&1; psql "$ADMIN" -X -q -c "drop database if exists $EMPTY (force)" >/dev/null 2>&1; }
trap cleanup EXIT
fresh() { psql "$ADMIN" -X -q -c "drop database if exists $DB (force)" >/dev/null 2>&1; psql "$ADMIN" -X -q -c "create database $DB template $TEMPLATE" >/dev/null || { echo "cannot create scratch db"; exit 2; }; }
mut() { psql "$COPY" -X -q -v ON_ERROR_STOP=1 -c "$1" >/dev/null || { echo "  (mutation failed: $1)"; return 1; }; }
seed() { # a user, a wallet, two balanced ledger accounts — enough for every check to have rows
  mut "insert into users (id, phone, \"passwordHash\", \"firstName\", \"lastName\", \"updatedAt\") values ('u-seed', '+37400000001', 'x', 'S', 'S', now()) on conflict do nothing"
  mut "insert into wallets (id, \"userId\", \"updatedAt\") values ('w-seed', 'u-seed', now()) on conflict do nothing"
  mut "insert into ledger_accounts (id, type, \"updatedAt\", balance) values ('la-seed-1', 'CUSTOMER_PAYABLE', now(), 0), ('la-seed-2', 'PARTNER_PAYABLE', now(), 0) on conflict do nothing"
}
n=0; fails=0
check() { # name expected_exit [args...]
  local name="$1" want="$2"; shift 2
  "$V" "$@" > /tmp/vr.out 2>&1; local got=$?
  n=$((n+1))
  if [ "$got" = "$want" ]; then echo "ok   $name (exit $got)"; else echo "FAIL $name: exit $got want $want"; sed 's/^/     /' /tmp/vr.out | grep -E "FAIL|refus|cannot|usage" | head -5; fails=$((fails+1)); fi
}

fresh; seed
check "seeded copy passes"                      0 "$COPY" --expect-migrations 71
check "compare with source passes (copy has +seed rows → FAIL expected)" 1 "$COPY" --compare "$SRC"
fresh
check "identical copy vs source passes"         0 "$COPY" --compare "$SRC"
check "source == restored refused"              2 "$COPY" --compare "$COPY"
check "bad URL refused"                         2 "not-a-url"
check "unreachable host"                        2 "postgresql://x:y@127.0.0.1:1/nope"
check "production private host refused"        2 "postgresql://u:p@postgres.railway.internal:5432/railway"
check "wrong migration count"                   1 "$COPY" --expect-migrations 70

# A negative wallet cannot even be written: the DB check constraint
# wallets_balances_non_negative refuses it, so that check in the verifier is a
# belt over the schema's braces. Proven here instead of faked:
fresh; seed
if psql "$COPY" -X -q -v ON_ERROR_STOP=1 -c "update wallets set \"availableBonus\" = -1 where id = 'w-seed'" >/dev/null 2>&1; then echo "FAIL schema allowed a negative wallet"; fails=$((fails+1)); else echo "ok   negative wallet refused by the schema itself"; fi; n=$((n+1))
fresh; seed; mut "update ledger_accounts set balance = balance + 1 where id = 'la-seed-1'"
check "ledger imbalance fails"                  1 "$COPY"
fresh; seed; mut "insert into ledger_accounts (id, type, \"updatedAt\", balance) values ('la-seed-3', 'PSP_RECEIVABLE', now(), 0)"; mut "update ledger_accounts set balance = 7 where id = 'la-seed-3'"; mut "update ledger_accounts set balance = -7 where id = 'la-seed-2'"; mut "update ledger_accounts set balance = 0 where id = 'la-seed-1'"
check "account balance without postings fails (accounts_match_postings)" 1 "$COPY"
fresh
if [ "$(psql "$COPY" -Atc "select count(*) from purchase_intents")" != "0" ]; then
  mut "update purchase_intents set \"refundedAmount\" = \"grossAmount\" + 1 where id = (select id from purchase_intents limit 1)"
  check "refund > gross fails"                  1 "$COPY"
else echo "skip refund > gross (no purchase rows in the template)"; fi
fresh; mut "delete from _prisma_migrations where migration_name = (select migration_name from _prisma_migrations order by started_at desc limit 1)"
check "missing migration fails (expect 71)"     1 "$COPY" --expect-migrations 71
fresh; mut "insert into _prisma_migrations (id, checksum, finished_at, migration_name, started_at, applied_steps_count) select gen_random_uuid()::text, checksum, finished_at, migration_name, started_at, applied_steps_count from _prisma_migrations limit 1"
check "duplicate migration fails"               1 "$COPY"
fresh; mut "update _prisma_migrations set finished_at = null where migration_name = (select migration_name from _prisma_migrations limit 1)"
check "unfinished migration fails"              1 "$COPY"
fresh; mut "drop table referral_invites cascade"
check "missing table fails"                     1 "$COPY"
fresh; mut "insert into users (id, phone, \"passwordHash\", \"firstName\", \"lastName\", \"updatedAt\") values ('u-extra', '+37499999999', 'x', 'E', 'E', now())"
check "restored has more rows than source -> fail" 1 "$COPY" --compare "$SRC"

psql "$ADMIN" -X -q -c "create database $EMPTY" >/dev/null
check "empty database fails cleanly"            1 "${SRC%/*}/$EMPTY"

fresh
PGOPTIONS="-c default_transaction_read_only=on" psql "$COPY" -X -q -v ON_ERROR_STOP=1 -c "update users set \"firstName\"='x' where false" >/dev/null 2>&1 && { echo "FAIL read-only session allowed a write"; fails=$((fails+1)); } || echo "ok   read-only session refuses writes"
n=$((n+1))
grep -Eq "^\s*(update|insert|delete|drop|alter|truncate)\b" "$V" && { echo "FAIL script contains a write statement"; fails=$((fails+1)); } || echo "ok   script contains no write statements"
n=$((n+1))
echo "$((n-fails))/$n passed"; [ "$fails" -eq 0 ]
