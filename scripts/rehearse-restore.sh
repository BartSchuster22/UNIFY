#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"
BACKUP=${1:?usage: scripts/rehearse-restore.sh BACKUP.tar.enc}
KEY_FILE=${BACKUP_ENCRYPTION_KEY_FILE:-$ROOT/.secrets/backup_encryption_key}
TMP=$(mktemp -d)
CONTAINER="unify-restore-$RANDOM-$$"
VOLUME="$CONTAINER-data"
cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker volume rm "$VOLUME" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

test -s "$KEY_FILE" || { echo "Missing backup encryption key: $KEY_FILE" >&2; exit 1; }
test -s "$BACKUP" || { echo "Backup does not exist: $BACKUP" >&2; exit 1; }
sha256sum -c "$BACKUP.sha256"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$KEY_FILE" -in "$BACKUP" |
  tar -C "$TMP" -xf -
sha256sum -c "$TMP/migrations.sha256"
docker volume create "$VOLUME" >/dev/null
docker run -d --name "$CONTAINER" \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=unify \
  -v "$VOLUME:/var/lib/postgresql/data" postgres:16.6-alpine >/dev/null
for _ in $(seq 1 60); do
  docker exec "$CONTAINER" pg_isready -U postgres -d unify >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$CONTAINER" pg_isready -U postgres -d unify >/dev/null
docker exec -i "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  < "$TMP/postgres-globals.sql" >/dev/null
docker exec -i "$CONTAINER" pg_restore -U postgres -d unify --exit-on-error --no-owner --no-acl \
  < "$TMP/gateway.dump"
TABLE_COUNT=$(docker exec "$CONTAINER" psql -U postgres -d unify -Atc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
MIGRATION_COUNT=$(docker exec "$CONTAINER" psql -U postgres -d unify -Atc \
  "SELECT count(*) FROM schema_migrations")
AUDIT_IMAGE=${UNIFY_AUDIT_IMAGE:-${UNIFY_CORE_IMAGE:-unify-gateway:local}}
docker run --rm --network "container:$CONTAINER" --entrypoint /nodejs/bin/node \
  -e DATABASE_URL=postgresql://postgres@127.0.0.1:5432/unify \
  "$AUDIT_IMAGE" dist/cli/verify-audit.js
printf 'Restore rehearsal passed: tables=%s migrations=%s isolated_container=%s\n' \
  "$TABLE_COUNT" "$MIGRATION_COUNT" "$CONTAINER"
printf 'Release manifest: %s\n' "$(tr '\n' ' ' < "$TMP/release.manifest")"
