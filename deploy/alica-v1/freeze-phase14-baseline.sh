#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT=${UNIFY_ROOT:-/opt/unify}
ROLLBACK_ROOT=${ROLLBACK_ROOT:-$ROOT/rollback}
ORIGIN=${UNIFY_PUBLIC_ORIGIN:-https://unify.167-233-135-142.sslip.io}
SOURCE_COMMIT=${SOURCE_COMMIT:-unknown}
STAMP=${BASELINE_STAMP:-$(date -u +%Y%m%dT%H%M%SZ)}
DEST="$ROLLBACK_ROOT/phase14-baseline-$STAMP"
ARTIFACTS="$DEST/artifacts"
EVIDENCE="$DEST/evidence"
INVENTORY="$DEST/inventory"
WORK=$(mktemp -d)
FROZEN=0
SUCCESS=0

log() { printf '[phase14-baseline] %s\n' "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

recover_runtime() {
  if [ "$FROZEN" -eq 1 ]; then
    log 'Recovering current production runtime after interrupted freeze'
    docker start alica herman >/dev/null 2>&1 || true
    wait_healthy alica 180 || true
    wait_healthy herman 180 || true
    docker start unify-alica-adapter unify-herman-adapter >/dev/null 2>&1 || true
    wait_healthy unify-alica-adapter 180 || true
    wait_healthy unify-herman-adapter 180 || true
    docker start unify-core >/dev/null 2>&1 || true
    wait_healthy unify-core 180 || true
    FROZEN=0
  fi
}

cleanup() {
  rc=$?
  trap - EXIT INT TERM
  recover_runtime
  rm -rf "$WORK"
  if [ "$SUCCESS" -ne 1 ] && [ -d "$DEST" ]; then
    printf 'failed_at=%s exit_code=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$rc" >"$DEST/FAILED"
  fi
  exit "$rc"
}
trap cleanup EXIT INT TERM

require_root() { [ "$(id -u)" -eq 0 ] || die 'run as root'; }
require_command() { command -v "$1" >/dev/null 2>&1 || die "required command missing: $1"; }

wait_healthy() {
  name=$1
  timeout=${2:-180}
  start=$(date +%s)
  while :; do
    state=$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$name" 2>/dev/null || true)
    case "$state" in
      'running healthy'|'running none') return 0 ;;
      *unhealthy*) return 1 ;;
    esac
    [ $(( $(date +%s) - start )) -lt "$timeout" ] || return 1
    sleep 2
  done
}

filesystem_manifest() {
  root=$1
  output=$2
  python3 - "$root" >"$output" <<'PY'
import hashlib, json, os, pathlib, stat, sys
root = pathlib.Path(sys.argv[1])
if not root.is_dir():
    raise SystemExit(f'missing directory: {root}')
rows=[]
for path in sorted(root.rglob('*'), key=lambda p: os.fsencode(str(p.relative_to(root)))):
    rel=str(path.relative_to(root))
    st=path.lstat()
    mode=stat.S_IMODE(st.st_mode)
    if path.is_symlink():
        kind='symlink'; digest=None; target=os.readlink(path); size=len(os.fsencode(target))
    elif path.is_file():
        kind='file'; target=None; size=st.st_size
        h=hashlib.sha256()
        with path.open('rb') as f:
            for chunk in iter(lambda:f.read(1024*1024), b''): h.update(chunk)
        digest=h.hexdigest()
    elif path.is_dir():
        kind='directory'; digest=None; target=None; size=0
    else:
        kind='special'; digest=None; target=None; size=st.st_size
    xattrs=[]
    try:
        for name in sorted(os.listxattr(path, follow_symlinks=False)):
            value=os.getxattr(path,name,follow_symlinks=False)
            xattrs.append([name,hashlib.sha256(value).hexdigest()])
    except OSError:
        pass
    rows.append({'path':rel,'kind':kind,'mode':mode,'uid':st.st_uid,'gid':st.st_gid,
                 'size':size,'mtime_ns':st.st_mtime_ns,'sha256':digest,'target':target,
                 'xattrs':xattrs})
json.dump(rows,sys.stdout,sort_keys=True,separators=(',',':'))
sys.stdout.write('\n')
PY
}

archive_tree() {
  label=$1
  parent=$2
  leaf=$3
  expected_manifest=$4
  plaintext="$WORK/$label.tar.gz"
  encrypted="$ARTIFACTS/$label.tar.gz.age"
  tar --acls --xattrs --numeric-owner --one-file-system -C "$parent" -czf "$plaintext" "$leaf"
  age --recipient "$(<"$ROOT/secrets/backup-age-recipient")" --output "$encrypted" "$plaintext"
  rm -f "$plaintext"

  restore="$WORK/restore-$label"
  mkdir -p "$restore"
  decrypted="$WORK/restore-$label.tar.gz"
  age --decrypt --identity "$ROOT/secrets/backup-age.key" --output "$decrypted" "$encrypted"
  tar --acls --xattrs --numeric-owner -C "$restore" -xzf "$decrypted"
  rm -f "$decrypted"
  filesystem_manifest "$restore/$leaf" "$WORK/$label-restored.manifest.json"
  cmp "$expected_manifest" "$WORK/$label-restored.manifest.json"
  cp "$expected_manifest" "$EVIDENCE/$label-filesystem-manifest.json"
  printf '%s_restore_test=passed\n' "$label" >>"$EVIDENCE/restore-tests.log"
}

sanitize_inspect() {
  python3 -c '
import json,re,sys
value=json.load(sys.stdin)
sensitive=re.compile(r"(?:PASSWORD|TOKEN|SECRET|PEPPER|PRIVATE|CREDENTIAL|AUTH)",re.I)
for item in value:
    cfg=item.get("Config") or {}
    env=[]
    for entry in cfg.get("Env") or []:
        key,sep,val=entry.partition("=")
        if sensitive.search(key) and not key.endswith("_FILE") and key not in {"FRAMEWORK_AUTH_ENV_NAMES"}:
            val="<redacted>"
        env.append(key+sep+val)
    cfg["Env"]=env
json.dump(value,sys.stdout,indent=2,sort_keys=True)
sys.stdout.write("\n")
'
}

copy_config() {
  source=$1
  target_root=$2
  [ -e "$source" ] || return 0
  mkdir -p "$target_root$(dirname "$source")"
  cp -a "$source" "$target_root$source"
}

require_root
for cmd in age curl docker find openssl python3 sha256sum tar; do require_command "$cmd"; done
[ -x "$ROOT/qa10-production.sh" ] || die "missing $ROOT/qa10-production.sh"
[ -x "$ROOT/backup.sh" ] || die "missing $ROOT/backup.sh"
[ -x "$ROOT/test-restore.sh" ] || die "missing $ROOT/test-restore.sh"
[ -s "$ROOT/secrets/backup-age.key" ] || die 'missing backup age identity'
[ -s "$ROOT/secrets/backup-age-recipient" ] || die 'missing backup age recipient'
[ ! -e "$DEST" ] || die "baseline destination already exists: $DEST"
mkdir -p "$ARTIFACTS" "$EVIDENCE" "$INVENTORY" "$ROLLBACK_ROOT"
chmod 700 "$DEST" "$ARTIFACTS" "$EVIDENCE" "$INVENTORY"

log 'Verifying current production before capture'
curl --fail-with-body --silent --show-error "$ORIGIN/api/v1/health/ready" >"$EVIDENCE/preflight-public-health.json"
UNIFY_PUBLIC_ORIGIN="$ORIGIN" "$ROOT/qa10-production.sh" >"$EVIDENCE/pre-freeze-qa10.log" 2>&1
grep -q '^qa10_run=passed$' "$EVIDENCE/pre-freeze-qa10.log" || die 'pre-freeze QA10 did not pass'

log 'Capturing host, Docker, network, volume, bind-mount, secret, DNS, and TLS inventory'
{
  printf 'captured_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'source_commit=%s\n' "$SOURCE_COMMIT"
  printf 'origin=%s\n' "$ORIGIN"
  printf 'hostname=%s\n' "$(hostname)"
  printf 'kernel=%s\n' "$(uname -srmo)"
  printf 'boot_id=%s\n' "$(cat /proc/sys/kernel/random/boot_id)"
  printf 'docker=%s\n' "$(docker version --format '{{.Server.Version}}')"
  printf 'compose=%s\n' "$(docker compose version --short)"
} >"$INVENTORY/baseline.properties"

{
  date -u --iso-8601=seconds
  timedatectl
  uptime
  free -h
  df -hT
  df -ih
  lsblk -o NAME,SIZE,FSTYPE,MOUNTPOINTS
} >"$INVENTORY/host.txt"

docker ps -a --no-trunc >"$INVENTORY/docker-ps.txt"
docker image ls --digests --no-trunc >"$INVENTORY/docker-images.txt"
docker system df -v >"$INVENTORY/docker-system-df.txt"
docker inspect $(docker ps -aq) | sanitize_inspect >"$INVENTORY/container-inspect.sanitized.json"
docker image inspect $(docker image ls -q | sort -u) >"$INVENTORY/image-inspect.json"
docker network inspect $(docker network ls -q) >"$INVENTORY/network-inspect.json"
volume_ids=$(docker volume ls -q)
if [ -n "$volume_ids" ]; then docker volume inspect $volume_ids >"$INVENTORY/volume-inspect.json"; else printf '[]\n' >"$INVENTORY/volume-inspect.json"; fi
python3 - "$INVENTORY/container-inspect.sanitized.json" >"$INVENTORY/bind-mounts.tsv" <<'PY'
import json,sys
for c in json.load(open(sys.argv[1])):
    for m in c.get('Mounts',[]):
        print(c['Name'].lstrip('/'),m.get('Type',''),m.get('Source',''),m.get('Destination',''),m.get('Mode',''),m.get('RW',''),sep='\t')
PY

find "$ROOT/secrets" -maxdepth 1 -type f -print0 | sort -z | xargs -0 sha256sum >"$INVENTORY/secret-SHA256SUMS"
find "$ROOT/secrets" -maxdepth 1 -type f -printf '%p|%u|%g|%m|%s\n' | sort >"$INVENTORY/secret-metadata.txt"

{
  getent ahostsv4 "${ORIGIN#https://}" || true
  getent ahostsv6 "${ORIGIN#https://}" || true
} >"$INVENTORY/public-dns.txt"
openssl s_client -connect "${ORIGIN#https://}:443" -servername "${ORIGIN#https://}" </dev/null 2>"$INVENTORY/tls-handshake.stderr" |
  openssl x509 -noout -subject -issuer -serial -dates -fingerprint -sha256 >"$INVENTORY/public-tls.txt"
curl --silent --show-error --dump-header "$INVENTORY/public-headers.txt" --output /dev/null "$ORIGIN/api/v1/health/ready"

{
  systemctl status --no-pager --full caddy.service unify-backup.timer alica-docker-firewall.service || true
  systemctl list-timers --all --no-pager | grep -E 'unify-backup|NEXT|^$' || true
  ufw status verbose || true
  iptables-save || true
  ip6tables-save || true
  ss -lntup || true
} >"$INVENTORY/host-services-firewall.txt" 2>&1

log 'Creating encrypted, restore-tested configuration and Caddy-state bundles'
CONFIG_TREE="$WORK/config-tree"
mkdir -p "$CONFIG_TREE"
for file in \
  /srv/alica-stack/compose.yaml \
  "$ROOT/compose.yaml" \
  "$ROOT/.env" \
  "$ROOT/deploy/alica-v1/hermes-api.override.yaml" \
  "$ROOT/deploy/alica-v1/alica-api.Caddyfile" \
  "$ROOT/deploy/alica-v1/herman-api.Caddyfile" \
  "$ROOT/prepare-secrets.sh" \
  "$ROOT/register-frameworks.sh" \
  "$ROOT/qa10-production.sh" \
  "$ROOT/backup.sh" \
  "$ROOT/test-restore.sh" \
  /etc/caddy/Caddyfile \
  /etc/docker/daemon.json \
  /usr/local/sbin/alica-docker-firewall \
  /etc/systemd/system/alica-docker-firewall.service \
  /etc/systemd/system/unify-backup.service \
  /etc/systemd/system/unify-backup.timer; do
  copy_config "$file" "$CONFIG_TREE"
done
filesystem_manifest "$CONFIG_TREE" "$WORK/config-bundle.manifest.json"
archive_tree config-bundle "$WORK" config-tree "$WORK/config-bundle.manifest.json"

CADDY_TREE="$WORK/caddy-state"
mkdir -p "$CADDY_TREE"
cp -a /var/lib/caddy "$CADDY_TREE/var-lib-caddy"
filesystem_manifest "$CADDY_TREE" "$WORK/caddy-state.manifest.json"
archive_tree caddy-state "$WORK" caddy-state "$WORK/caddy-state.manifest.json"

log 'Creating and restore-testing a fresh encrypted PostgreSQL backup'
"$ROOT/backup.sh" >"$EVIDENCE/database-backup.log" 2>&1
DB_BACKUP=$(python3 - "$EVIDENCE/database-backup.log" <<'PY'
import pathlib,sys
for token in pathlib.Path(sys.argv[1]).read_text().split():
    if token.startswith('backup='):
        print(token.split('=',1)[1]); break
else: raise SystemExit('backup path missing')
PY
)
[ -s "$DB_BACKUP" ] || die 'fresh database backup missing'
sha256sum -c "$DB_BACKUP.sha256" >"$EVIDENCE/database-backup-checksum.log"
"$ROOT/test-restore.sh" "$DB_BACKUP" >"$EVIDENCE/database-restore-test.log" 2>&1
grep -q '^restore_test=passed ' "$EVIDENCE/database-restore-test.log" || die 'database restore rehearsal did not pass'
cp -a "$DB_BACKUP" "$ARTIFACTS/"
( cd "$ARTIFACTS" && sha256sum "$(basename "$DB_BACKUP")" >"$(basename "$DB_BACKUP").sha256" )

log 'Entering application-consistent framework-data freeze'
docker stop --time 30 unify-core >"$EVIDENCE/freeze-stop.log"
docker stop --time 30 unify-alica-adapter unify-herman-adapter >>"$EVIDENCE/freeze-stop.log"
docker stop --time 30 alica herman >>"$EVIDENCE/freeze-stop.log"
FROZEN=1
for name in unify-core unify-alica-adapter unify-herman-adapter alica herman; do
  [ "$(docker inspect -f '{{.State.Status}}' "$name")" = exited ] || die "$name did not stop for snapshot"
done
docker ps -a --no-trunc >"$EVIDENCE/frozen-container-state.txt"

filesystem_manifest /srv/alica-stack/data/alica "$WORK/alica-data.manifest.json"
filesystem_manifest /srv/alica-stack/data/herman "$WORK/herman-data.manifest.json"
archive_tree alica-data /srv/alica-stack/data alica "$WORK/alica-data.manifest.json"
archive_tree herman-data /srv/alica-stack/data herman "$WORK/herman-data.manifest.json"

log 'Restarting unchanged production runtime'
docker start alica herman >"$EVIDENCE/restart.log"
wait_healthy alica 180 || die 'Alica did not recover healthy'
wait_healthy herman 180 || die 'Herman did not recover healthy'
docker start unify-alica-adapter unify-herman-adapter >>"$EVIDENCE/restart.log"
wait_healthy unify-alica-adapter 180 || die 'Alica adapter did not recover healthy'
wait_healthy unify-herman-adapter 180 || die 'Herman adapter did not recover healthy'
docker start unify-core >>"$EVIDENCE/restart.log"
wait_healthy unify-core 180 || die 'Core did not recover healthy'
FROZEN=0

log 'Running post-freeze production QA10'
curl --fail-with-body --silent --show-error "$ORIGIN/api/v1/health/ready" >"$EVIDENCE/post-freeze-public-health.json"
UNIFY_PUBLIC_ORIGIN="$ORIGIN" "$ROOT/qa10-production.sh" >"$EVIDENCE/post-freeze-qa10.log" 2>&1
grep -q '^qa10_run=passed$' "$EVIDENCE/post-freeze-qa10.log" || die 'post-freeze QA10 did not pass'
docker ps -a --no-trunc >"$EVIDENCE/post-freeze-container-state.txt"

python3 - "$DEST/baseline-manifest.json" "$STAMP" "$SOURCE_COMMIT" "$ORIGIN" "$DB_BACKUP" <<'PY'
import json,pathlib,sys
path,stamp,source,origin,backup=sys.argv[1:]
data={
  'schemaVersion':1,
  'baselineId':f'phase14-baseline-{stamp}',
  'capturedAtUtc':stamp,
  'sourceCommit':source,
  'publicOrigin':origin,
  'databaseBackupSource':backup,
  'verification':{
    'preFreezeQa10':'passed',
    'databaseChecksum':'passed',
    'databaseIsolatedRestore':'passed',
    'configBundleRestore':'passed',
    'caddyStateRestore':'passed',
    'alicaDataRestore':'passed',
    'hermanDataRestore':'passed',
    'runtimeRecovery':'passed',
    'postFreezeQa10':'passed'
  },
  'rollbackDependencies':[
    'existing /opt/unify/secrets/backup-age.key identity',
    'retained current Docker images or exact reproducible source and pinned bases',
    'retained PostgreSQL volume or encrypted database artifact',
    'host Docker, systemd, Caddy, age, tar and OpenSSL tooling'
  ]
}
pathlib.Path(path).write_text(json.dumps(data,indent=2,sort_keys=True)+'\n')
PY

( cd "$DEST" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum >SHA256SUMS )
( cd "$DEST" && sha256sum -c SHA256SUMS >"$WORK/final-checksum.log" )
cp "$WORK/final-checksum.log" "$EVIDENCE/final-checksum-verification.log"
# The evidence log was added after the first manifest; regenerate and verify the final closed set.
( cd "$DEST" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum >SHA256SUMS )
( cd "$DEST" && sha256sum -c SHA256SUMS >/dev/null )
ln -sfn "$(basename "$DEST")" "$ROLLBACK_ROOT/phase14-current"
SUCCESS=1
log "PASS baseline=$DEST"
log "pointer=$ROLLBACK_ROOT/phase14-current"
