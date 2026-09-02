#!/usr/bin/env bash
# Publishes whether the Viva CHILD SA is actually installed.
#
# The gateway reads this file instead of shelling out per request. It writes
# `up <unixtime>` or `down <unixtime>`; the gateway treats anything older than
# 120 seconds as down, so if this stops running the gateway fails closed on
# its own rather than trusting a stale "up".
#
# `--list-sas` is the check rather than `--list-conns`: a loaded connection
# says only that we asked for a tunnel, an installed SA says there is one.
set -uo pipefail

STATE_DIR=/run/viva-tunnel
STATE_FILE="$STATE_DIR/state"
install -d -m 755 "$STATE_DIR"

if swanctl --list-sas --raw 2>/dev/null | grep -q 'child-sas.*state=INSTALLED'; then
  printf 'up %s\n' "$(date +%s)" > "$STATE_FILE"
else
  printf 'down %s\n' "$(date +%s)" > "$STATE_FILE"
fi
chmod 644 "$STATE_FILE"
