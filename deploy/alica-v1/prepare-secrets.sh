#!/usr/bin/env bash
set -euo pipefail
umask 077
ROOT=${1:-/opt/unify}
SECRETS="$ROOT/secrets"
mkdir -p "$SECRETS" "$ROOT/backups"
if find "$SECRETS" -mindepth 1 -maxdepth 1 -type f | grep -q .; then
  echo "Refusing to replace existing deployment secrets" >&2
  exit 1
fi
password=$(openssl rand -hex 32)
pepper=$(openssl rand -hex 48)
admin=$(openssl rand -base64 36 | tr -d '\n')
alica=$(openssl rand -hex 48)
herman=$(openssl rand -hex 48)
printf '%s' "$password" > "$SECRETS/postgres-password"
printf 'postgresql://unify:%s@unify-postgres:5432/unify' "$password" > "$SECRETS/database-url"
cp "$SECRETS/database-url" "$SECRETS/database-url-adapter"
printf '%s' "$pepper" > "$SECRETS/auth-pepper"
printf '%s' "$admin" > "$SECRETS/bootstrap-admin-password"
printf '%s' "$alica" > "$SECRETS/alica-token"
printf '%s' "$herman" > "$SECRETS/herman-token"
python3 - "$SECRETS" "$alica" "$herman" <<'PY'
import json, pathlib, sys
root=pathlib.Path(sys.argv[1])
for name, token in [('alica',sys.argv[2]),('herman',sys.argv[3])]:
    (root/f'{name}-token-bundle.json').write_text(json.dumps({'active': {'version':'2026-08-v1','token':token}}, separators=(',',':')))
PY
openssl genpkey -algorithm ED25519 -out "$SECRETS/framework-ca.key"
openssl req -x509 -new -key "$SECRETS/framework-ca.key" -days 1095 -subj '/CN=UNIFY ALICA-v1 Framework CA' -out "$SECRETS/framework-ca.crt"
for name in alica herman; do
  openssl genpkey -algorithm ED25519 -out "$SECRETS/$name.key"
  openssl req -new -key "$SECRETS/$name.key" -subj "/CN=$name-adapter" -out "$SECRETS/$name.csr"
  printf 'subjectAltName=DNS:%s-adapter\nextendedKeyUsage=serverAuth\n' "$name" > "$SECRETS/$name.ext"
  openssl x509 -req -in "$SECRETS/$name.csr" -CA "$SECRETS/framework-ca.crt" -CAkey "$SECRETS/framework-ca.key" -CAcreateserial -days 825 -extfile "$SECRETS/$name.ext" -out "$SECRETS/$name.crt"
  rm -f "$SECRETS/$name.csr" "$SECRETS/$name.ext"
  openssl genpkey -algorithm ED25519 -out "$SECRETS/$name-api.key"
  openssl req -new -key "$SECRETS/$name-api.key" -subj "/CN=$name-api" -out "$SECRETS/$name-api.csr"
  printf 'subjectAltName=DNS:%s-api\nextendedKeyUsage=serverAuth\n' "$name" > "$SECRETS/$name-api.ext"
  openssl x509 -req -in "$SECRETS/$name-api.csr" -CA "$SECRETS/framework-ca.crt" -CAkey "$SECRETS/framework-ca.key" -CAcreateserial -days 825 -extfile "$SECRETS/$name-api.ext" -out "$SECRETS/$name-api.crt"
  rm -f "$SECRETS/$name-api.csr" "$SECRETS/$name-api.ext"
done
age-keygen -o "$SECRETS/backup-age.key" 2> "$SECRETS/backup-age-recipient"
age-keygen -y "$SECRETS/backup-age.key" > "$SECRETS/backup-age-recipient"
chmod 711 "$SECRETS"
chmod 600 "$SECRETS"/*
sudo chown 0:0 "$SECRETS/postgres-password" "$SECRETS/backup-age.key" "$SECRETS/backup-age-recipient"
sudo chown 65532:65532 "$SECRETS/database-url" "$SECRETS/auth-pepper" "$SECRETS/bootstrap-admin-password" "$SECRETS/alica-token" "$SECRETS/herman-token" "$SECRETS/framework-ca.crt"
sudo chown 10000:10000 "$SECRETS/database-url-adapter" "$SECRETS/alica-token-bundle.json" "$SECRETS/herman-token-bundle.json" "$SECRETS/alica.key" "$SECRETS/alica.crt" "$SECRETS/alica-api.key" "$SECRETS/alica-api.crt" "$SECRETS/herman.key" "$SECRETS/herman.crt" "$SECRETS/herman-api.key" "$SECRETS/herman-api.crt"
echo "Fresh deployment secrets and independent framework credentials generated. Values were not printed."
