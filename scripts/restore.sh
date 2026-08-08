#!/usr/bin/env bash
#
# Restores a TuTak backup — or rehearses the restore without touching
# anything you care about.
#
#   ./scripts/restore.sh --verify backups/tutak-....dump
#       Restores into a scratch database, checks the ledger still balances
#       and every account still agrees with its own postings, then drops it.
#       This is the only thing that turns a backup from a hypothesis into a
#       fact. Run it on a schedule.
#
#   ./scripts/restore.sh --into tutak_recovered backups/tutak-....dump
#       Restores into a named database, creating it if needed.
#
#   ./scripts/restore.sh --force-into tutak backups/tutak-....dump
#       Overwrites an existing database. Refuses without --force-into,
#       because the realistic way to lose a production database is to
#       restore yesterday's backup over today's data by accident.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

green() { printf '\033[0;32m%s\033[0m\n' "$1"; }
info()  { printf '\033[0;36m▸ %s\033[0m\n' "$1"; }
warn()  { printf '\033[0;33m! %s\033[0m\n' "$1"; }
die()   { printf '\033[0;31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

MODE=""
TARGET=""
DUMP=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --verify)     MODE=verify; shift ;;
    --into)       MODE=into; TARGET="$2"; shift 2 ;;
    --force-into) MODE=force; TARGET="$2"; shift 2 ;;
    *)            DUMP="$1"; shift ;;
  esac
done

[[ -n "$DUMP" ]] || die "Usage: restore.sh [--verify | --into DB | --force-into DB] <dump file>"
[[ -f "$DUMP" ]] || die "No such dump: $DUMP"
[[ -n "$MODE" ]] || die "Pick one of --verify, --into DB, --force-into DB."

command -v pg_restore >/dev/null 2>&1 || die "pg_restore is not installed."

if [[ -z "${DATABASE_URL:-}" && -f apps/api/.env ]]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' apps/api/.env | head -1 | cut -d= -f2- | tr -d '"')"
fi
DATABASE_URL="${DATABASE_URL:-postgresql://tutak:tutak_dev_password@127.0.0.1:5432/tutak?schema=public}"

# Prisma's `?schema=` is not a libpq parameter and pg tools reject the URI
# over it, so it is dropped here rather than carried through.
PG_URL="${DATABASE_URL%%\?*}"
# Everything but the database name, so a scratch database can be created on
# the same server with the same credentials.
BASE="${PG_URL%/*}"

if [[ "$MODE" == "verify" ]]; then
  TARGET="tutak_restore_check_$$"
fi

TARGET_URL="$BASE/$TARGET"
ADMIN_URL="$BASE/postgres"

exists() {
  psql "$ADMIN_URL" -tAc "SELECT 1 FROM pg_database WHERE datname='$TARGET'" 2>/dev/null | grep -q 1
}

if exists; then
  [[ "$MODE" == "force" ]] || die "Database '$TARGET' already exists. Use --force-into to overwrite it."
  warn "Overwriting existing database '$TARGET'"
  psql "$ADMIN_URL" -q -c "DROP DATABASE \"$TARGET\" WITH (FORCE)"
fi

info "Creating $TARGET"
psql "$ADMIN_URL" -q -c "CREATE DATABASE \"$TARGET\""

cleanup() {
  if [[ "$MODE" == "verify" ]]; then
    psql "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS \"$TARGET\" WITH (FORCE)" 2>/dev/null || true
  fi
}
trap cleanup EXIT

info "Restoring $DUMP"
# --no-owner because the roles on the machine doing the recovery are rarely
# the ones the dump was taken under. Exit status is checked explicitly:
# pg_restore reports non-fatal warnings through it too.
pg_restore --no-owner --no-privileges --dbname="$TARGET_URL" "$DUMP" 2>/tmp/restore-$$.log || {
  grep -qi 'error' /tmp/restore-$$.log && { cat /tmp/restore-$$.log >&2; die "Restore failed."; }
}
rm -f /tmp/restore-$$.log
green "  ✓ restored"

# ── What makes this a rehearsal rather than a copy ──────────────────────
#
# Restoring without checking proves the file parses. These two checks prove
# the data inside it is a coherent ledger: every account sums to zero
# together, and each account's stored balance still equals a replay of its
# own postings. A backup that restores into a ledger that disagrees with
# itself is not a backup you can recover from.

info "Checking the restored ledger"

ROWS="$(psql "$TARGET_URL" -tAc "SELECT count(*) FROM ledger_accounts")"
info "  $ROWS ledger account(s)"

TOTAL="$(psql "$TARGET_URL" -tAc "SELECT COALESCE(SUM(balance), 0) FROM ledger_accounts")"
if [[ "$(psql "$TARGET_URL" -tAc "SELECT COALESCE(SUM(balance),0) = 0 FROM ledger_accounts")" != "t" ]]; then
  die "Restored ledger does not balance: accounts sum to $TOTAL, expected 0."
fi
green "  ✓ all accounts sum to zero"

DRIFT="$(psql "$TARGET_URL" -tAc "
  SELECT count(*) FROM ledger_accounts a
  WHERE a.balance <> COALESCE((
    SELECT SUM(CASE WHEN p.direction = 'DEBIT' THEN p.amount ELSE -p.amount END)
    FROM ledger_postings p WHERE p.\"accountId\" = a.id
  ), 0)
")"
[[ "$DRIFT" == "0" ]] || die "$DRIFT account(s) disagree with their own postings in the restored copy."
green "  ✓ every account agrees with a replay of its postings"

COUNTS="$(psql "$TARGET_URL" -tAc "
  SELECT (SELECT count(*) FROM payments) || ' payments, '
      || (SELECT count(*) FROM ledger_postings) || ' postings, '
      || (SELECT count(*) FROM wallets) || ' wallets'
")"
info "  $COUNTS"

echo
if [[ "$MODE" == "verify" ]]; then
  green "Restore rehearsal passed. The scratch database has been dropped."
else
  green "Restored into '$TARGET'. Point DATABASE_URL at it when you are ready."
fi
