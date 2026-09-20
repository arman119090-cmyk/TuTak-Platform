#!/usr/bin/env bash
#
# Self-test for scripts/page-human.sh: a fake webhook and a fake Telegram Bot
# API on one local server, so "delivered" is proven to mean what the
# receivers said and not what curl returned. Run: scripts/page-human.test.sh
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PAGE="$HERE/page-human.sh"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"; kill $(jobs -p) 2>/dev/null' EXIT
PORT=$((20000 + RANDOM % 20000))

cat > "$TMP/server.py" <<'PY'
import http.server, json, os, sys
TMP = sys.argv[1]
def read(name, default=''):
    try: return open(os.path.join(TMP, name)).read().strip()
    except FileNotFoundError: return default
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0)); body = self.rfile.read(n).decode()
        with open(os.path.join(TMP, 'posts.log'), 'a') as f: f.write(self.path + ' ' + body + '\n')
        if self.path.startswith('/bot'):
            mode = read('telegram', 'ok')
            code, resp = {'ok': (200, {"ok": True, "result": {"message_id": 1}}),
                          'notok': (200, {"ok": False, "description": "Bad Request: chat not found"}),
                          '401': (401, {"ok": False, "description": "Unauthorized"})}[mode]
            self.send_response(code); self.send_header('Content-Type', 'application/json'); self.end_headers()
            self.wfile.write(json.dumps(resp).encode())
        else:
            self.send_response(int(read('webhook', '200'))); self.end_headers(); self.wfile.write(b'ok')
    def do_GET(self):
        self.send_response(200); self.end_headers()
http.server.HTTPServer(('127.0.0.1', int(sys.argv[2])), H).serve_forever()
PY
python3 "$TMP/server.py" "$TMP" "$PORT" &
for _ in $(seq 1 50); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 0.1; done

ALERT='{"text":"🔴 *T* — production\nbody","severity":"critical","title":"TuTak production: test","body":"something_broke","key":"test.key","environment":"production","context":{"run":"https://example/run/1"},"firedAt":"2026-09-19T00:00:00Z"}'
W="ALERT_WEBHOOK_URL=http://127.0.0.1:$PORT/hook"
T="ALERT_TELEGRAM_BOT_TOKEN=123456:secret-token ALERT_TELEGRAM_CHAT_ID=-100999 TELEGRAM_API_BASE=http://127.0.0.1:$PORT"

fails=0; n=0
check() { # name expected_exit expected_posts [env...]
  local name="$1" want="$2" posts="$3"; shift 3
  : > "$TMP/posts.log"
  printf '%s' "$ALERT" | env CURL_MAX_TIME=5 "$@" bash "$PAGE" > "$TMP/out.log" 2>&1
  local got=$?; local sent; sent=$(grep -c . "$TMP/posts.log")
  n=$((n+1))
  if [ "$got" = "$want" ] && [ "$sent" = "$posts" ]; then echo "ok   $name (exit $got, posts $sent)"
  else echo "FAIL $name: exit $got (want $want), posts $sent (want $posts)"; sed 's/^/     /' "$TMP/out.log"; fails=$((fails+1)); fi
}

echo 200 > "$TMP/webhook"; echo ok > "$TMP/telegram"
check "no channel -> exit 3, nothing sent"            3 0
check "webhook only, 2xx -> delivered"                0 1 $W
echo 500 > "$TMP/webhook"
check "webhook only, 500 -> exit 2"                   2 1 $W
echo 200 > "$TMP/webhook"
check "telegram only, ok:true -> delivered"           0 1 $T
echo notok > "$TMP/telegram"
check "telegram only, 200 but ok:false -> exit 2"     2 1 $T
echo 401 > "$TMP/telegram"
check "telegram only, 401 -> exit 2"                  2 1 $T
echo ok > "$TMP/telegram"
check "both set -> both posted, delivered"            0 2 $W $T
echo 500 > "$TMP/webhook"
check "both set, webhook 500, telegram ok -> delivered" 0 2 $W $T
echo notok > "$TMP/telegram"
check "both set, both refuse -> exit 2"               2 2 $W $T
echo 200 > "$TMP/webhook"; echo ok > "$TMP/telegram"

# Telegram text = TelegramAlertChannel rendering; webhook payload verbatim.
: > "$TMP/posts.log"; printf '%s' "$ALERT" | env CURL_MAX_TIME=5 $W $T bash "$PAGE" >/dev/null 2>&1
n=$((n+1))
tg=$(grep '^/bot' "$TMP/posts.log" | sed 's#^/bot[^ ]* ##')
if printf '%s' "$tg" | jq -e '.chat_id=="-100999" and .disable_web_page_preview==true and (.text|startswith("🔴 TuTak production: test — production\nsomething_broke\n• run: https://example/run/1\nkey: test.key"))' >/dev/null; then echo "ok   telegram rendering"; else echo "FAIL telegram rendering"; echo "$tg"; fails=$((fails+1)); fi
n=$((n+1))
wh=$(grep '^/hook' "$TMP/posts.log" | sed 's#^/hook ##')
if [ "$(printf '%s' "$wh" | jq -c .)" = "$(printf '%s' "$ALERT" | jq -c .)" ]; then echo "ok   webhook payload verbatim"; else echo "FAIL webhook payload"; fails=$((fails+1)); fi
n=$((n+1))
if grep -q '/bot' "$TMP/posts.log" && ! grep -q 'secret-token\|/hook' "$TMP/out.log"; then echo "ok   no secret in output"; else echo "FAIL secret printed"; cat "$TMP/out.log"; fails=$((fails+1)); fi
n=$((n+1))
if printf 'not json' | env $W bash "$PAGE" >/dev/null 2>&1; then echo "FAIL accepted non-alert input"; fails=$((fails+1)); else echo "ok   rejects non-alert input"; fi

echo "$((n-fails))/$n passed"
[ "$fails" -eq 0 ]
