#!/usr/bin/env bash
#
# One command that says whether a restored TuTak database is fit to switch
# traffic to. Read-only by construction: every statement runs in a session
# with `default_transaction_read_only=on`, so even a typo in this file cannot
# write. Point it at the RESTORED database.
#
#   scripts/verify-restored-db.sh "postgresql://user:pass@host:5432/railway"
#   scripts/verify-restored-db.sh "$RESTORED_URL" --expect-migrations 71
#   scripts/verify-restored-db.sh "$RESTORED_URL" --compare "$SOURCE_URL"
#
# With --compare the same counts are read from the source and printed side by
# side, so "restored to 10:42" can be checked against "source at now". The
# source is read once, before the restored one, so a busy source cannot make
# the two columns disagree with themselves; a restored count that is larger
# than the source is a FAIL (a restore cannot contain rows the source never had).
#
# Refuses: an empty/invalid URL; the same URL for restored and source; a host
# that is the production private endpoint (`postgres.railway.internal`) unless
# --i-am-sure-this-is-restored is given — the realistic mistake is pasting the
# production URL into the "restored" slot, and this refuses to bless that.
#
# Exit 0 = every check PASS; 1 = at least one FAIL; 2 = usage or cannot connect.
set -u
URL="${1:-}"; shift || true
[ -n "$URL" ] || { echo "usage: $0 <restored DATABASE_URL> [--expect-migrations N] [--compare <source URL>] [--i-am-sure-this-is-restored]" >&2; exit 2; }
EXPECT_MIGRATIONS=""; COMPARE=""; SURE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --expect-migrations) EXPECT_MIGRATIONS="${2:-}"; shift 2;;
    --compare) COMPARE="${2:-}"; shift 2;;
    --i-am-sure-this-is-restored) SURE=1; shift;;
    *) echo "unknown option: $1" >&2; exit 2;;
  esac
done
URL="${URL%%\?*}"; COMPARE="${COMPARE%%\?*}"   # psql rejects Prisma's ?schema=
case "$URL" in postgres://*|postgresql://*) ;; *) echo "restored URL must start with postgres:// or postgresql://" >&2; exit 2;; esac
if [ -n "$COMPARE" ] && [ "$COMPARE" = "$URL" ]; then echo "restored and source URL are the same — that verifies nothing" >&2; exit 2; fi
host_of() { printf '%s' "$1" | sed -E 's#^[a-z]+://([^@]*@)?([^/:?]+).*#\2#'; }
if [ "$SURE" != "1" ] && [ "$(host_of "$URL")" = "postgres.railway.internal" ]; then
  echo "the restored URL points at the PRODUCTION private endpoint (postgres.railway.internal)." >&2
  echo "A restored service is named postgres-restored-…; pass --i-am-sure-this-is-restored to override." >&2
  exit 2
fi

# Read-only session, whatever the file says below.
export PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=60000"
q() { psql "$1" -X -A -t -v ON_ERROR_STOP=1 -c "$2" 2>/dev/null; }
q_err() { psql "$1" -X -A -t -v ON_ERROR_STOP=1 -c "$2" 2>&1 >/dev/null | head -n1; }

if [ "$(q "$URL" "select 1")" != "1" ]; then echo "cannot connect to the restored database: $(q_err "$URL" "select 1")"; exit 2; fi
if [ "$(q "$URL" "show default_transaction_read_only")" != "on" ]; then echo "session is not read-only; refusing to continue" >&2; exit 2; fi
# Prove it, once: a write must fail in this session.
if psql "$URL" -X -q -v ON_ERROR_STOP=1 -c "create temp table verify_ro_probe(x int)" >/dev/null 2>&1; then
  echo "read-only guard did not hold (a temp table could be created); refusing to continue" >&2; exit 2
fi

fails=0; TABLES="users partners purchase_intents ledger_transactions ledger_postings ledger_accounts bonus_lots wallets partner_settlements purchase_intent_refunds referral_invites"
row() { printf '%-4s %-36s %-26s %s\n' "$1" "$2" "$3" "$4"; [ "$1" = FAIL ] && fails=$((fails+1)); return 0; }

# Source first (see header).
declare -A SRC
if [ -n "$COMPARE" ]; then
  if [ "$(q "$COMPARE" "select 1")" != "1" ]; then echo "cannot connect to the source database for --compare: $(q_err "$COMPARE" "select 1")" >&2; exit 2; fi
  for t in $TABLES; do SRC[$t]=$(q "$COMPARE" "select count(*) from $t"); done
fi

# Schema present at all?
if [ "$(q "$URL" "select to_regclass('public._prisma_migrations') is not null")" != "t" ]; then
  row FAIL schema_present "no _prisma_migrations" "this is an empty or foreign database, not a TuTak restore"
  echo; echo "RESTORED DB: FAIL — $fails check(s) failed; do not switch"; exit 1
fi
applied=$(q "$URL" "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")
failed=$(q "$URL" "select count(*) from _prisma_migrations where finished_at is null or rolled_back_at is not null")
dups=$(q "$URL" "select count(*) from (select migration_name from _prisma_migrations group by migration_name having count(*) > 1) d")
if [ -n "$EXPECT_MIGRATIONS" ] && [ "$applied" != "$EXPECT_MIGRATIONS" ]; then row FAIL migrations_applied "$applied" "expected $EXPECT_MIGRATIONS"; else row PASS migrations_applied "$applied" "${EXPECT_MIGRATIONS:+expected $EXPECT_MIGRATIONS}"; fi
if [ "$failed" = "0" ]; then row PASS migrations_failed 0 ""; else row FAIL migrations_failed "$failed" "a failed/rolled-back migration is present"; fi
if [ "$dups" = "0" ]; then row PASS migrations_unique 0 ""; else row FAIL migrations_unique "$dups" "duplicate migration names"; fi
missing=""
for t in $TABLES; do [ "$(q "$URL" "select to_regclass('public.$t') is not null")" = "t" ] || missing="$missing $t"; done
if [ -z "$missing" ]; then row PASS tables_present "$(echo $TABLES | wc -w)" ""; else row FAIL tables_present "missing:$missing" "schema incomplete"; fi

for t in $TABLES; do
  [ -z "$missing" ] || case " $missing " in *" $t "*) continue;; esac
  c=$(q "$URL" "select count(*) from $t")
  if [ -n "$COMPARE" ]; then
    s="${SRC[$t]}"
    if [ "$c" -gt "$s" ] 2>/dev/null; then row FAIL "rows:$t" "$c" "MORE than source ($s) — not a restore of this source"
    elif [ "$c" -lt "$s" ] 2>/dev/null; then row INFO "rows:$t" "$c" "source now: $s (−$((s-c)) since the restore point; expected if the source kept working)"
    else row INFO "rows:$t" "$c" "source now: $s"; fi
  else row INFO "rows:$t" "$c" ""; fi
done
confirmed=$(q "$URL" "select count(*) from purchase_intents where status = 'CONFIRMED'"); row INFO rows:purchase_intents_CONFIRMED "$confirmed" ""

imb=$(q "$URL" "select coalesce(sum(balance),0) from ledger_accounts")
if awk -v v="$imb" 'BEGIN{exit (v+0==0?0:1)}'; then row PASS ledger_imbalance "$imb" "sum of all account balances"; else row FAIL ledger_imbalance "$imb" "must be 0"; fi
mism=$(q "$URL" "select count(*) from (select a.id from ledger_accounts a left join ledger_postings p on p.\"accountId\"=a.id group by a.id, a.balance having a.balance <> coalesce(sum(case when p.direction='DEBIT' then p.amount else -p.amount end),0)) x")
if [ "$mism" = "0" ]; then row PASS accounts_match_postings 0 ""; else row FAIL accounts_match_postings "$mism" "accounts whose balance != their postings"; fi
unbal=$(q "$URL" "select count(*) from (select \"transactionId\" from ledger_postings group by \"transactionId\" having sum(case when direction='DEBIT' then amount else -amount end) <> 0) x")
if [ "$unbal" = "0" ]; then row PASS transactions_balanced 0 ""; else row FAIL transactions_balanced "$unbal" "ledger transactions that do not sum to 0"; fi
neg=$(q "$URL" "select count(*) from wallets where \"availableBonus\" < 0 or \"pendingBonus\" < 0 or \"reservedBonus\" < 0")
if [ "$neg" = "0" ]; then row PASS wallets_non_negative 0 ""; else row FAIL wallets_non_negative "$neg" "wallets with a negative balance"; fi
lots=$(q "$URL" "select count(*) from bonus_lots where \"remainingAmount\" > \"originalAmount\" or \"remainingAmount\" < 0")
if [ "$lots" = "0" ]; then row PASS bonus_lots_consistent 0 ""; else row FAIL bonus_lots_consistent "$lots" "lots with remaining > original or < 0"; fi
over=$(q "$URL" "select count(*) from purchase_intents where \"refundedAmount\" > \"grossAmount\"")
if [ "$over" = "0" ]; then row PASS refunds_within_gross 0 ""; else row FAIL refunds_within_gross "$over" "purchases refunded above their amount"; fi
orphan=$(q "$URL" "select count(*) from ledger_postings p where not exists (select 1 from ledger_transactions t where t.id = p.\"transactionId\")")
if [ "$orphan" = "0" ]; then row PASS postings_have_transactions 0 ""; else row FAIL postings_have_transactions "$orphan" "postings without a transaction"; fi

last_pi=$(q "$URL" "select coalesce(max(\"createdAt\")::text,'-') from purchase_intents"); row INFO last_purchase_intent_at "$last_pi" "restore point by data"
last_tx=$(q "$URL" "select coalesce(max(\"postedAt\")::text,'-') from ledger_transactions"); row INFO last_ledger_posting_at "$last_tx" ""

echo
if [ "$fails" -eq 0 ]; then echo "RESTORED DB: PASS — fit to switch traffic to (after the row counts make sense to a human)"; exit 0
else echo "RESTORED DB: FAIL — $fails check(s) failed; do not switch"; exit 1; fi
