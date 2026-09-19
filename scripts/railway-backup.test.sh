#!/usr/bin/env bash
# Contract test for scripts/railway-backup.sh: a mock of Railway's GraphQL API
# that speaks the real schema shapes (railwayapp/cli src/gql/schema.json) and
# misbehaves on demand. Needs bash, curl, jq, python3.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; S="$HERE/railway-backup.sh"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"; kill $(jobs -p) 2>/dev/null' EXIT
PORT=$((20000 + RANDOM % 20000))
cat > "$TMP/server.py" <<'PY'
import http.server, json, os, sys, re
TMP=sys.argv[1]
def mode(name, default=''):
    try: return open(os.path.join(TMP, name)).read().strip()
    except FileNotFoundError: return default
VI='vi-prod'; VOL='vol-1'; ENV='env-prod'
state={'backups': [], 'schedules': [], 'wf': 0, 'polls': 0}
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def send(self, code, obj):
        body=json.dumps(obj).encode(); self.send_response(code); self.send_header('Content-Type','application/json'); self.end_headers(); self.wfile.write(body)
    def do_POST(self):
        if os.path.exists(os.path.join(TMP,'reset')):
            state['backups']=[]; state['schedules']=[]; state['wf']=0; state['polls']=0; os.remove(os.path.join(TMP,'reset'))
        n=int(self.headers.get('Content-Length',0)); raw=self.rfile.read(n).decode()
        with open(os.path.join(TMP,'requests.log'),'a') as f: f.write(raw+'\n')
        auth=self.headers.get('Authorization',''); pat=self.headers.get('Project-Access-Token','')
        with open(os.path.join(TMP,'headers.log'),'a') as f: f.write(f"auth={auth} pat={pat}\n")
        if mode('transport')=='html':
            self.send_response(502); self.send_header('Content-Type','text/html'); self.end_headers(); self.wfile.write(b'<html>bad gateway</html>'); return
        if mode('transport')=='429':
            self.send(429, {"errors":[{"message":"Too many requests","extensions":{"code":"RATE_LIMITED","traceId":"t1"}}]}); return
        if not auth and not pat:
            self.send(200, {"errors":[{"message":"Not Authorized","extensions":{"code":"INTERNAL_SERVER_ERROR","traceId":"t2"}}],"data":None}); return
        req=json.loads(raw); q=req['query']; v=req.get('variables',{})
        if 'projectToken' in q:
            self.send(200, {"data":{"projectToken":{"projectId":"p","environmentId": mode('token_env', ENV)}}}); return
        if q.startswith('query') and 'volume(id' in q:
            if mode('volume')=='missing': self.send(200, {"errors":[{"message":"Not Authorized","extensions":{"code":"INTERNAL_SERVER_ERROR","traceId":"t3"}}],"data":None}); return
            edges=[{"node":{"id":VI,"environmentId":ENV,"serviceId":"svc","state":mode('vstate','READY'),"currentSizeMB":123.4,"sizeMB":5000}}]
            if mode('volume')=='other-env': edges=[{"node":{"id":"vi-x","environmentId":"env-staging","serviceId":"svc","state":"READY","currentSizeMB":1,"sizeMB":5000}}]
            self.send(200, {"data":{"volume":{"id":v['id'],"name":"postgres-volume","volumeInstances":{"edges":edges}}}}); return
        if 'volumeInstanceBackupScheduleList' in q:
            if mode('has_schedule') and not state['schedules']:
                state['schedules']=[{"id":"s0","name":"DAILY","kind":"DAILY","cron":"0 2 * * *","retentionSeconds":518400}]
            self.send(200, {"data":{"volumeInstanceBackupScheduleList": state['schedules']}}); return
        if 'volumeInstanceBackupScheduleUpdate' in q:
            state['schedules']=[{"id":"s1","name":k,"kind":k,"cron":"0 2 * * *","retentionSeconds":518400} for k in v['kinds']]
            self.send(200, {"data":{"volumeInstanceBackupScheduleUpdate": True}}); return
        if 'volumeInstanceBackupCreate' in q:
            if mode('create')=='null': self.send(200, {"data":{"volumeInstanceBackupCreate":{"workflowId":None}}}); return
            if mode('create')=='error': self.send(200, {"errors":[{"message":"Volume instance is busy","extensions":{"code":"BAD_USER_INPUT","traceId":"t4"}}],"data":None}); return
            state['wf']+=1; state['polls']=0
            if mode('create')!='vanish':
                state['backups'].append({"id":f"b{state['wf']}","name":v.get('name'),"createdAt": mode('created_at', __import__('datetime').datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.000Z')),"expiresAt":None,"usedMB":10,"referencedMB":100,"scheduleId":None})
            self.send(200, {"data":{"volumeInstanceBackupCreate":{"workflowId":f"wf-{state['wf']}"}}}); return
        if 'workflowStatus' in q:
            state['polls']+=1
            st=mode('wfstatus','Complete')
            if st=='slow': st='Running' if state['polls']<2 else 'Complete'
            self.send(200, {"data":{"workflowStatus":{"status":st,"error":"disk full" if st=='Error' else None}}}); return
        if 'volumeInstanceBackupList' in q:
            if mode('list')=='notarray': self.send(200, {"data":{"volumeInstanceBackupList": None}}); return
            self.send(200, {"data":{"volumeInstanceBackupList": state['backups']}}); return
        self.send(400, {"errors":[{"message":"Cannot query field","extensions":{"code":"GRAPHQL_VALIDATION_FAILED","traceId":"t5"}}]})
http.server.HTTPServer(('127.0.0.1',int(sys.argv[2])),H).serve_forever()
PY
python3 "$TMP/server.py" "$TMP" "$PORT" &
for _ in $(seq 1 50); do curl -s -o /dev/null -X POST "http://127.0.0.1:$PORT/" && break; sleep 0.1; done
n=0; fails=0
reset() { rm -f "$TMP"/{transport,volume,vstate,create,wfstatus,list,token_env,created_at,has_schedule}; : > "$TMP/requests.log"; : > "$TMP/headers.log"; touch "$TMP/reset"; curl -s -o /dev/null -X POST -H "Authorization: Bearer reset" -d '{"query":"query { projectToken { projectId } }"}' "http://127.0.0.1:$PORT/"; : > "$TMP/requests.log"; : > "$TMP/headers.log"; }
run() { # name want [env...]
  local name="$1" want="$2"; shift 2
  env API="http://127.0.0.1:$PORT/" VOLUME_ID=vol-1 ENVIRONMENT_ID=env-prod POLL_SECONDS=1 WAIT_SECONDS=2 GITHUB_OUTPUT="$TMP/out" "$@" bash "$S" > "$TMP/run.log" 2>&1
  local got=$?; n=$((n+1))
  if [ "$got" = "$want" ]; then echo "ok   $name (exit $got)"; else echo "FAIL $name: exit $got want $want"; sed 's/^/     /' "$TMP/run.log" | tail -6; fails=$((fails+1)); fi
}
P="RAILWAY_PROJECT_TOKEN=pt-secret"; A="RAILWAY_API_TOKEN=at-secret"

reset; run "no token -> fail loudly, no request made" 1
[ ! -s "$TMP/requests.log" ] && echo "ok   no request without token" || { echo "FAIL request made without token"; fails=$((fails+1)); }; n=$((n+1))
reset; run "project token: create + verify" 0 $P
grep -q "pat=pt-secret" "$TMP/headers.log" && ! grep -q "auth=Bearer" "$TMP/headers.log" && echo "ok   project token uses Project-Access-Token header" || { echo "FAIL header for project token"; fails=$((fails+1)); }; n=$((n+1))
grep -q "volumeInstanceBackupCreate" "$TMP/requests.log" && grep -q "workflowStatus" "$TMP/requests.log" && grep -q "volumeInstanceBackupList" "$TMP/requests.log" && echo "ok   create → workflowStatus → list sequence" || { echo "FAIL sequence"; fails=$((fails+1)); }; n=$((n+1))
reset; run "account token: Bearer header" 0 $A
grep -q "auth=Bearer at-secret" "$TMP/headers.log" && echo "ok   account token uses Bearer" || { echo "FAIL bearer"; fails=$((fails+1)); }; n=$((n+1))
grep -q "pt-secret\|at-secret" "$TMP/run.log" && { echo "FAIL token printed in output"; fails=$((fails+1)); } || echo "ok   token never printed"; n=$((n+1))
reset; echo env-staging > "$TMP/token_env"; run "project token scoped to another environment -> fail" 1 $P
reset; echo missing > "$TMP/volume"; run "volume not found (GraphQL error on 200) -> fail" 1 $P
reset; echo other-env > "$TMP/volume"; run "no instance in this environment -> fail" 1 $P
reset; echo RESTORING > "$TMP/vstate"; run "volume not READY -> fail" 1 $P
reset; echo null > "$TMP/create"; run "create returned null workflowId -> fail" 1 $P
reset; echo error > "$TMP/create"; run "create returned GraphQL error -> fail" 1 $P
reset; echo Error > "$TMP/wfstatus"; run "workflow Error -> fail" 1 $P
reset; echo Running > "$TMP/wfstatus"; run "workflow never completes -> fail" 1 $P
reset; echo slow > "$TMP/wfstatus"; run "workflow Running then Complete -> ok" 0 $P
reset; echo vanish > "$TMP/create"; run "workflow Complete but backup absent from list -> fail" 1 $P
reset; run "verify only, no backups at all -> fail" 1 $P CREATE=false
reset; echo 2020-01-01T00:00:00.000Z > "$TMP/created_at"; run "newest backup too old -> fail" 1 $P
reset; echo notarray > "$TMP/list"; run "list not an array -> fail" 1 $P
reset; echo html > "$TMP/transport"; run "HTTP 502 HTML -> fail" 1 $P
reset; echo 429 > "$TMP/transport"; run "HTTP 429 -> fail" 1 $P
reset; run "ensure schedule when none -> sets it" 0 $P ENSURE_SCHEDULE=DAILY,WEEKLY
grep -q "volumeInstanceBackupScheduleUpdate" "$TMP/requests.log" && grep -q '"DAILY"' "$TMP/requests.log" && echo "ok   schedule mutation sent with kinds" || { echo "FAIL schedule mutation"; fails=$((fails+1)); }; n=$((n+1))
reset; echo 1 > "$TMP/has_schedule"; run "ensure schedule when one exists -> untouched" 0 $P ENSURE_SCHEDULE=DAILY
grep -q "volumeInstanceBackupScheduleUpdate" "$TMP/requests.log" && { echo "FAIL schedule overwritten"; fails=$((fails+1)); } || echo "ok   existing schedule left alone"; n=$((n+1))
reset; run "invalid ENSURE_SCHEDULE -> fail" 1 $P ENSURE_SCHEDULE=HOURLY
run "unreachable API -> fail" 1 $P API=http://127.0.0.1:1/
echo "$((n-fails))/$n passed"; [ "$fails" -eq 0 ]
