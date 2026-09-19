#!/usr/bin/env bash
#
# Self-test for scripts/uptime-probe.sh against a local fake API and a fake
# webhook, so the paging logic is proven before it is trusted at 3am.
# Needs bash, curl, jq, python3. Run: scripts/uptime-probe.test.sh
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROBE="$HERE/uptime-probe.sh"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"; kill $(jobs -p) 2>/dev/null' EXIT
PORT=$((20000 + RANDOM % 20000))

# One tiny server plays every part: readiness, metrics and the webhook.
# Behaviour is chosen per request by files in $TMP so each case can flip it.
cat > "$TMP/server.py" <<'PY'
import http.server, json, os, sys
TMP = sys.argv[1]
def read(name, default=''):
    try: return open(os.path.join(TMP, name)).read().strip()
    except FileNotFoundError: return default
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, body, ctype='application/json'):
        self.send_response(code); self.send_header('Content-Type', ctype); self.end_headers(); self.wfile.write(body.encode())
    def do_GET(self):
        if self.path == '/health/ready':
            mode = read('ready', 'ok')
            if mode == 'ok': self._send(200, json.dumps({"status":"ok","checks":{"database":"ok","redis":"ok","storage":"ok"}}))
            elif mode == 'storage-error': self._send(200, json.dumps({"status":"ok","checks":{"database":"ok","redis":"ok","storage":"error"}}))
            elif mode == '503': self._send(503, json.dumps({"status":"error","checks":{"database":"error","redis":"ok"}}))
            elif mode == 'html': self._send(200, '<html>maintenance</html>', 'text/html')
            else: self._send(500, 'boom', 'text/plain')
        elif self.path == '/metrics':
            if self.headers.get('Authorization') != 'Bearer good': self._send(401, 'no'); return
            self._send(200, "# HELP x\ntutak_ledger_imbalance_amd %s\ntutak_outbox_pending 0\n" % read('imbalance', '0'), 'text/plain')
        else: self._send(404, 'nope', 'text/plain')
    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0)); body = self.rfile.read(n).decode()
        with open(os.path.join(TMP, 'pages.log'), 'a') as f: f.write(body + '\n')
        self._send(int(read('webhook', '200')), 'ok', 'text/plain')
http.server.HTTPServer(('127.0.0.1', int(sys.argv[2])), H).serve_forever()
PY
python3 "$TMP/server.py" "$TMP" "$PORT" &
for _ in $(seq 1 50); do curl -s -o /dev/null "http://127.0.0.1:$PORT/health/ready" && break; sleep 0.1; done

fails=0; n=0
check() { # name expected_exit expected_pages [env...]
  local name="$1" want="$2" pages="$3"; shift 3
  : > "$TMP/pages.log"
  env API_BASE_URL="http://127.0.0.1:$PORT" CURL_MAX_TIME=5 "$@" bash "$PROBE" > "$TMP/out.log" 2>&1
  local got=$?; local sent; sent=$(grep -c . "$TMP/pages.log")
  n=$((n+1))
  if [ "$got" = "$want" ] && [ "$sent" = "$pages" ]; then echo "ok   $name (exit $got, pages $sent)"
  else echo "FAIL $name: exit $got (want $want), pages $sent (want $pages)"; sed 's/^/     /' "$TMP/out.log"; fails=$((fails+1)); fi
}
W="ALERT_WEBHOOK_URL=http://127.0.0.1:$PORT/hook"

echo ok > "$TMP/ready"; echo 0 > "$TMP/imbalance"; echo 200 > "$TMP/webhook"
check "healthy, no token"                     0 0 $W
check "healthy, token, imbalance 0"           0 0 $W METRICS_TOKEN=good
check "healthy, token rejected -> pages"      1 1 $W METRICS_TOKEN=bad
check "healthy, no webhook, no token"         0 0
echo 5000.0000 > "$TMP/imbalance"
check "imbalance != 0 -> pages"               1 1 $W METRICS_TOKEN=good
echo 0 > "$TMP/imbalance"
echo storage-error > "$TMP/ready"
check "200 with storage error -> pages"       1 1 $W
echo 503 > "$TMP/ready"
check "503 -> pages"                          1 1 $W
check "503 without webhook -> exit 1, no page" 1 0
check "503, transition, prev failure -> no page" 1 0 $W PAGE_MODE=transition PREVIOUS_CONCLUSION=failure
check "503, transition, prev failure, reminder -> page" 1 1 $W PAGE_MODE=transition PREVIOUS_CONCLUSION=failure REMINDER=1
check "503, transition, prev success -> page" 1 1 $W PAGE_MODE=transition PREVIOUS_CONCLUSION=success
echo 500 > "$TMP/webhook"
check "503, webhook refuses -> exit 2"        2 1 $W
echo 200 > "$TMP/webhook"
echo html > "$TMP/ready"
check "200 but not health JSON -> pages"      1 1 $W
echo ok > "$TMP/ready"
check "unreachable API -> pages"              1 1 $W API_BASE_URL=http://127.0.0.1:1
# payload shape = what WebhookAlertChannel sends
echo 503 > "$TMP/ready"; : > "$TMP/pages.log"
env API_BASE_URL="http://127.0.0.1:$PORT" CURL_MAX_TIME=5 $W bash "$PROBE" >/dev/null 2>&1
n=$((n+1))
if jq -e '.severity=="critical" and .key=="uptime.probe" and (.text|startswith("🔴")) and .environment=="production" and .title and .body' "$TMP/pages.log" >/dev/null; then echo "ok   payload shape"; else echo "FAIL payload shape"; cat "$TMP/pages.log"; fails=$((fails+1)); fi

echo "$((n-fails))/$n passed"
[ "$fails" -eq 0 ]
