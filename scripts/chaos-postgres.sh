#!/usr/bin/env bash
#
# Takes Postgres away while money is moving, then checks what survived.
#
#   ./scripts/chaos-postgres.sh                 # 45s of load, outage in the middle
#   CHAOS_SECONDS=60 ./scripts/chaos-postgres.sh
#
# ## Why a separate script from the driver
#
# `apps/api/src/scripts/chaos-test.ts` drives the money paths and does the
# verification, but it runs as the application — unprivileged, by design, and
# therefore unable to stop the database it is talking to. This script is the
# other half: it starts the driver, waits until the driver says it is
# actually driving, and then pulls the floor out.
#
# The stop is `-m immediate`, which is the point. A clean shutdown lets
# Postgres finish what it is doing and would test almost nothing; immediate
# is the closest a script can get to the power going out, and it is the case
# that decides whether a caller can be told "captured" for a payment that
# was never written.
#
# ## This is destructive to whatever DATABASE_URL points at
#
# It creates a partner, customers and thousands of payments, and it stops
# the Postgres *cluster* — every database on it, not just this one. Point it
# at a scratch database on a machine nobody else is using.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/apps/api"

SECONDS_TOTAL="${CHAOS_SECONDS:-45}"
CLUSTER_VER="${PG_CLUSTER_VERSION:-16}"
CLUSTER_NAME="${PG_CLUSTER_NAME:-main}"
# When the outage starts, as a fraction of the run. A third of the way in
# leaves time for traffic to be established before, and for recovery after.
OUTAGE_AT="${CHAOS_OUTAGE_AT:-12}"
OUTAGE_FOR="${CHAOS_OUTAGE_FOR:-10}"

green() { printf '\033[0;32m%s\033[0m\n' "$1"; }
info()  { printf '\033[0;36m▸ %s\033[0m\n' "$1"; }
die()   { printf '\033[0;31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

[[ -f dist/scripts/chaos-test.js ]] || die "build first: pnpm --filter @tutak/api build"
command -v pg_ctlcluster >/dev/null 2>&1 \
  || die "pg_ctlcluster not found — this script drives a Debian/Ubuntu Postgres cluster."
[[ "$(id -u)" -eq 0 ]] || die "must run as root to stop and start the cluster."

LOG="${CHAOS_LOG:-/tmp/chaos-test.log}"
rm -f "$LOG"

info "Starting the driver (${SECONDS_TOTAL}s of load)"
CHAOS_SECONDS="$SECONDS_TOTAL" node dist/scripts/chaos-test.js > "$LOG" 2>&1 &
DRIVER=$!

# Fixtures take a variable amount of time, so wait for the driver to say it
# has started rather than sleeping a guessed amount.
for _ in $(seq 1 120); do
  grep -q '^DRIVING$' "$LOG" 2>/dev/null && break
  kill -0 "$DRIVER" 2>/dev/null || { cat "$LOG"; die "driver exited before it started driving"; }
  sleep 1
done
grep -q '^DRIVING$' "$LOG" 2>/dev/null || { cat "$LOG"; die "driver never reported DRIVING"; }
green "  ✓ driver is running"

info "Letting traffic settle for ${OUTAGE_AT}s"
sleep "$OUTAGE_AT"

info "STOPPING POSTGRES — immediate, no clean shutdown"
date -u '+    %H:%M:%SZ'
pg_ctlcluster "$CLUSTER_VER" "$CLUSTER_NAME" stop -m immediate --force >/dev/null 2>&1 \
  || die "could not stop the cluster"

info "Down for ${OUTAGE_FOR}s"
sleep "$OUTAGE_FOR"

info "STARTING POSTGRES"
date -u '+    %H:%M:%SZ'
pg_ctlcluster "$CLUSTER_VER" "$CLUSTER_NAME" start >/dev/null 2>&1 \
  || die "could not start the cluster — the driver's verification will fail"
green "  ✓ back up"

info "Waiting for the driver to finish and verify"
wait "$DRIVER"
STATUS=$?

echo
cat "$LOG"
echo
if [[ "$STATUS" -eq 0 ]]; then
  green "chaos-postgres: PASS (full output in $LOG)"
else
  printf '\033[0;31m✗ chaos-postgres: FAIL — see %s\033[0m\n' "$LOG" >&2
fi
exit "$STATUS"
