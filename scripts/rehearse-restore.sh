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
CORE_SCHEMA=$(docker exec "$CONTAINER" psql -U postgres -d unify -Atc \
  "SELECT CASE WHEN to_regnamespace('core') IS NULL THEN 'absent' ELSE 'present' END")
CORE_SUMMARY=absent
if [[ "$CORE_SCHEMA" == present ]]; then
  CORE_MIGRATIONS=$(docker exec "$CONTAINER" psql -U postgres -d unify -Atc \
    "SELECT string_agg(version::text,',' ORDER BY version) FROM core.schema_migrations")
  EXPECTED_CORE_MIGRATIONS=$(printf '%s\n' apps/core/migrations/[0-9][0-9][0-9]_*.sql |
    xargs -n1 basename |
    cut -d_ -f1 |
    sed -E 's/^0+//' |
    paste -sd, -)
  [[ "$CORE_MIGRATIONS" == "$EXPECTED_CORE_MIGRATIONS" ]] || {
    echo "Core migration lineage mismatch after restore: actual=$CORE_MIGRATIONS expected=$EXPECTED_CORE_MIGRATIONS" >&2
    exit 1
  }
  CORE_MIGRATION_COUNT=$(docker exec "$CONTAINER" psql -U postgres -d unify -Atc \
    'SELECT count(*) FROM core.schema_migrations')
  CORE_TABLES=$(docker exec "$CONTAINER" psql -U postgres -d unify -Atc \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='core'")
  CORE_AUDIT_FAILURES=$(docker exec "$CONTAINER" psql -U postgres -d unify -Atc \
    'SELECT count(*) FROM core.verify_audit_chain()')
  [[ "$CORE_AUDIT_FAILURES" == 0 ]] || { echo 'Core audit chain failed after restore' >&2; exit 1; }
  CORE_PROFILES=$(docker exec "$CONTAINER" psql -U postgres -d unify -Atc \
    'SELECT count(*) FROM core.agent_profile_projections')
  CORE_PROJECTION_DIGEST=$(docker exec "$CONTAINER" psql -U postgres -d unify -Atc \
    "SELECT encode(digest(string_agg(native_profile_alias||':'||safe_display_name||':'||source_version,'|' ORDER BY native_profile_alias),'sha256'),'hex') FROM core.agent_profile_projections")
  CORE_SUMMARY="tables=$CORE_TABLES migrations=$CORE_MIGRATION_COUNT profiles=$CORE_PROFILES projectionSha256=$CORE_PROJECTION_DIGEST"
fi
printf 'Restore rehearsal passed: public_tables=%s gateway_migrations=%s core=%s isolated_container=%s\n' \
  "$TABLE_COUNT" "$MIGRATION_COUNT" "$CORE_SUMMARY" "$CONTAINER"
printf 'Release manifest: %s\n' "$(tr '\n' ' ' < "$TMP/release.manifest")"
