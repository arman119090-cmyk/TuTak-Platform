#!/usr/bin/env bash
#
# Creates a volume backup of the production Postgres through Railway's public
# GraphQL API and proves it exists. Run by .github/workflows/backup.yml; its
# logic is proven by scripts/railway-backup.test.sh against a mock API.
#
# Every operation below is a documented field of the schema published in
# railwayapp/cli (src/gql/schema.json), checked 19.09.2026:
#   query  volume(id): Volume { volumeInstances { edges { node: VolumeInstance } } }
#   query  volumeInstanceBackupList(volumeInstanceId): [VolumeInstanceBackup!]!
#   query  volumeInstanceBackupScheduleList(volumeInstanceId): [VolumeInstanceBackupSchedule!]!
#   mutation volumeInstanceBackupCreate(volumeInstanceId, name): WorkflowId { workflowId }
#   query  workflowStatus(workflowId): WorkflowResult { status: Complete|Error|NotFound|Running, error }
#   mutation volumeInstanceBackupScheduleUpdate(volumeInstanceId, kinds: [DAILY|WEEKLY|MONTHLY]): Boolean
#
# Auth (one of):
#   RAILWAY_PROJECT_TOKEN  project token (scoped to one environment) → header Project-Access-Token
#   RAILWAY_API_TOKEN      account/workspace token → header Authorization: Bearer
# Inputs:
#   VOLUME_ID, ENVIRONMENT_ID   required
#   CREATE=true|false           make a new backup (default true)
#   ENSURE_SCHEDULE=DAILY,WEEKLY  if the volume has no schedule at all, set this one (default empty = don't touch)
#   MAX_AGE_HOURS               newest backup must be younger than this (default 26)
#   API                         endpoint (default https://backboard.railway.com/graphql/v2)
#   WAIT_SECONDS                how long to wait for the create workflow (default 180)
#
# HTTP 200 is never success on its own: every response is checked for a
# GraphQL `errors` array and for the field actually being present.
# Exit 0 = backup exists and is fresh; 1 = a problem (printed as ::error::); 2 = usage.
set -u
API="${API:-https://backboard.railway.com/graphql/v2}"
VOLUME_ID="${VOLUME_ID:?VOLUME_ID is required}"
ENVIRONMENT_ID="${ENVIRONMENT_ID:?ENVIRONMENT_ID is required}"
CREATE="${CREATE:-true}"
ENSURE_SCHEDULE="${ENSURE_SCHEDULE:-}"
MAX_AGE_HOURS="${MAX_AGE_HOURS:-26}"
WAIT_SECONDS="${WAIT_SECONDS:-180}"
POLL_SECONDS="${POLL_SECONDS:-10}"
[ "$POLL_SECONDS" -ge 1 ] 2>/dev/null || POLL_SECONDS=1   # a zero interval would never advance the wait

if [ -n "${RAILWAY_PROJECT_TOKEN:-}" ]; then
  AUTH_HEADER="Project-Access-Token: $RAILWAY_PROJECT_TOKEN"; TOKEN_KIND=project
elif [ -n "${RAILWAY_API_TOKEN:-}" ]; then
  AUTH_HEADER="Authorization: Bearer $RAILWAY_API_TOKEN"; TOKEN_KIND=account
else
  echo "::error::no Railway token: set RAILWAY_PROJECT_TOKEN (preferred, scoped to the production environment) or RAILWAY_API_TOKEN. No backup was made."
  exit 1
fi
echo "auth: $TOKEN_KIND token"

problem() { echo "::error::$1"; echo "problem=$1" >> "${GITHUB_OUTPUT:-/dev/null}"; exit 1; }

# gql <query> <variables-json> → prints the `data` object; exits 1 on transport error, GraphQL errors, or non-JSON.
gql() {
  local body http resp
  body=$(jq -cn --arg q "$1" --argjson v "$2" '{query: $q, variables: $v}')
  resp=$(curl -sS --max-time 60 -w '\n%{http_code}' -H "$AUTH_HEADER" -H 'Content-Type: application/json' -d "$body" "$API" 2>&1)
  local rc=$?
  http=$(printf '%s' "$resp" | tail -n1); resp=$(printf '%s' "$resp" | sed '$d')
  if [ "$rc" != "0" ]; then problem "Railway API unreachable (curl rc=$rc): $(printf '%s' "$resp" | head -c 200)"; fi
  if ! printf '%s' "$resp" | jq -e . >/dev/null 2>&1; then problem "Railway API answered HTTP $http with a non-JSON body: $(printf '%s' "$resp" | head -c 200)"; fi
  if printf '%s' "$resp" | jq -e '.errors and (.errors | length > 0)' >/dev/null; then
    problem "Railway API returned GraphQL errors (HTTP $http): $(printf '%s' "$resp" | jq -c '[.errors[] | {message, code: .extensions.code, traceId: .extensions.traceId}]')"
  fi
  case "$http" in 2*) ;; *) problem "Railway API answered HTTP $http without a GraphQL error body: $(printf '%s' "$resp" | head -c 200)";; esac
  printf '%s' "$resp" | jq -c '.data // {}'
}

# ── 1. Token sanity (project tokens can answer projectToken; account tokens cannot, and that is fine) ──
if [ "$TOKEN_KIND" = project ]; then
  data=$(gql 'query { projectToken { projectId environmentId } }' '{}') || exit 1
  env_of_token=$(printf '%s' "$data" | jq -r '.projectToken.environmentId // empty')
  [ -n "$env_of_token" ] || problem "project token did not identify its environment: $data"
  [ "$env_of_token" = "$ENVIRONMENT_ID" ] || problem "project token is scoped to environment $env_of_token, not $ENVIRONMENT_ID"
  echo "token scope ok: environment $env_of_token"
fi

# ── 2. Resolve the volume instance in this environment ────────────────────
data=$(gql 'query($id: String!) { volume(id: $id) { id name volumeInstances { edges { node { id environmentId serviceId state currentSizeMB sizeMB } } } } }' "$(jq -cn --arg id "$VOLUME_ID" '{id: $id}')") || exit 1
[ "$(printf '%s' "$data" | jq -r '.volume.id // empty')" = "$VOLUME_ID" ] || problem "volume $VOLUME_ID not found (or the token cannot see it): $data"
vi=$(printf '%s' "$data" | jq -r --arg env "$ENVIRONMENT_ID" '[.volume.volumeInstances.edges[].node | select(.environmentId == $env)] | first // empty | .id // empty')
[ -n "$vi" ] || problem "volume $VOLUME_ID has no instance in environment $ENVIRONMENT_ID: $(printf '%s' "$data" | jq -c '.volume.volumeInstances.edges | map(.node.environmentId)')"
state=$(printf '%s' "$data" | jq -r --arg env "$ENVIRONMENT_ID" '[.volume.volumeInstances.edges[].node | select(.environmentId == $env)][0].state // "unknown"')
used=$(printf '%s' "$data" | jq -r --arg env "$ENVIRONMENT_ID" '[.volume.volumeInstances.edges[].node | select(.environmentId == $env)][0].currentSizeMB // "?"')
echo "volume instance $vi (volume '$(printf '%s' "$data" | jq -r .volume.name)', state $state, ${used} MB used)"
[ "$state" = "READY" ] || problem "volume instance is in state $state, not READY — not taking a backup of a volume that is $state"

# ── 3. Schedule: report, and set one if asked and none exists ─────────────
data=$(gql 'query($id: String!) { volumeInstanceBackupScheduleList(volumeInstanceId: $id) { id name kind cron retentionSeconds } }' "$(jq -cn --arg id "$vi" '{id: $id}')") || exit 1
schedules=$(printf '%s' "$data" | jq -c '.volumeInstanceBackupScheduleList // []')
echo "schedules on the volume: $(printf '%s' "$schedules" | jq -r 'if length == 0 then "NONE" else map("\(.kind) (\(.cron), keep \((.retentionSeconds // 0) / 86400 | floor)d)") | join(", ") end')"
if [ -n "$ENSURE_SCHEDULE" ] && [ "$(printf '%s' "$schedules" | jq 'length')" = "0" ]; then
  kinds=$(printf '%s' "$ENSURE_SCHEDULE" | tr ',' '\n' | sed 's/^ *//;s/ *$//' | grep -E '^(DAILY|WEEKLY|MONTHLY)$' | jq -R . | jq -sc .)
  [ "$(printf '%s' "$kinds" | jq 'length')" != "0" ] || problem "ENSURE_SCHEDULE='$ENSURE_SCHEDULE' contains no valid kind (DAILY, WEEKLY, MONTHLY)"
  data=$(gql 'mutation($id: String!, $kinds: [VolumeInstanceBackupScheduleKind!]!) { volumeInstanceBackupScheduleUpdate(volumeInstanceId: $id, kinds: $kinds) }' "$(jq -cn --arg id "$vi" --argjson k "$kinds" '{id: $id, kinds: $k}')") || exit 1
  [ "$(printf '%s' "$data" | jq -r '.volumeInstanceBackupScheduleUpdate')" = "true" ] || problem "schedule update was not confirmed: $data"
  echo "schedule set: $(printf '%s' "$kinds" | jq -r 'join(", ")')"
fi

# ── 4. Create a backup and wait for the workflow ──────────────────────────
if [ "$CREATE" = "true" ]; then
  name="tutak-$(date -u +%Y%m%d-%H%M)"
  data=$(gql 'mutation($id: String!, $name: String) { volumeInstanceBackupCreate(volumeInstanceId: $id, name: $name) { workflowId } }' "$(jq -cn --arg id "$vi" --arg name "$name" '{id: $id, name: $name}')") || exit 1
  wf=$(printf '%s' "$data" | jq -r '.volumeInstanceBackupCreate.workflowId // empty')
  [ -n "$wf" ] || problem "backup create returned no workflowId: $data"
  echo "backup '$name' requested, workflow $wf"
  waited=0; status=Running
  while [ "$waited" -lt "$WAIT_SECONDS" ]; do
    sleep "$POLL_SECONDS"; waited=$((waited + POLL_SECONDS))
    data=$(gql 'query($id: String!) { workflowStatus(workflowId: $id) { status error } }' "$(jq -cn --arg id "$wf" '{id: $id}')") || exit 1
    status=$(printf '%s' "$data" | jq -r '.workflowStatus.status // "unknown"')
    case "$status" in
      Complete) echo "workflow complete after ${waited}s"; break;;
      Error) problem "backup workflow failed: $(printf '%s' "$data" | jq -r '.workflowStatus.error // "no error text"')";;
      NotFound) problem "backup workflow $wf not found — the create did not register";;
      Running) ;;
      *) problem "unexpected workflow status '$status': $data";;
    esac
  done
  [ "$status" = "Complete" ] || problem "backup workflow still $status after ${WAIT_SECONDS}s"
fi

# ── 5. Verify the newest backup is fresh (and, if we created one, that it is there) ──
data=$(gql 'query($id: String!) { volumeInstanceBackupList(volumeInstanceId: $id) { id name createdAt expiresAt usedMB referencedMB scheduleId } }' "$(jq -cn --arg id "$vi" '{id: $id}')") || exit 1
printf '%s' "$data" | jq -e '.volumeInstanceBackupList | type == "array"' >/dev/null || problem "backup list is not an array: $data"
count=$(printf '%s' "$data" | jq '.volumeInstanceBackupList | length')
printf '%s' "$data" | jq -r '.volumeInstanceBackupList | sort_by(.createdAt) | reverse | .[:5][] | "  \(.createdAt)  \(.name // "-")  used=\(.usedMB // "?")MB referenced=\(.referencedMB // "?")MB expires=\(.expiresAt // "-") \(if .scheduleId then "(scheduled)" else "(manual)" end)"'
if [ "$CREATE" = "true" ]; then
  printf '%s' "$data" | jq -e --arg n "$name" '.volumeInstanceBackupList | map(.name) | index($n) != null' >/dev/null || problem "backup '$name' completed but is not in the backup list"
fi
[ "$count" != "0" ] || problem "NO BACKUP EXISTS for the production Postgres volume"
newest=$(printf '%s' "$data" | jq -r '.volumeInstanceBackupList | map(.createdAt) | max')
newest_epoch=$(date -u -d "$newest" +%s 2>/dev/null) || problem "cannot parse newest backup timestamp '$newest'"
age=$(( $(date -u +%s) - newest_epoch ))
echo "backups: $count; newest: $newest (age $((age/3600))h $(((age%3600)/60))m)"
[ "$age" -le $((MAX_AGE_HOURS*3600)) ] || problem "newest Postgres backup is $((age/3600)) hours old (limit ${MAX_AGE_HOURS}h)"
echo "BACKUP OK"
