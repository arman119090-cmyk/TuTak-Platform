#!/usr/bin/env bash
#
# Takes the base backup that point-in-time recovery replays WAL on top of.
#
#   ./scripts/pitr-basebackup.sh                  # into ./backups/base
#   ./scripts/pitr-basebackup.sh /mnt/backups
#
# ## Why this exists next to backup.sh rather than instead of it
#
# `backup.sh` takes a `pg_dump`. A dump is a logical export — portable
# between major versions, restorable table by table, and **useless as a PITR
# base**, because WAL replays physical block changes and a dump has no blocks
# to replay onto. PITR needs `pg_basebackup`, a physical copy of the cluster.
#
# The two answer different questions and you want both:
#
#   backup.sh          "give me the database as it was at 03:00"
#   this + WAL archive "give me the database as it was at 14:52:07"
#
# The second is what you reach for after somebody runs the wrong UPDATE at
# 14:53. The first is what you reach for when the second cannot be restored,
# which is the whole reason for keeping two mechanisms with different
# failure modes.
#
# ## Ordering
#
# A base backup is only usable together with every WAL segment produced from
# the moment it started. Take the base *after* archiving is on, never before,
# and never delete WAL newer than your oldest base you still intend to use.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT_DIR="${1:-$ROOT/backups/base}"
RETAIN_DAYS="${PITR_BASE_RETAIN_DAYS:-14}"

green() { printf '\033[0;32m%s\033[0m\n' "$1"; }
info()  { printf '\033[0;36m▸ %s\033[0m\n' "$1"; }
warn()  { printf '\033[0;33m⚠ %s\033[0m\n' "$1"; }
die()   { printf '\033[0;31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

if [[ -z "${DATABASE_URL:-}" && -f apps/api/.env ]]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' apps/api/.env | head -1 | cut -d= -f2- | tr -d '"')"
fi
DATABASE_URL="${DATABASE_URL:-postgresql://tutak:tutak_dev_password@127.0.0.1:5432/tutak?schema=public}"
PG_URL="${DATABASE_URL%%\?*}"

command -v pg_basebackup >/dev/null 2>&1 \
  || die "pg_basebackup is not installed (apt install postgresql-client)."

# ── Refuse to take a base that cannot be replayed onto ───────────────────
# A base backup taken while archiving is off looks perfectly successful and
# is worthless for PITR: the segments covering the window after it were
# never kept. Better to fail here than to discover it during a recovery.
ARCHIVE_MODE="$(psql "$PG_URL" -Atc 'show archive_mode' 2>/dev/null || echo unknown)"
if [[ "$ARCHIVE_MODE" != "on" && "$ARCHIVE_MODE" != "always" ]]; then
  die "archive_mode is '$ARCHIVE_MODE'. Turn on WAL archiving before taking a base backup, or this base can only ever restore to the instant it was taken. See docs/DEPLOYMENT.md §7c."
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$OUT_DIR/base-$STAMP"
mkdir -p "$DEST"

info "Base backup into $DEST"
# -Ft -z    tar, gzipped: one file per tablespace, cheap to copy off-box.
# -Xs       stream WAL on a second connection while the copy runs, so the
#           base is self-consistent even if the copy takes longer than
#           wal_keep_size covers. Without it a long backup on a busy cluster
#           can finish already missing the WAL it needs to be consistent.
# -P        progress, because this is the slow one and silence looks hung.
pg_basebackup --dbname="$PG_URL" --pgdata="$DEST" --format=tar --gzip \
  --wal-method=stream --checkpoint=fast --progress \
  || die "pg_basebackup failed — $DEST is incomplete, delete it."

[[ -f "$DEST/base.tar.gz" ]] || die "no base.tar.gz in $DEST — the backup did not produce a cluster."
SIZE="$(du -sh "$DEST" | cut -f1)"
green "  ✓ base backup written, $SIZE"

# Record where in the WAL stream this base sits. `pitr-restore.sh` prints it
# back during a recovery, and it is the fastest way to answer "do I still
# have the segments this base needs?"
psql "$PG_URL" -Atc "select pg_walfile_name(pg_current_wal_lsn())" > "$DEST/START_WAL" 2>/dev/null || true
[[ -s "$DEST/START_WAL" ]] && info "Needs WAL from around $(cat "$DEST/START_WAL")"

# ── Encrypt ─────────────────────────────────────────────────────────────
AGE_RECIPIENT="${BACKUP_AGE_RECIPIENT:-}"
if [[ -n "$AGE_RECIPIENT" ]]; then
  command -v age >/dev/null 2>&1 || die "BACKUP_AGE_RECIPIENT is set but age is not installed."
  info "Encrypting for $AGE_RECIPIENT"
  for f in "$DEST"/*.tar.gz; do
    age --encrypt --recipient "$AGE_RECIPIENT" --output "$f.age" "$f"
    shred --remove --zero "$f" 2>/dev/null || rm -f "$f"
  done
  green "  ✓ encrypted, plaintext removed"
else
  warn "Unencrypted. A base backup is the whole database — set BACKUP_AGE_RECIPIENT before copying it anywhere."
fi

# ── Prune ───────────────────────────────────────────────────────────────
# Deliberately does not touch the WAL archive. Pruning WAL is `pitr-restore.sh
# --prune-wal`'s job, because it is the only thing that knows which base
# backups are still live — deleting a segment that an existing base still
# needs turns that base into an unrestorable pile of blocks.
if [[ "$RETAIN_DAYS" -gt 0 ]]; then
  DELETED=0
  while IFS= read -r old; do
    rm -rf "$old"; DELETED=$((DELETED + 1))
  done < <(find "$OUT_DIR" -maxdepth 1 -name 'base-*' -type d -mtime "+$RETAIN_DAYS")
  [[ "$DELETED" -gt 0 ]] && info "Pruned $DELETED base backup(s) older than $RETAIN_DAYS days"
fi

echo
green "Base backup complete: $DEST"
echo "Rehearse a recovery — an untested PITR chain is a hypothesis:"
echo "  ./scripts/pitr-restore.sh --base $DEST --target '$(date -u +%Y-%m-%dT%H:%M:%S)Z' --into /tmp/pitr-rehearsal"
