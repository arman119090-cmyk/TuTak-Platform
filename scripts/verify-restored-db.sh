#!/usr/bin/env bash
#
# One command that says whether a restored TuTak database is fit to switch
# traffic to. Read-only. Point it at the RESTORED database, never at
# production (it would not hurt production — every statement is a SELECT —
# but the answer would be about the wrong database).
#
#   scripts/verify-restored-db.sh "postgresql://user:pass@host:5432/railway"
#   scripts/verify-restored-db.sh "$RESTORED_URL" --expect-migrations 71
#   scripts/verify-restored-db.sh "$RESTORED_URL" --compare "$SOURCE_URL"
#
# With --compare the same counts are read from the source and printed side by
# side, so "restored to 10:42" can be checked against "source at now".
#
# Exit 0 = every check PASS; 1 = at least one FAIL; 2 = could not connect.
set -u
URL="${1:?restored database URL}"; shift || true
EXPECT_MIGRATIONS=""; COMPARE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --expect-migrations) EXPECT_MIGRATIONS="$2"; shift 2;;
    --compare) COMPARE="$2"; shift 2;;
    *) echo "unknown option: $1" >&2; exit 2;;
  esac
done
URL="${URL%%\?*}"; COMPARE="${COMPARE%%\?*}"   # psql rejects Prisma's ?schema=
q() { psql "$1" -X -A -t -v ON_ERROR_STOP=1 -c "$2" 2>&1; }

if ! q "$URL" "select 1" >/dev/null; then echo "cannot connect to the restored database"; exit 2; fi

fails=0
row() { # status name value note
  printf '%-4s %-34s %-24s %s\n' "$1" "$2" "$3" "$4"; [ "$1" = FAIL ] && fails=$((fails+1)); return 0; }

applied=$(q "$URL" "select count(*) from _prisma_migrations where finished_at is not null")
failed=$(q "$URL" "select count(*) from _prisma_migrations where finished_at is null or rolled_back_at is not null")
if [ -n "$EXPECT_MIGRATIONS" ] && [ "$applied" != "$EXPECT_MIGRATIONS" ]; then row FAIL migrations_applied "$applied" "expected $EXPECT_MIGRATIONS"; else row PASS migrations_applied "$applied" ""; fi
if [ "$failed" = "0" ]; then row PASS migrations_failed 0 ""; else row FAIL migrations_failed "$failed" "a failed/rolled-back migration is present"; fi

for t in users partners purchase_intents ledger_transactions ledger_postings ledger_accounts bonus_lots wallets partner_settlements purchase_intent_refunds referral_invites; do
  c=$(q "$URL" "select count(*) from $t")
  if [ -n "$COMPARE" ]; then s=$(q "$COMPARE" "select count(*) from $t"); row INFO "rows:$t" "$c" "source now: $s"; else row INFO "rows:$t" "$c" ""; fi
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

last_pi=$(q "$URL" "select coalesce(max(\"createdAt\")::text,'-') from purchase_intents"); row INFO last_purchase_intent_at "$last_pi" "restore point by data"
last_tx=$(q "$URL" "select coalesce(max(\"postedAt\")::text,'-') from ledger_transactions"); row INFO last_ledger_posting_at "$last_tx" ""

echo
if [ "$fails" -eq 0 ]; then echo "RESTORED DB: PASS — fit to switch traffic to (after the row counts make sense to a human)"; exit 0
else echo "RESTORED DB: FAIL — $fails check(s) failed; do not switch"; exit 1; fi
