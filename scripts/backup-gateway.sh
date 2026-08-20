#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"
COMPOSE_FILE=${UNIFY_COMPOSE_FILE:-$ROOT/compose.yaml}
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
mapfile -t SERVICES < <(docker compose -f "$COMPOSE_FILE" --project-name "$COMPOSE_PROJECT" config --services)
DB_SERVICE=${UNIFY_DB_SERVICE:-}
if [[ -z "$DB_SERVICE" ]]; then
  for candidate in unify-postgres postgres; do
    if printf '%s\n' "${SERVICES[@]}" | grep -Fxq "$candidate"; then
      DB_SERVICE=$candidate
      break
    fi
  done
fi
test -n "$DB_SERVICE" || { echo "No supported PostgreSQL service in $COMPOSE_FILE" >&2; exit 1; }
DB_CONTAINER=$(docker compose -f "$COMPOSE_FILE" --project-name "$COMPOSE_PROJECT" ps -q "$DB_SERVICE")
test -n "$DB_CONTAINER" || { echo "Database service $DB_SERVICE is not running" >&2; exit 1; }
test "$(docker inspect "$DB_CONTAINER" --format '{{.State.Running}}')" = true || {
  echo "Database container $DB_CONTAINER is not running" >&2
  exit 1
}

run_db() {
  docker exec "$DB_CONTAINER" sh -lc 'exec "$@"' sh "$@"
}
run_db pg_dump -U unify -d unify --format=custom --no-owner --no-acl > "$TMP/gateway.dump"
run_db pg_dumpall -U unify --globals-only --no-role-passwords |
  sed -E 's/ GRANTED BY [^;]+;/;/' > "$TMP/postgres-globals.sql"
{
  printf 'created_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'git_commit=%s\n' "${UNIFY_GIT_COMMIT:-$(git rev-parse HEAD)}"
  printf 'compose_project=%s\n' "$COMPOSE_PROJECT"
  printf 'compose_file=%s\n' "$COMPOSE_FILE"
  printf 'database_service=%s\n' "$DB_SERVICE"
  printf 'postgres_image=%s\n' "$(docker inspect "$DB_CONTAINER" --format '{{.Image}}')"
  for service in gateway unify-core hermes-main-adapter alica herman caddy; do
    if printf '%s\n' "${SERVICES[@]}" | grep -Fxq "$service"; then
      container=$(docker compose -f "$COMPOSE_FILE" --project-name "$COMPOSE_PROJECT" ps -q "$service")
      if [[ -n "$container" ]] && [[ "$(docker inspect "$container" --format '{{.State.Running}}')" = true ]]; then
        printf '%s_image=%s\n' "${service//-/_}" "$(docker inspect "$container" --format '{{.Image}}')"
      fi
    fi
  done
} > "$TMP/release.manifest"
sha256sum apps/gateway/migrations/*.sql apps/core/migrations/*.sql > "$TMP/migrations.sha256"
if [[ -f deploy/five-service/frameworks.json ]]; then
  sha256sum deploy/five-service/frameworks.json > "$TMP/declarative-config.sha256"
else
  : > "$TMP/declarative-config.sha256"
fi
docker compose -f "$COMPOSE_FILE" --project-name "$COMPOSE_PROJECT" config > "$TMP/compose.resolved.yaml"
tar -C "$TMP" -cf - gateway.dump postgres-globals.sql release.manifest migrations.sha256 declarative-config.sha256 compose.resolved.yaml |
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$KEY_FILE" -out "$OUTPUT"
sha256sum "$OUTPUT" > "$OUTPUT.sha256"
chmod 600 "$OUTPUT" "$OUTPUT.sha256"
printf 'Encrypted Gateway backup created: %s\n' "$OUTPUT"
printf 'Checksum: %s\n' "$(cut -d' ' -f1 "$OUTPUT.sha256")"
printf 'Database service: %s\n' "$DB_SERVICE"
