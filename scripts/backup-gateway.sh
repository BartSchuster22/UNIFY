#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"
COMPOSE_FILE=${UNIFY_COMPOSE_FILE:-$ROOT/deploy/five-service/compose.yaml}
COMPOSE_PROJECT=${UNIFY_COMPOSE_PROJECT:-unify}
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
docker compose -f "$COMPOSE_FILE" --project-name "$COMPOSE_PROJECT" exec -T unify-postgres \
  pg_dump -U unify -d unify --format=custom --no-owner --no-acl > "$TMP/gateway.dump"
{
  printf 'created_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'git_commit=%s\n' "${UNIFY_GIT_COMMIT:-$(git rev-parse HEAD)}"
  printf 'hermes_runtime_image=%s\n' "$(docker image inspect "${HERMES_RUNTIME_IMAGE:?required}" --format '{{.Id}}')"
  printf 'core_image=%s\n' "$(docker image inspect "${UNIFY_CORE_IMAGE:?required}" --format '{{.Id}}')"
  printf 'caddy_image=%s\n' "$(docker image inspect "${CADDY_IMAGE:?required}" --format '{{.Id}}')"
  printf 'compose_project=%s\n' "$COMPOSE_PROJECT"
} > "$TMP/release.manifest"
sha256sum apps/gateway/migrations/*.sql > "$TMP/migrations.sha256"
sha256sum deploy/five-service/frameworks.json > "$TMP/declarative-config.sha256"
docker compose -f "$COMPOSE_FILE" --project-name "$COMPOSE_PROJECT" config > "$TMP/compose.resolved.yaml"
tar -C "$TMP" -cf - gateway.dump release.manifest migrations.sha256 declarative-config.sha256 compose.resolved.yaml |
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$KEY_FILE" -out "$OUTPUT"
sha256sum "$OUTPUT" > "$OUTPUT.sha256"
chmod 600 "$OUTPUT" "$OUTPUT.sha256"
printf 'Encrypted Gateway backup created: %s\n' "$OUTPUT"
printf 'Checksum: %s\n' "$(cut -d' ' -f1 "$OUTPUT.sha256")"
