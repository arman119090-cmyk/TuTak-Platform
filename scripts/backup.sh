#!/usr/bin/env bash
#
# Takes a compressed, verifiable backup of the TuTak database.
#
#   ./scripts/backup.sh                    # into ./backups
#   ./scripts/backup.sh /mnt/backups       # somewhere else
#
# Reads DATABASE_URL from the environment, or from apps/api/.env, or falls
# back to the local demo database.
#
# Uses pg_dump's custom format (-Fc) rather than plain SQL: it is compressed,
# it can be restored selectively, and `pg_restore --list` can read its table
# of contents — which is what makes the integrity check below possible
# without restoring anything.
#
# Set BACKUP_AGE_RECIPIENT (an `age` public key) or BACKUP_GPG_RECIPIENT to
# encrypt each dump as it is written. Do that on any machine that is not the
# only place the data lives: the dump contains every phone number and every
# password hash on the platform, in the clear, in a file whose whole purpose
# is to be copied somewhere else.
#
# Encryption is public-key on purpose. The machine taking backups holds only
# the key that can *write* them, so somebody who takes that machine gets
# tomorrow's backups and not yesterday's.
#
# This script does not replace point-in-time recovery on a managed Postgres.
# A nightly dump loses up to a day; PITR loses seconds. Run both.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT_DIR="${1:-$ROOT/backups}"
RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-14}"

green() { printf '\033[0;32m%s\033[0m\n' "$1"; }
info()  { printf '\033[0;36m▸ %s\033[0m\n' "$1"; }
die()   { printf '\033[0;31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

# ── Where to dump from ──────────────────────────────────────────────────
if [[ -z "${DATABASE_URL:-}" && -f apps/api/.env ]]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' apps/api/.env | head -1 | cut -d= -f2- | tr -d '"')"
fi
DATABASE_URL="${DATABASE_URL:-postgresql://tutak:tutak_dev_password@127.0.0.1:5432/tutak?schema=public}"

# Prisma's `?schema=` is not a libpq parameter — pg_dump rejects the whole
# URI over it. Everything after the ? is Prisma's business, not Postgres's.
PG_URL="${DATABASE_URL%%\?*}"

command -v pg_dump >/dev/null 2>&1 || die "pg_dump is not installed (apt install postgresql-client)."

mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$OUT_DIR/tutak-$STAMP.dump"

# ── Dump ────────────────────────────────────────────────────────────────
info "Dumping to $FILE"
# --no-owner and --no-privileges so the dump restores into a database owned
# by whoever is restoring it, which is rarely the same role in an emergency.
pg_dump --format=custom --compress=9 --no-owner --no-privileges \
  --file="$FILE" "$PG_URL"

SIZE="$(du -h "$FILE" | cut -f1)"
green "  ✓ wrote $SIZE"

# ── Verify ──────────────────────────────────────────────────────────────
# A dump nobody has read is a hypothesis. This does not prove the data is
# restorable — only `restore.sh --verify` does that — but it does prove the
# file is a complete, non-truncated archive rather than the first half of
# one written before the disk filled.
info "Verifying the archive is readable"
TABLES="$(pg_restore --list "$FILE" | grep -c 'TABLE DATA' || true)"
[[ "$TABLES" -gt 0 ]] || die "The archive contains no table data. Do not trust this backup."
green "  ✓ archive readable, $TABLES tables with data"

# The tables that would hurt most to lose, checked by name so a dump taken
# against the wrong database is caught here rather than during a restore.
for table in ledger_postings ledger_transactions payments wallets bonus_lots; do
  pg_restore --list "$FILE" | grep -q "TABLE DATA public $table " \
    || die "Missing $table — this dump is not a TuTak database."
done
green "  ✓ every money-bearing table is present"

# ── Encrypt ─────────────────────────────────────────────────────────────
# Deliberately after the verification above: a dump is checked while it is
# still readable, because an encrypted archive cannot be inspected without
# the private key — which by design is not on this machine.
AGE_RECIPIENT="${BACKUP_AGE_RECIPIENT:-}"
GPG_RECIPIENT="${BACKUP_GPG_RECIPIENT:-}"

if [[ -n "$AGE_RECIPIENT" ]]; then
  command -v age >/dev/null 2>&1 || die "BACKUP_AGE_RECIPIENT is set but age is not installed."
  info "Encrypting for $AGE_RECIPIENT"
  age --encrypt --recipient "$AGE_RECIPIENT" --output "$FILE.age" "$FILE"
  # Overwrite before unlinking. `rm` returns the blocks to the filesystem
  # with the plaintext still in them, and this one holds every phone number
  # on the platform.
  shred --remove --zero "$FILE" 2>/dev/null || rm -f "$FILE"
  FILE="$FILE.age"
  green "  ✓ encrypted, plaintext removed"
elif [[ -n "$GPG_RECIPIENT" ]]; then
  command -v gpg >/dev/null 2>&1 || die "BACKUP_GPG_RECIPIENT is set but gpg is not installed."
  info "Encrypting for $GPG_RECIPIENT"
  gpg --batch --yes --trust-model always --encrypt --recipient "$GPG_RECIPIENT" \
    --output "$FILE.gpg" "$FILE"
  shred --remove --zero "$FILE" 2>/dev/null || rm -f "$FILE"
  FILE="$FILE.gpg"
  green "  ✓ encrypted, plaintext removed"
else
  # Loud, because the failure mode is silent: an unencrypted dump looks
  # exactly like an encrypted one until somebody reads it.
  printf '\033[0;33m⚠ Unencrypted. This file holds every phone number and password hash on\033[0m\n'
  printf '\033[0;33m  the platform. Set BACKUP_AGE_RECIPIENT before copying it anywhere.\033[0m\n'
fi

# ── Prune ───────────────────────────────────────────────────────────────
if [[ "$RETAIN_DAYS" -gt 0 ]]; then
  DELETED="$(find "$OUT_DIR" \( -name 'tutak-*.dump' -o -name 'tutak-*.dump.age' \
    -o -name 'tutak-*.dump.gpg' \) -mtime "+$RETAIN_DAYS" -print -delete | wc -l)"
  [[ "$DELETED" -gt 0 ]] && info "Pruned $DELETED backup(s) older than $RETAIN_DAYS days"
fi

echo
green "Backup complete: $FILE"
echo "Rehearse the restore — a backup nobody has restored is a hypothesis:"
if [[ "$FILE" == *.age ]]; then
  echo "  age --decrypt -i <your-private-key> $FILE > restored.dump"
  echo "  ./scripts/restore.sh --verify restored.dump"
  echo
  echo "Rehearse it with the *real* private key, from the machine that would"
  echo "actually do the restoring. An encrypted backup whose key nobody can"
  echo "find is indistinguishable from no backup at all."
elif [[ "$FILE" == *.gpg ]]; then
  echo "  gpg --decrypt $FILE > restored.dump"
  echo "  ./scripts/restore.sh --verify restored.dump"
else
  echo "  ./scripts/restore.sh --verify $FILE"
fi
