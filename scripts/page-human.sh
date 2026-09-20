#!/usr/bin/env bash
#
# Deliver one alert to a human from a GitHub workflow — the same two
# channels the API uses (`AlertsModule`): a JSON webhook and/or a Telegram
# chat. Before this script, `uptime.yml` and `backup.yml` could only page a
# webhook, so an operator who had set up Telegram for the API was still
# unreachable from the outside observers.
#
# Input: the alert as JSON on stdin, in the shape `WebhookAlertChannel`
# sends — {text, severity, title, body, key, environment, context, firedAt}.
# The webhook receives it verbatim; Telegram receives the same plain-text
# rendering `TelegramAlertChannel` produces (icon, title — environment,
# body, one bullet per context entry, key).
#
# Channels (environment):
#   ALERT_WEBHOOK_URL                             optional
#   ALERT_TELEGRAM_BOT_TOKEN + ALERT_TELEGRAM_CHAT_ID  optional
#   TELEGRAM_API_BASE   default https://api.telegram.org (tests point it at a fake)
#   CURL_MAX_TIME       seconds per request (default 15)
#
# Delivered means the receiver said so: a webhook that answered 2xx, or
# Telegram that answered 2xx *and* `ok: true` (it answers 200 with
# `ok: false` for a chat the bot is not in). Every configured channel is
# tried; the alert counts as delivered if any receiver accepted it, exactly
# like `CompositeAlertChannel`.
#
# Exit: 0 = at least one receiver accepted; 2 = channels are set but none
# accepted; 3 = no channel is set (nobody was told — the caller decides how
# loud to be about that). The bot token and the webhook URL never appear in
# the output, whatever curl puts in its messages.
set -u
WEBHOOK="${ALERT_WEBHOOK_URL:-}"
TG_TOKEN="${ALERT_TELEGRAM_BOT_TOKEN:-}"
TG_CHAT="${ALERT_TELEGRAM_CHAT_ID:-}"
TG_BASE="${TELEGRAM_API_BASE:-https://api.telegram.org}"
CURL_MAX_TIME="${CURL_MAX_TIME:-15}"

payload=$(cat)
if ! printf '%s' "$payload" | jq -e 'type=="object" and (.title|type)=="string" and (.body|type)=="string"' >/dev/null 2>&1; then
  echo "page-human: stdin is not an alert object with title and body" >&2
  exit 3
fi

scrub() { # keep credentials out of anything we print
  local s="$1"
  [ -n "$TG_TOKEN" ] && s="${s//"$TG_TOKEN"/***}"
  [ -n "$WEBHOOK" ] && s="${s//"$WEBHOOK"/<webhook>}"
  printf '%s' "$s"
}

configured=0; accepted=0

if [ -n "$WEBHOOK" ]; then
  configured=1
  code=$(curl -sS --max-time "$CURL_MAX_TIME" -o /dev/null -w '%{http_code}' \
    -H 'Content-Type: application/json' -d "$payload" "$WEBHOOK" 2>/dev/null)
  echo "webhook answered ${code:-none}"
  case "$code" in 2*) accepted=1;; esac
fi

if [ -n "$TG_TOKEN" ] && [ -n "$TG_CHAT" ]; then
  configured=1
  # Same rendering as TelegramAlertChannel; plain text on purpose (no
  # parse_mode), so an underscore in an error message cannot turn into a 400.
  text=$(printf '%s' "$payload" | jq -r '
    (if .severity=="critical" then "🔴" else "🟡" end) as $icon
    | [ ($icon + " " + .title + " — " + (.environment // "production")),
        .body ]
      + ((.context // {}) | to_entries | map("• " + .key + ": " + (.value|tostring)))
      + ["key: " + (.key // "")]
    | join("\n") | .[0:4000]')
  body=$(jq -cn --arg chat "$TG_CHAT" --arg text "$text" '{chat_id: $chat, text: $text, disable_web_page_preview: true}')
  out=$(mktemp); trap 'rm -f "$out"' EXIT
  code=$(curl -sS --max-time "$CURL_MAX_TIME" -o "$out" -w '%{http_code}' \
    -H 'Content-Type: application/json' -d "$body" "$TG_BASE/bot$TG_TOKEN/sendMessage" 2>/dev/null)
  ok=$(jq -r '.ok // false' "$out" 2>/dev/null || echo false)
  desc=$(jq -r '.description // ""' "$out" 2>/dev/null || true)
  echo "telegram answered ${code:-none} (ok=$ok$( [ -n "$desc" ] && printf ', %s' "$(scrub "$desc")"))"
  case "$code" in 2*) [ "$ok" = "true" ] && accepted=1;; esac
fi

if [ "$configured" = "0" ]; then
  echo "::warning::no alert channel is set (ALERT_WEBHOOK_URL, or ALERT_TELEGRAM_BOT_TOKEN + ALERT_TELEGRAM_CHAT_ID) — nobody was told"
  exit 3
fi
if [ "$accepted" = "0" ]; then
  echo "::error::no receiver accepted the page — nothing reached a human"
  exit 2
fi
exit 0
