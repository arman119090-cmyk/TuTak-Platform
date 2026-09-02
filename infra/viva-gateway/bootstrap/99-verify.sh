#!/usr/bin/env bash
# Post-install and post-reboot verification. Read-only.
#
# Run after 40/50 and again after a reboot: the point of the reboot test is
# that everything below is still true without anyone touching the machine.
set -uo pipefail
fail=0
check() {
  if eval "$2" >/dev/null 2>&1; then printf '  ok    %s\n' "$1"
  else printf '  FAIL  %s\n' "$1"; fail=1; fi
}

echo "== services =="
check "firewall active"          "ufw status | grep -q '^Status: active'"
check "gateway running"          "systemctl is-active --quiet viva-gateway"
check "gateway enabled at boot"  "systemctl is-enabled --quiet viva-gateway"
check "tunnel health timer"      "systemctl is-active --quiet viva-tunnel-health.timer"
check "strongswan enabled"       "systemctl is-enabled --quiet strongswan || systemctl is-enabled --quiet strongswan-starter"
check "nginx running"            "systemctl is-active --quiet nginx"

echo "== gateway =="
check "answers /health"          "curl -fsS --max-time 5 http://127.0.0.1:8443/health"
check "refuses an unknown path"  "[ \"\$(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:8443/v1/anything)\" = 404 ]"
check "refuses an unsigned POST" "[ \"\$(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:8443/v1/token/get)\" = 401 ]"
check "refuses GET on an endpoint" "[ \"\$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8443/v1/token/get)\" = 405 ]"

echo "== exposure =="
check "gateway not on a public interface" "! ss -tlnH | awk '{print \$4}' | grep -qE '^(0\\.0\\.0\\.0|\\[::\\]):8443$'"

echo "== tunnel =="
printf '  state file: %s\n' "$(cat /run/viva-tunnel/state 2>/dev/null || echo '(absent — reads as down)')"
swanctl --list-sas 2>/dev/null | head -5 | sed 's/^/  /' || echo "  (no SAs)"

echo
[ "$fail" -eq 0 ] && echo "ALL CHECKS PASSED" || echo "SOME CHECKS FAILED — see FAIL above"
exit "$fail"
