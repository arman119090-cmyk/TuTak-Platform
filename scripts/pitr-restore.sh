#!/usr/bin/env bash
#
# Recovers the database to a moment in time, into a *separate* data
# directory that it then starts on a *separate* port.
#
#   ./scripts/pitr-restore.sh \
#       --base backups/base/base-20260809T120000Z \
#       --target '2026-08-09T14:52:07Z' \
#       --into /var/lib/tutak/recovered
#
#   ./scripts/pitr-restore.sh --base <dir> --target latest --into <dir>
#
# ## It never touches the live database, and that is the point
#
# The instinct during an incident is to restore over production. Do not. You
# get one attempt at picking the right target time, and picking it wrong
# after overwriting the original leaves nothing to try again from. This
# script recovers alongside: a second cluster, a second port, both databases
# readable at once. Compare them, decide, and only then move traffic.
#
# ## Choosing --target
#
# The target is the moment you want the database to be *as of* — so aim just
# before the damage, not at it. `recovery_target_inclusive` defaults to on,
# which means a target equal to the bad transaction's commit time replays
# that transaction. Give yourself a second of margin.
#
# Times are read as UTC unless they carry an offset. Postgres interprets a
# bare timestamp in the *server's* timezone, which during an incident at
# 03:00 is exactly the kind of detail that gets got wrong, so this script
# appends an explicit zone rather than leaving it ambiguous.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

BASE=""
TARGET=""
INTO=""
PORT="${PITR_RESTORE_PORT:-5433}"
KEEP_RUNNING=0

green() { printf '\033[0;32m%s\033[0m\n' "$1"; }
info()  { printf '\033[0;36m▸ %s\033[0m\n' "$1"; }
warn()  { printf '\033[0;33m⚠ %s\033[0m\n' "$1"; }
die()   { printf '\033[0;31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

usage() {
  sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit "${1:-1}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base)   BASE="$2"; shift 2 ;;
    --target) TARGET="$2"; shift 2 ;;
    --into)   INTO="$2"; shift 2 ;;
    --port)   PORT="$2"; shift 2 ;;
    --keep-running) KEEP_RUNNING=1; shift ;;
    -h|--help) usage 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[[ -n "$BASE"   ]] || usage
[[ -n "$TARGET" ]] || usage
[[ -n "$INTO"   ]] || usage
[[ -d "$BASE"   ]] || die "base backup directory $BASE does not exist"

ENV_FILE="${ARCHIVE_ENV_FILE:-/etc/tutak/pitr.env}"
# shellcheck disable=SC1090
[[ -r "$ENV_FILE" ]] && . "$ENV_FILE"
ARCHIVE_DIR="${PITR_ARCHIVE_DIR:-/var/lib/tutak/wal-archive}"
AGE_IDENTITY="${BACKUP_AGE_IDENTITY:-}"

[[ -d "$ARCHIVE_DIR" ]] || die "WAL archive $ARCHIVE_DIR does not exist. Without it a base backup can only restore to the instant it was taken."

# ── Server binaries ─────────────────────────────────────────────────────
# pg_ctl and postgres live outside PATH on Debian/Ubuntu, where only the
# client tools are linked into /usr/bin.
PGBIN=""
for candidate in /usr/lib/postgresql/*/bin "$(dirname "$(command -v pg_ctl 2>/dev/null || echo /nonexistent)")"; do
  [[ -x "$candidate/pg_ctl" ]] && PGBIN="$candidate"
done
[[ -n "$PGBIN" ]] || die "cannot find pg_ctl — install the postgresql server package, not just the client."

# Postgres refuses to run as root. When this script *is* root (which is
# normal on a recovery box) everything that touches the cluster is run as
# the postgres user instead.
PGUSER_OS="${PITR_OS_USER:-postgres}"
if [[ "$(id -u)" -eq 0 ]]; then
  id "$PGUSER_OS" >/dev/null 2>&1 || die "running as root but there is no '$PGUSER_OS' user to drop to."
  as_pg() { su "$PGUSER_OS" -s /bin/bash -c "$1"; }
  NEEDS_CHOWN=1
else
  as_pg() { bash -c "$1"; }
  NEEDS_CHOWN=0
fi

# ── Unpack the base ─────────────────────────────────────────────────────
[[ -e "$INTO" ]] && die "$INTO already exists. Recover into a fresh directory so a second attempt is still possible."
mkdir -p "$INTO"

decrypt_needed=0
if compgen -G "$BASE/*.tar.gz.age" >/dev/null; then
  decrypt_needed=1
  [[ -n "$AGE_IDENTITY" ]] || die "the base backup is encrypted but BACKUP_AGE_IDENTITY (path to the private key) is not set."
  [[ -r "$AGE_IDENTITY" ]] || die "cannot read the private key at $AGE_IDENTITY"
  command -v age >/dev/null 2>&1 || die "the base backup is encrypted but age is not installed."
fi

info "Unpacking base backup from $BASE"
if [[ "$decrypt_needed" -eq 1 ]]; then
  age --decrypt -i "$AGE_IDENTITY" "$BASE/base.tar.gz.age" | tar -xzf - -C "$INTO" \
    || die "could not unpack base.tar.gz.age — wrong key, or a truncated backup."
else
  [[ -f "$BASE/base.tar.gz" ]] || die "no base.tar.gz in $BASE"
  tar -xzf "$BASE/base.tar.gz" -C "$INTO" || die "could not unpack base.tar.gz"
fi
[[ -f "$INTO/PG_VERSION" ]] || die "$INTO does not look like a cluster — unpacking produced no PG_VERSION."
green "  ✓ base unpacked into $INTO"

# ── A base backup is not always self-contained ──────────────────────────
# pg_basebackup copies the data directory. On Debian and Ubuntu — which is
# what this platform deploys on — postgresql.conf, pg_hba.conf and
# pg_ident.conf do not live in the data directory; they live in
# /etc/postgresql/<ver>/<cluster>/ and are handed to the server on its
# command line. So a perfectly good base backup unpacks into a cluster that
# refuses to start:
#
#   could not access the server configuration file ".../postgresql.conf"
#
# Found during the rehearsal in docs/DEPLOYMENT.md §7c, which is the entire
# argument for rehearsing. A recovery that discovers this at 03:00 during a
# real incident has already lost the time it takes to work out what is
# missing. A minimal config is written here instead — recovery does not need
# the tuning from the original, only somewhere to listen and an
# authentication file.
if [[ ! -f "$INTO/postgresql.conf" ]]; then
  info "Base contains no postgresql.conf (normal on Debian/Ubuntu) — writing a minimal one for recovery"
  cat > "$INTO/postgresql.conf" <<CONF
# Minimal configuration written by scripts/pitr-restore.sh.
# This is a recovery cluster, not a replacement for the production config.
listen_addresses = '127.0.0.1'
unix_socket_directories = '/tmp'
hba_file = '$INTO/pg_hba.conf'
ident_file = '$INTO/pg_ident.conf'
CONF
fi
if [[ ! -f "$INTO/pg_hba.conf" ]]; then
  # Trust, deliberately: this cluster listens only on loopback, on a
  # non-default port, and exists to be read and then thrown away. Requiring
  # a password would mean needing the production role's password during an
  # incident, which is one more thing to go looking for.
  cat > "$INTO/pg_hba.conf" <<'HBA'
local   all   all                 trust
host    all   all   127.0.0.1/32  trust
host    all   all   ::1/128       trust
HBA
fi
touch "$INTO/pg_ident.conf"

# ── The command that feeds WAL back in ──────────────────────────────────
# Written into a script rather than inlined, because the encrypted case
# needs a pipeline and restore_command is a single shell command whose
# quoting inside postgresql.auto.conf is its own small nightmare.
RESTORE_HELPER="$INTO/tutak_restore_wal.sh"
if [[ "$decrypt_needed" -eq 1 || -n "$AGE_IDENTITY" ]] && compgen -G "$ARCHIVE_DIR/*.age" >/dev/null; then
  cat > "$RESTORE_HELPER" <<HELPER
#!/usr/bin/env bash
# %f -> \$1 (segment name), %p -> \$2 (where Postgres wants it written)
set -euo pipefail
SRC="$ARCHIVE_DIR/\$1.age"
[[ -f "\$SRC" ]] || exit 1
exec age --decrypt -i "$AGE_IDENTITY" -o "\$2" "\$SRC"
HELPER
  info "WAL archive is encrypted; replay will decrypt with $AGE_IDENTITY"
else
  cat > "$RESTORE_HELPER" <<HELPER
#!/usr/bin/env bash
set -euo pipefail
SRC="$ARCHIVE_DIR/\$1"
[[ -f "\$SRC" ]] || exit 1
exec cp "\$SRC" "\$2"
HELPER
fi
chmod +x "$RESTORE_HELPER"

# ── Recovery settings ───────────────────────────────────────────────────
{
  echo "# Written by scripts/pitr-restore.sh — recovery only, not a live config."
  echo "restore_command = '$RESTORE_HELPER %f %p'"
  echo "archive_mode = off"          # a recovering cluster must not archive
  echo "port = $PORT"
  if [[ "$TARGET" == "latest" ]]; then
    # No recovery_target_* at all: replay everything the archive holds.
    echo "recovery_target_timeline = 'latest'"
  else
    # Normalise to something Postgres cannot misread. A bare timestamp is
    # interpreted in the server's timezone; this pins it.
    NORMALISED="${TARGET/Z/+00}"
    echo "recovery_target_time = '$NORMALISED'"
    echo "recovery_target_action = 'promote'"
  fi
} >> "$INTO/postgresql.auto.conf"

# This file is what makes Postgres start in recovery instead of starting up
# as a normal cluster and immediately being a *different* database.
touch "$INTO/recovery.signal"

chmod 700 "$INTO"
if [[ "$NEEDS_CHOWN" -eq 1 ]]; then
  chown -R "$PGUSER_OS" "$INTO"
  # The private key has to be readable by the postgres user during replay,
  # since restore_command runs as that user.
  [[ -n "$AGE_IDENTITY" ]] && chmod o+r "$AGE_IDENTITY" 2>/dev/null || true
fi

# ── Replay ──────────────────────────────────────────────────────────────
LOG="$INTO/recovery.log"
info "Starting recovery on port $PORT (log: $LOG)"
as_pg "$PGBIN/pg_ctl -D '$INTO' -l '$LOG' -o '-p $PORT' -w -t 300 start" >/dev/null 2>&1 || {
  warn "pg_ctl reported a failure — this is expected when recovery pauses, checking the log"
}

# pg_ctl -w returns as soon as the cluster accepts connections, which during
# recovery means "replaying", not "finished". The state that matters is
# whether it has left recovery.
DEADLINE=$(( $(date +%s) + 300 ))
STATE="unknown"
while [[ "$(date +%s)" -lt "$DEADLINE" ]]; do
  if IN_RECOVERY="$(as_pg "psql -h /tmp -p $PORT -d postgres -Atc 'select pg_is_in_recovery()'" 2>/dev/null)"; then
    if [[ "$IN_RECOVERY" == "f" ]]; then STATE="promoted"; break; fi
    STATE="replaying"
  fi
  sleep 2
done

if [[ "$STATE" != "promoted" ]]; then
  warn "Recovery has not promoted after 300s (state: $STATE)."
  warn "The usual cause is a missing WAL segment — the tail of $LOG names it:"
  tail -20 "$LOG" >&2 || true
  die "recovery did not complete"
fi

green "  ✓ recovered and promoted"

# ── What you got ────────────────────────────────────────────────────────
echo
green "Recovered cluster is running on port $PORT, data in $INTO"
[[ -f "$BASE/START_WAL" ]] && info "Base needed WAL from $(cat "$BASE/START_WAL")"
echo
echo "Look at it before you trust it:"
echo "  psql -h /tmp -p $PORT -U tutak -d tutak -c 'select count(*) from ledger_postings'"
echo
echo "The live database is untouched. When you are done:"
echo "  $PGBIN/pg_ctl -D $INTO stop"

if [[ "$KEEP_RUNNING" -eq 0 ]]; then
  info "Stopping the recovered cluster (pass --keep-running to leave it up)"
  as_pg "$PGBIN/pg_ctl -D '$INTO' -m fast -w stop" >/dev/null 2>&1 || true
fi
