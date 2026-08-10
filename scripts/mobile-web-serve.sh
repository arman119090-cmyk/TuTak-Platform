#!/usr/bin/env bash
#
# Bundles the mobile app for the browser and serves it.
#
# Why this exists: every automated check the mobile app had ran against its
# source — Jest, with the network mocked. Nothing ever built the app and let
# it talk to a real API. A bug that only appears in that gap shipped because
# of it: `isDemoDeployment` read one level too few out of the response
# envelope, so the demo sign-in button never appeared on any server. The
# request succeeded, so nothing threw; the unit tests mocked the response
# shape they expected rather than the one the API sends.
#
# react-native-web is not Android. It shares the screens, the navigation, the
# stores, the API client and the response handling, and it does not share the
# native modules or the keyboard. So this proves the app's own logic against a
# live server, and proves nothing about how it feels in the hand.
#
# Usage:
#   scripts/mobile-web-serve.sh [API_URL] [PORT]
#
# Defaults to the Compose stack (http://localhost:4000/v1) on port 8099.
# Prints the URL it is serving, then blocks. Ctrl-C stops it.
set -euo pipefail

API_URL="${1:-http://localhost:4000/v1}"
PORT="${2:-8099}"
OUT="${MOBILE_WEB_OUT:-$(mktemp -d)/mobile-web}"

cd "$(dirname "$0")/.."

echo "Bundling the mobile app for the browser"
echo "  API:  $API_URL"
echo "  Out:  $OUT"

# APP_ENV=development on purpose. `app.config.js` refuses a localhost API for
# the preview and production profiles — a phone cannot reach the laptop's
# loopback, and a build that silently points nowhere is worse than one that
# refuses to build. Here loopback is exactly what is wanted.
(
  cd apps/mobile
  APP_ENV=development API_BASE_URL="$API_URL" \
    npx expo export --platform web --clear --output-dir "$OUT"
)

echo
echo "Serving $OUT on http://localhost:$PORT"
echo "The API must allow http://localhost:$PORT in CORS_ORIGINS, or every"
echo "request from the page is refused by the browser before it is sent."
# The directory comes first, which is what `http-server --help` documents
# ("usage: http-server [path] [options]") and which this had backwards.
#
# `--silent` is not declared boolean in http-server's option parsing, so a
# trailing path is taken as its *value* rather than as the root. `argv._` ends
# up empty and http-server falls back to its default root — which is `./public`
# when that directory exists, and this repository has one: two legal pages.
#
# So the bundle was exported correctly and then never served. What answered on
# this port was a directory listing of `public/`, which is a 200, which is all
# the readiness check asked for. Every run of the mobile drive since it was
# added has been pointing a browser at that listing and reporting that the demo
# button never appeared. Verified both ways: with the path last the served
# title is "Index of /", with the path first it is "TuTak".
exec npx --yes http-server "$OUT" -p "$PORT" -c-1 --silent
