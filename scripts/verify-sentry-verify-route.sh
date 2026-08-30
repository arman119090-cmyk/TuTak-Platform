#!/usr/bin/env bash
#
# Proves the Sentry verification route survives a real production-mode build.
#
# The bug this guards against cannot be caught by a unit test: `next build`
# const-folds `process.env.NODE_ENV`, so a guard written against it becomes a
# compile-time constant and the route returns 404 in every deployment
# regardless of runtime configuration. Only an actual build followed by an
# actual request can tell the difference — which is what this does.
#
# Deliberately: builds with NODE_ENV=production and supplies APP_ENV,
# SENTRY_VERIFY_ENABLED and SENTRY_VERIFY_TOKEN **only** when the server
# starts. If the gate were still build-time, the first case below would 404.
#
# Each configuration gets its own port and its own server, all killed at the
# end. Reusing one port requires the previous server to be gone before the
# next binds, and `next start` leaves workers that outlive a signal sent to
# the parent — the first version of this script did reuse a port and quietly
# answered three cases with the first case's configuration, reporting a
# failure that was entirely the harness's own.
#
# No DSN is set, so nothing is transmitted anywhere: an uninitialized Sentry
# SDK makes `captureException`/`flush` documented no-ops. This checks the
# gate, not ingestion.
#
# Usage: scripts/verify-sentry-verify-route.sh [admin|partner]   (default: both)

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROUTE='/api/internal/sentry-verify'
HEADER='x-sentry-verify-token'
TOKEN='local-verification-token-not-a-secret'
FAILURES=0
PORTS_USED=""

cleanup() {
  for p in $PORTS_USED; do fuser -k -KILL "$p/tcp" >/dev/null 2>&1; done
}
trap cleanup EXIT

log()  { printf '  %-56s %s\n' "$1" "$2"; }
fail() { FAILURES=$((FAILURES + 1)); log "$1" "FAIL (got $2, want $3)"; }
ok()   { log "$1" "ok ($2)"; }

expect() { # label want-status curl-args...
  local label="$1" want="$2"; shift 2
  local got
  got="$(curl -s -o /dev/null -w '%{http_code}' "$@")"
  if [ "$got" = "$want" ]; then ok "$label" "$got"; else fail "$label" "$got" "$want"; fi
}

start_server() { # app port env-assignments...
  local app="$1" port="$2"; shift 2
  PORTS_USED="$PORTS_USED $port"
  ( cd "$REPO_ROOT/apps/$app" && env "$@" NODE_ENV=production \
      ./node_modules/.bin/next start --port "$port" --hostname 127.0.0.1 \
      >"/tmp/tutak-verify-$app-$port.log" 2>&1 ) &
  for _ in $(seq 1 60); do
    curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$port/" 2>/dev/null && return 0
    sleep 0.5
  done
  echo "  server $app:$port did not start; see /tmp/tutak-verify-$app-$port.log" >&2
  FAILURES=$((FAILURES + 1))
  return 1
}

# case: app base-port offset label want-status env-assignments...
denied_case() {
  local app="$1" port="$2" label="$3"; shift 3
  start_server "$app" "$port" "$@" || return 0
  expect "$label" 404 -X POST -H "$HEADER: $TOKEN" "http://127.0.0.1:$port$ROUTE"
}

check_app() {
  local app="$1" base="$2"
  echo
  echo "== $app =="

  echo "-- build: NODE_ENV=production, no APP_ENV, no flag, no token --"
  ( cd "$REPO_ROOT" && NODE_ENV=production pnpm --filter "@tutak/$app" build ) >/dev/null 2>&1 \
    || { echo "  build FAILED"; FAILURES=$((FAILURES + 1)); return; }
  echo "  build ok"

  echo "-- runtime: APP_ENV=staging, flag on, token set (the allowed case) --"
  start_server "$app" "$base" APP_ENV=staging SENTRY_VERIFY_ENABLED=true SENTRY_VERIFY_TOKEN="$TOKEN" || return
  local url="http://127.0.0.1:$base$ROUTE"
  expect "POST with the correct token"     200 -X POST -H "$HEADER: $TOKEN" "$url"
  expect "POST with a wrong token"         404 -X POST -H "$HEADER: wrong-token" "$url"
  expect "POST with a prefix of the token" 404 -X POST -H "$HEADER: ${TOKEN%?}" "$url"
  expect "POST with no token header"       404 -X POST "$url"
  expect "GET is not a way in"             405 "$url"
  if curl -s -D- -o /dev/null -X POST -H "$HEADER: $TOKEN" "$url" | grep -qi 'cache-control:.*no-store'; then
    ok "allowed answer is no-store" "present"
  else
    fail "allowed answer is no-store" "absent" "no-store"
  fi

  echo "-- runtime: every denied configuration --"
  denied_case "$app" "$((base + 1))" "APP_ENV=production"        APP_ENV=production SENTRY_VERIFY_ENABLED=true SENTRY_VERIFY_TOKEN="$TOKEN"
  denied_case "$app" "$((base + 2))" "flag absent"               APP_ENV=staging SENTRY_VERIFY_TOKEN="$TOKEN"
  denied_case "$app" "$((base + 3))" "no token configured"       APP_ENV=staging SENTRY_VERIFY_ENABLED=true
  denied_case "$app" "$((base + 4))" "nothing configured at all" IGNORED=1
  denied_case "$app" "$((base + 5))" "APP_ENV nobody allowlisted" APP_ENV=prod-eu SENTRY_VERIFY_ENABLED=true SENTRY_VERIFY_TOKEN="$TOKEN"
}

case "${1:-both}" in
  admin)   check_app admin 3591 ;;
  partner) check_app partner 3601 ;;
  both)    check_app admin 3591; check_app partner 3601 ;;
  *)       echo "usage: $0 [admin|partner]" >&2; exit 2 ;;
esac

echo
if [ "$FAILURES" -gt 0 ]; then
  echo "$FAILURES check(s) failed."
  exit 1
fi
echo "OK — the verification route is a runtime decision, not a build-time constant."
