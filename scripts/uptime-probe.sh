#!/usr/bin/env bash
#
# The outside observer for production: asks `/health/ready`, optionally reads
# `tutak_ledger_imbalance_amd`, and pages a human when something is wrong.
# Run by `.github/workflows/uptime.yml`; testable on its own by
# `scripts/uptime-probe.test.sh`, which is what proves the logic below.
#
# Inputs (environment):
#   API_BASE_URL        required
#   ALERT_WEBHOOK_URL   optional — without it a problem is only visible in the
#                       exit status (and the Actions tab)
#   METRICS_TOKEN       optional — enables the ledger check; its absence never
#                       affects the readiness check
#   PAGE_MODE           "always" (default) or "transition": in transition mode
#                       a page is sent only when PREVIOUS_CONCLUSION is not
#                       "failure" or when REMINDER=1, so a long outage pages
#                       once at the start and then hourly, not every ten minutes
#   PREVIOUS_CONCLUSION last completed run's conclusion (success/failure/…)
#   REMINDER            "1" to force a page in transition mode
#   RUN_URL             link to put in the page
#   CURL_MAX_TIME       seconds per request (default 20)
#
# Exit: 0 = healthy, 1 = a problem was found (whether or not a page went out),
# 2 = a page was needed but the webhook refused it (on top of the problem).
set -u
API_BASE_URL="${API_BASE_URL:?API_BASE_URL is required}"
ALERT_WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}"
METRICS_TOKEN="${METRICS_TOKEN:-}"
PAGE_MODE="${PAGE_MODE:-always}"
PREVIOUS_CONCLUSION="${PREVIOUS_CONCLUSION:-}"
REMINDER="${REMINDER:-0}"
RUN_URL="${RUN_URL:-}"
CURL_MAX_TIME="${CURL_MAX_TIME:-20}"

problems=()

# ── 1. Readiness ──────────────────────────────────────────────────────────
body=$(curl -sS --max-time "$CURL_MAX_TIME" -w '\n%{http_code}' "$API_BASE_URL/health/ready" 2>&1)
rc=$?
code=$(printf '%s' "$body" | tail -n1)
json=$(printf '%s' "$body" | sed '$d')
echo "readiness: curl rc=$rc http=${code:-none}"
printf '%s\n' "$json" | head -c 600; echo
if [ "$rc" != "0" ] || [ "$code" != "200" ]; then
  problems+=("API not ready (curl rc=$rc, HTTP ${code:-none}): $(printf '%s' "$json" | head -c 300)")
else
  # `storage` deliberately does not fail readiness in HealthController, so it
  # is caught here. Any check value other than ok is a problem; a 200 that
  # is not JSON at all is a problem too (a proxy page, a wrong host).
  if ! printf '%s' "$json" | grep -q '"status"'; then
    problems+=("readiness answered 200 but not with the health JSON: $(printf '%s' "$json" | head -c 200)")
  elif printf '%s' "$json" | grep -Eq '"(database|redis|storage)"[[:space:]]*:[[:space:]]*"[^"]*"' \
     && printf '%s' "$json" | grep -Eq '"(database|redis|storage)"[[:space:]]*:[[:space:]]*"(error|down|fail[a-z]*)"'; then
    problems+=("a readiness check reports an error: $(printf '%s' "$json" | head -c 300)")
  fi
fi

# ── 2. Ledger imbalance (only with a token; never blocks the check above) ──
if [ -n "$METRICS_TOKEN" ]; then
  metrics=$(curl -sS --max-time "$CURL_MAX_TIME" -H "Authorization: Bearer $METRICS_TOKEN" "$API_BASE_URL/metrics" 2>&1)
  mrc=$?
  if [ "$mrc" != "0" ]; then
    problems+=("/metrics unreachable (curl rc=$mrc)")
  else
    value=$(printf '%s' "$metrics" | awk '/^tutak_ledger_imbalance_amd[ {]/ {print $NF; exit}')
    echo "tutak_ledger_imbalance_amd=${value:-<absent>}"
    if [ -z "$value" ]; then
      problems+=("tutak_ledger_imbalance_amd is absent from /metrics (token rejected or endpoint disabled)")
    elif ! awk -v v="$value" 'BEGIN { exit (v + 0 == 0 ? 0 : 1) }'; then
      problems+=("LEDGER IMBALANCE: tutak_ledger_imbalance_amd=$value — money was invented or lost; stop payouts and page the engineer")
    fi
  fi
else
  echo "ledger check skipped: METRICS_TOKEN not set"
fi

# ── 3. Decide ─────────────────────────────────────────────────────────────
if [ "${#problems[@]}" -eq 0 ]; then
  echo "OK"
  exit 0
fi

problem=$(printf '%s; ' "${problems[@]}"); problem="${problem%; }"
echo "::error::$problem"

should_page=1
if [ "$PAGE_MODE" = "transition" ] && [ "$PREVIOUS_CONCLUSION" = "failure" ] && [ "$REMINDER" != "1" ]; then
  should_page=0
  echo "still failing; previous run already paged and this is not a reminder slot — not paging again"
fi

if [ "$should_page" = "1" ]; then
  if [ -z "$ALERT_WEBHOOK_URL" ]; then
    echo "::warning::ALERT_WEBHOOK_URL is not set — this failure is visible only here."
  else
    title="TuTak production: external probe failed"
    payload=$(jq -cn --arg t "$title" --arg b "$problem" --arg u "$API_BASE_URL" --arg r "$RUN_URL" \
      '{text: ("🔴 *" + $t + "* — production\n" + $b + "\n• api: " + $u + (if $r != "" then "\n• run: " + $r else "" end)),
        severity: "critical", title: $t, body: $b, key: "uptime.probe", environment: "production",
        context: {api: $u, run: $r}, firedAt: (now | todate)}')
    wcode=$(curl -sS --max-time 15 -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -d "$payload" "$ALERT_WEBHOOK_URL")
    echo "webhook answered ${wcode:-none}"
    case "$wcode" in 2*) ;; *) echo "::error::webhook did not accept the page (HTTP ${wcode:-none})"; exit 2;; esac
  fi
fi
exit 1
