#!/usr/bin/env bash
set -euo pipefail
umask 077
ROOT=${UNIFY_ROOT:-/opt/unify}
ORIGIN=${UNIFY_PUBLIC_ORIGIN:?UNIFY_PUBLIC_ORIGIN is required}
COOKIE=$(mktemp)
HEADERS=$(mktemp)
trap 'rm -f "$COOKIE" "$HEADERS"' EXIT
password=$(cat "$ROOT/secrets/bootstrap-admin-password")
login=$(python3 - "$password" <<'PY'
import json,sys
print(json.dumps({'username':'herman','password':sys.argv[1],'deviceLabel':'ALICA-v1 bootstrap'}))
PY
)
curl --fail-with-body --silent --show-error -D "$HEADERS" -c "$COOKIE" -H 'content-type: application/json' --data "$login" "$ORIGIN/api/v1/auth/login" >/dev/null
csrf=$(awk 'BEGIN{IGNORECASE=1} /^x-csrf-token:/ {gsub("\r",""); print $2}' "$HEADERS")
test -n "$csrf"
register() {
  local id=$1 name=$2 endpoint=$3 reference=$4 body
  body=$(python3 - "$id" "$name" "$endpoint" "$reference" <<'PY'
import json,sys
print(json.dumps({'frameworkId':sys.argv[1],'displayName':sys.argv[2],'baseUrl':sys.argv[3],'serviceAuthReference':sys.argv[4],'scopes':['control:read','control:execute','control:events'],'expectedContractVersion':'hermes-control/v1','expectedFrameworkVersion':'0.20.0','expectedFrameworkCommit':'b8b17b8cee50b85adb7fba6ea332dc06731b86f4','enabled':True}))
PY
)
  curl --fail-with-body --silent --show-error -b "$COOKIE" -H "x-csrf-token: $csrf" -H 'content-type: application/json' -X PUT --data "$body" "$ORIGIN/api/v1/frameworks/$id"
  printf '\n'
}
register hermes-alica Alica https://alica-adapter:28082 env:ALICA_FRAMEWORK_TOKEN
register hermes-herman Herman https://herman-adapter:28082 env:HERMAN_FRAMEWORK_TOKEN
