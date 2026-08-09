#!/bin/sh
#
# Postgres calls this once per completed WAL segment. It is the difference
# between losing a day and losing a few seconds.
#
# Wire it up in postgresql.conf:
#
#   archive_mode = on
#   archive_command = '/usr/local/bin/tutak-pitr-archive.sh "%p" "%f"'
#
# ## POSIX sh, deliberately
#
# Everything else in scripts/ is bash, because an operator runs it from a
# shell they chose. This one is run by the Postgres server process, in
# whatever container Postgres happens to live in — and the official
# `postgres:*-alpine` images have busybox ash and no bash at all. A bash
# shebang here means archiving silently never succeeds on the very image
# docker-compose.yml pulls.
#
# ## Two rules Postgres imposes, and what happens if you break them
#
# **Never overwrite an existing segment with different content.** Postgres
# reuses segment *names*; a name collision with different bytes means the
# archive is being written by two clusters at once, or an old archive is
# being reused for a new one. Silently overwriting turns the archive into a
# mixture of two timelines that will restore into corruption. This script
# compares and refuses.
#
# **A non-zero exit means "not archived".** Postgres keeps the segment in
# pg_wal and retries forever. That is the correct behaviour — it is why a
# failing archive fills the disk instead of losing data — but it means a
# broken archive_command is an outage on a timer. Whatever monitors this
# platform must alert on `pg_stat_archiver.last_failed_time`; the drill in
# scripts/pitr-rehearse.sh refuses to pass while failed_count is non-zero.
#
# ## Environment
#
# Postgres runs this with almost no environment — not your shell's, not the
# API's. It inherits the postmaster's, which under docker-compose is the
# service's `environment:` block. Anything else is read from
# ARCHIVE_ENV_FILE (default /etc/tutak/pitr.env), which must be readable by
# the postgres user:
#
#   PITR_ARCHIVE_DIR=/var/lib/tutak/wal-archive
#   BACKUP_AGE_RECIPIENT=age1...        # optional, strongly recommended
#
# ## Why the segments are encrypted too
#
# A WAL segment carries the rows themselves. Encrypting the nightly dump and
# leaving the WAL in the clear would protect yesterday's phone numbers and
# publish today's. If BACKUP_AGE_RECIPIENT is set, every segment is
# encrypted with the same public key as the dumps, and `pitr-restore.sh`
# needs the private key to replay them. Note that the stock Postgres images
# do not ship `age`: encrypting in-container means building an image that
# has it, or archiving to a volume that something else encrypts.
set -eu

ENV_FILE="${ARCHIVE_ENV_FILE:-/etc/tutak/pitr.env}"
# shellcheck disable=SC1090
[ -r "$ENV_FILE" ] && . "$ENV_FILE"

SRC="${1:?usage: pitr-archive.sh <path-to-wal-file> <wal-file-name>}"
NAME="${2:?usage: pitr-archive.sh <path-to-wal-file> <wal-file-name>}"

ARCHIVE_DIR="${PITR_ARCHIVE_DIR:-/var/lib/tutak/wal-archive}"
AGE_RECIPIENT="${BACKUP_AGE_RECIPIENT:-}"

# Logged to stderr, which Postgres copies into its own log. This is the only
# place a failure here becomes visible, so it says what and why.
fail() { printf 'pitr-archive: %s\n' "$1" >&2; exit 1; }

[ -f "$SRC" ] || fail "source segment $SRC does not exist"
mkdir -p "$ARCHIVE_DIR" || fail "cannot create $ARCHIVE_DIR"

if [ -n "$AGE_RECIPIENT" ]; then
  command -v age >/dev/null 2>&1 || fail "BACKUP_AGE_RECIPIENT is set but age is not installed in this image"
  DEST="$ARCHIVE_DIR/$NAME.age"
else
  DEST="$ARCHIVE_DIR/$NAME"
fi

# ── Already there? ──────────────────────────────────────────────────────
# Postgres retries after any failure, including one that happened *after*
# the file was written, so a segment arriving twice is normal and must not
# be an error. A segment arriving twice with different content is the
# dangerous case and must be.
if [ -e "$DEST" ]; then
  if [ -n "$AGE_RECIPIENT" ]; then
    # Ciphertext differs on every run even for identical input — age uses a
    # fresh ephemeral key per file — so bytes cannot be compared. Size is
    # the only check available without the private key, which by design is
    # not on this machine.
    EXPECTED=$(stat -c%s "$SRC" 2>/dev/null || echo 0)
    ACTUAL=$(stat -c%s "$DEST" 2>/dev/null || echo 0)
    HALF=$((EXPECTED / 2))
    if [ "$ACTUAL" -gt "$HALF" ]; then
      exit 0
    fi
    fail "$NAME already archived at a suspicious size ($ACTUAL vs source $EXPECTED) — refusing to overwrite"
  fi
  if cmp -s "$SRC" "$DEST"; then
    exit 0
  fi
  fail "$NAME already archived with different content — refusing to overwrite. Two clusters may be writing to $ARCHIVE_DIR."
fi

# ── Write ───────────────────────────────────────────────────────────────
# Into a temporary name first, then rename. A crash mid-copy would otherwise
# leave a truncated segment under the real name, and the next run would find
# it "already archived" and skip it — a hole in the archive that only
# surfaces during a restore, which is the worst possible time.
TMP="$DEST.part.$$"
trap 'rm -f "$TMP"' EXIT INT TERM

if [ -n "$AGE_RECIPIENT" ]; then
  age --encrypt --recipient "$AGE_RECIPIENT" --output "$TMP" "$SRC" \
    || fail "encryption of $NAME failed"
else
  cp "$SRC" "$TMP" || fail "copy of $NAME failed"
fi

# Flush before the rename, so a power loss cannot leave a rename that points
# at data the disk never received. busybox sync takes no arguments; the
# fallback is a whole-filesystem sync, which is heavier and still correct.
sync "$TMP" 2>/dev/null || sync 2>/dev/null || true
mv "$TMP" "$DEST" || fail "could not move $NAME into place"
trap - EXIT INT TERM

exit 0
