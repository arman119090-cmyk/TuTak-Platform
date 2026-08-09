#!/usr/bin/env bash
#
# Proves the whole point-in-time recovery chain actually works, end to end,
# without touching anything real.
#
#   ./scripts/pitr-rehearse.sh
#
# ## Why this is a script and not a paragraph in a runbook
#
# Every part of PITR looks fine right up until you need it. Archiving can be
# on while `archive_command` silently fails. A base backup can be perfect and
# unrestorable because the WAL covering it was pruned. The restore can run and
# produce a database from the wrong moment. None of that is visible from
# `select 1`.
#
# So this drill does the only thing that settles it: it writes rows, takes a
# base backup, writes more rows, records a safe point, destroys the rows,
# recovers to the safe point in a second cluster, and checks that what came
# back is what should have come back — the rows from after the base backup
# present, the damage after the safe point absent.
#
# It works on a table it creates for the purpose, so nothing on the real
# database is at risk. WAL replay does not care which table it is replaying;
# a drill that proves recovery for `pitr_rehearsal` has proven it for
# `ledger_postings`.
#
# **Run it after any change to the archive, the backup schedule, the Postgres
# version, or the machine that stores backups.** Those are the four things
# that break a chain that worked last month.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

WORK="${PITR_REHEARSAL_DIR:-/tmp/tutak-pitr-rehearsal}"
PORT="${PITR_RESTORE_PORT:-5433}"
TABLE="pitr_rehearsal"

green() { printf '\033[0;32m%s\033[0m\n' "$1"; }
info()  { printf '\033[0;36m▸ %s\033[0m\n' "$1"; }
die()   { printf '\033[0;31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

if [[ -z "${DATABASE_URL:-}" && -f apps/api/.env ]]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' apps/api/.env | head -1 | cut -d= -f2- | tr -d '"')"
fi
DATABASE_URL="${DATABASE_URL:-postgresql://tutak:tutak_dev_password@127.0.0.1:5432/tutak?schema=public}"
PG_URL="${DATABASE_URL%%\?*}"

Q() { psql "$PG_URL" -Atc "$1"; }

# Switching WAL and forcing a checkpoint need more than the application role
# has. Where a superuser is not available the drill can still run, it just
# waits for a segment to fill on its own — which on an idle database is
# never. Better to say so than to hang.
PRIV() {
  if psql "$PG_URL" -Atc "select pg_switch_wal()" >/dev/null 2>&1; then return 0; fi
  if command -v su >/dev/null 2>&1 && [[ "$(id -u)" -eq 0 ]]; then
    su postgres -c "psql -d ${PG_URL##*/} -Atc 'select pg_switch_wal()'" >/dev/null 2>&1 && return 0
  fi
  return 1
}

rm -rf "$WORK"
mkdir -p "$WORK"

# ── 1. State that predates the base backup ──────────────────────────────
info "Setting up"
Q "drop table if exists $TABLE" >/dev/null
Q "create table $TABLE (id serial primary key, note text, at timestamptz default now())" >/dev/null
Q "insert into $TABLE (note) values ('before the base backup')" >/dev/null

# ── 2. Base backup ──────────────────────────────────────────────────────
info "Taking a base backup"
./scripts/pitr-basebackup.sh "$WORK/base" >"$WORK/basebackup.log" 2>&1 \
  || { tail -20 "$WORK/basebackup.log" >&2; die "base backup failed"; }
BASE="$(find "$WORK/base" -maxdepth 1 -name 'base-*' -type d | sort | tail -1)"
[[ -n "$BASE" ]] || die "no base backup directory was produced"
green "  ✓ $BASE"

# ── 3. Business as usual, after the base backup ─────────────────────────
# These rows exist only in the WAL. If they come back, replay worked; if the
# recovery stops at the base backup they will be missing, which is the
# failure this whole drill is looking for.
info "Writing rows that exist only in the WAL"
Q "insert into $TABLE (note) values ('after the base backup — must survive')" >/dev/null
Q "insert into $TABLE (note) values ('also after the base backup — must survive')" >/dev/null

sleep 2
SAFE="$(Q 'select now()')"
info "Safe point: $SAFE"
sleep 2

# ── 4. The accident ─────────────────────────────────────────────────────
info "Destroying the table, then writing a row that must not survive"
Q "truncate $TABLE" >/dev/null
Q "insert into $TABLE (note) values ('after the accident — must NOT survive')" >/dev/null

# ── 5. Push the WAL out to the archive ──────────────────────────────────
PRIV || die "cannot switch WAL — run this as a role with the pg_checkpoint / superuser rights, otherwise the segment holding the drill never reaches the archive."
sleep 3
ARCHIVED="$(find "${PITR_ARCHIVE_DIR:-/var/lib/tutak/wal-archive}" -type f 2>/dev/null | wc -l)"
info "$ARCHIVED segments in the archive"

FAILED="$(Q "select failed_count from pg_stat_archiver" 2>/dev/null || echo 0)"
[[ "$FAILED" == "0" ]] || die "pg_stat_archiver reports $FAILED failed archive attempts. The archive is not trustworthy — fix archive_command before relying on any of this."

# ── 6. Recover to the safe point ────────────────────────────────────────
info "Recovering to the safe point in a separate cluster on port $PORT"
./scripts/pitr-restore.sh --base "$BASE" --target "$SAFE" \
  --into "$WORK/recovered" --port "$PORT" --keep-running >"$WORK/restore.log" 2>&1 \
  || { tail -25 "$WORK/restore.log" >&2; die "recovery failed"; }

R() {
  if [[ "$(id -u)" -eq 0 ]]; then
    su postgres -s /bin/bash -c "psql -h /tmp -p $PORT -d ${PG_URL##*/} -Atc \"$1\""
  else
    psql -h /tmp -p "$PORT" -d "${PG_URL##*/}" -Atc "$1"
  fi
}

# ── 7. Was it the right moment? ─────────────────────────────────────────
SURVIVED="$(R "select count(*) from $TABLE where note like '%must survive%'")"
LEAKED="$(R "select count(*) from $TABLE where note like '%must NOT survive%'")"
TOTAL="$(R "select count(*) from $TABLE")"

echo
if [[ "$SURVIVED" != "2" ]]; then
  die "FAILED: expected 2 post-base-backup rows, recovered $SURVIVED. WAL replay did not reach the safe point — the recovery stopped early or the archive has a hole."
fi
if [[ "$LEAKED" != "0" ]]; then
  die "FAILED: $LEAKED row(s) from after the accident survived. The recovery overshot its target — check that recovery_target_time was applied."
fi
if [[ "$TOTAL" != "3" ]]; then
  die "FAILED: recovered $TOTAL rows, expected 3 (one from before the base backup, two from the WAL)."
fi

green "PASS — recovery landed on the safe point"
echo "  · 1 row from before the base backup    (came from the base)"
echo "  · 2 rows written after the base backup (came from replayed WAL)"
echo "  · 0 rows from after the accident       (correctly cut off)"

# ── 8. Clean up ─────────────────────────────────────────────────────────
info "Cleaning up"
PGBIN="$(dirname "$(ls /usr/lib/postgresql/*/bin/pg_ctl 2>/dev/null | tail -1)")"
if [[ -n "$PGBIN" ]]; then
  if [[ "$(id -u)" -eq 0 ]]; then
    su postgres -s /bin/bash -c "$PGBIN/pg_ctl -D '$WORK/recovered' -m fast -w stop" >/dev/null 2>&1 || true
  else
    "$PGBIN/pg_ctl" -D "$WORK/recovered" -m fast -w stop >/dev/null 2>&1 || true
  fi
fi
Q "drop table if exists $TABLE" >/dev/null
green "Done. Working files are in $WORK — delete them when you have read the logs."
