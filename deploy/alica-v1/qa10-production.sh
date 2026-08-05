#!/usr/bin/env bash
set -euo pipefail
umask 077
ROOT=${UNIFY_ROOT:-/opt/unify}
ORIGIN=${UNIFY_PUBLIC_ORIGIN:?UNIFY_PUBLIC_ORIGIN is required}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cookie="$tmp/cookie"
headers="$tmp/headers"
body="$tmp/body"
password=$(cat "$ROOT/secrets/bootstrap-admin-password")
json_login=$(python3 - "$password" <<'PY'
import json,sys
print(json.dumps({'username':'herman','password':sys.argv[1],'deviceLabel':'QA10 acceptance'}))
PY
)
code=$(curl -sS -o "$body" -w '%{http_code}' -H 'content-type: application/json' --data '{"username":"qa10-no-such-user","password":"not-a-valid-password"}' "$ORIGIN/api/v1/auth/login")
[ "$code" = 401 ] || [ "$code" = 429 ]
code=$(curl -sS -o "$body" -w '%{http_code}' "$ORIGIN/api/v1/frameworks")
[ "$code" = 401 ]
curl --fail-with-body -sS -D "$headers" -c "$cookie" -H 'content-type: application/json' --data "$json_login" "$ORIGIN/api/v1/auth/login" > "$body"
csrf=$(awk 'BEGIN{IGNORECASE=1} /^x-csrf-token:/ {gsub("\r",""); print $2}' "$headers")
[ -n "$csrf" ]
echo qa10_stage=authentication
curl --fail-with-body -sS -b "$cookie" "$ORIGIN/api/v1/auth/me" > "$body"
python3 - "$body" <<'PY'
import json,sys
x=json.load(open(sys.argv[1])); assert x['username']=='herman'; assert 'administrator' in {r.lower() for r in x['roles']}; assert 'audit.read' in x['permissions']
PY
register() {
  id=$1; name=$2; endpoint=$3; reference=$4
  payload=$(python3 - "$id" "$name" "$endpoint" "$reference" <<'PY'
import json,sys
print(json.dumps({'frameworkId':sys.argv[1],'displayName':sys.argv[2],'baseUrl':sys.argv[3],'serviceAuthReference':sys.argv[4],'scopes':['control:read','control:execute','control:events'],'expectedContractVersion':'hermes-control/v1','expectedFrameworkVersion':'0.20.0','expectedFrameworkCommit':'b8b17b8cee50b85adb7fba6ea332dc06731b86f4','enabled':True}))
PY
)
  for replay in 1 2; do
    curl --fail-with-body -sS -b "$cookie" -H "x-csrf-token: $csrf" -H 'content-type: application/json' -X PUT --data "$payload" "$ORIGIN/api/v1/frameworks/$id" > "$body"
    python3 - "$body" "$id" <<'PY'
import json,sys
x=json.load(open(sys.argv[1])); assert x['frameworkId']==sys.argv[2]; assert x['status']=='verified'; assert x['enabled'] is True
PY
  done
}
register hermes-alica Alica https://alica-adapter:28082 env:ALICA_FRAMEWORK_TOKEN
register hermes-herman Herman https://herman-adapter:28082 env:HERMAN_FRAMEWORK_TOKEN
echo qa10_stage=registration
for fw in hermes-alica hermes-herman; do
  for path in health capabilities profiles providers work/projects work/boards work/cronjobs conversations/sessions events; do
    echo "qa10_stage=read framework=$fw path=$path"
    curl --fail-with-body -sS -b "$cookie" "$ORIGIN/api/v1/frameworks/$fw/$path?limit=100" > "$body"
    python3 - "$body" "$fw" "$path" <<'PY'
import json,sys
x=json.load(open(sys.argv[1])); assert isinstance(x,dict)
if 'meta' in x and isinstance(x['meta'],dict) and 'frameworkId' in x['meta']: assert x['meta']['frameworkId']==sys.argv[2]
if sys.argv[3]=='conversations/sessions': assert isinstance(x.get('items'),list)
PY
  done
done
echo qa10_stage=concurrency
pids=''
for i in $(seq 1 12); do
  curl --fail-with-body -sS -b "$cookie" "$ORIGIN/api/v1/frameworks" > "$tmp/concurrent-$i.json" & pids="$pids $!"
done
for pid in $pids; do wait "$pid"; done
python3 - "$tmp" <<'PY'
import json,pathlib,sys
for p in pathlib.Path(sys.argv[1]).glob('concurrent-*.json'):
 x=json.load(open(p)); ids={v['frameworkId'] for v in x['items']}; assert ids=={'hermes-alica','hermes-herman'}
PY
curl --fail-with-body -sS -b "$cookie" "$ORIGIN/api/v1/audit?limit=500" > "$body"
echo qa10_stage=audit
python3 - "$body" "$ROOT" <<'PY'
import json,pathlib,sys
raw=pathlib.Path(sys.argv[1]).read_text(); x=json.loads(raw)
assert any(v.get('eventType')=='framework.register' and v.get('outcome')=='success' for v in x['items'])
for n in ('alica-token','herman-token','alica-api-token','herman-api-token','postgres-password','auth-pepper'):
 p=pathlib.Path(sys.argv[2])/f'secrets/{n}'
 if p.exists(): assert p.read_text().strip() not in raw
PY
code=$(curl -sS -o "$body" -w '%{http_code}' -b "$cookie" -H "x-csrf-token: $csrf" -X POST "$ORIGIN/api/v1/auth/logout")
[ "$code" = 204 ]
code=$(curl -sS -o "$body" -w '%{http_code}' -b "$cookie" "$ORIGIN/api/v1/auth/me")
[ "$code" = 401 ]
echo qa10_run=passed
