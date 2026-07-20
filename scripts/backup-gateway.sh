#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"
KEY_FILE=${BACKUP_ENCRYPTION_KEY_FILE:-$ROOT/.secrets/backup_encryption_key}
OUTPUT_DIR=${BACKUP_DIR:-$ROOT/backups}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUTPUT=${BACKUP_FILE:-$OUTPUT_DIR/gateway-$STAMP.tar.enc}
umask 077
mkdir -p "$(dirname "$OUTPUT")"
chmod 700 "$(dirname "$OUTPUT")"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

test -s "$KEY_FILE" || { echo "Missing backup encryption key: $KEY_FILE" >&2; exit 1; }
docker compose exec -T postgres pg_dump -U unify -d unify --format=custom --no-owner --no-acl > "$TMP/gateway.dump"
{
  printf 'created_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'git_commit=%s\n' "$(git rev-parse HEAD)"
  printf 'gateway_image=%s\n' "$(docker image inspect unify-gateway:local --format '{{.Id}}')"
  printf 'uniui_image=%s\n' "$(docker image inspect unify-uniui:local --format '{{.Id}}')"
  printf 'chat_image=%s\n' "$(docker image inspect unify-chat-pwa:local --format '{{.Id}}')"
  printf 'alerts_image=%s\n' "$(docker image inspect unify-alerts-pwa:local --format '{{.Id}}')"
  printf 'deployment_mode=%s\n' "${DEPLOYMENT_MODE:-read-only}"
} > "$TMP/release.manifest"
sha256sum apps/gateway/migrations/*.sql > "$TMP/migrations.sha256"
docker compose config > "$TMP/compose.resolved.yaml"
tar -C "$TMP" -cf - gateway.dump release.manifest migrations.sha256 compose.resolved.yaml |
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$KEY_FILE" -out "$OUTPUT"
sha256sum "$OUTPUT" > "$OUTPUT.sha256"
chmod 600 "$OUTPUT" "$OUTPUT.sha256"
printf 'Encrypted Gateway backup created: %s\n' "$OUTPUT"
printf 'Checksum: %s\n' "$(cut -d' ' -f1 "$OUTPUT.sha256")"
