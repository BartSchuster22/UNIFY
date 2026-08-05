#!/usr/bin/env bash
set -euo pipefail
umask 077
ROOT=${UNIFY_ROOT:-/opt/unify}
ARCHIVE=${1:-$(find "$ROOT/backups" -type f -name 'unify-*.dump.age' -printf '%T@ %p\n' | sort -nr | sed -n '1s/^[^ ]* //p')}
test -n "$ARCHIVE" && test -s "$ARCHIVE"
sha256sum --check "$ARCHIVE.sha256"
TMP=$(mktemp)
DB="unify_restore_test_$(date +%s)"
cleanup() { rm -f "$TMP"; docker exec unify-postgres dropdb --if-exists --force --username=unify "$DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT
age --decrypt --identity "$ROOT/secrets/backup-age.key" --output "$TMP" "$ARCHIVE"
docker exec unify-postgres createdb --username=unify "$DB"
docker exec -i unify-postgres pg_restore --exit-on-error --no-owner --no-acl --username=unify --dbname="$DB" < "$TMP"
source_tables=$(docker exec unify-postgres psql -XAt --username=unify --dbname=unify -c "select count(*) from pg_catalog.pg_tables where schemaname not in ('pg_catalog','information_schema')")
restored_tables=$(docker exec unify-postgres psql -XAt --username=unify --dbname="$DB" -c "select count(*) from pg_catalog.pg_tables where schemaname not in ('pg_catalog','information_schema')")
source_migrations=$(docker exec unify-postgres psql -XAt --username=unify --dbname=unify -c "select count(*) from schema_migrations")
restored_migrations=$(docker exec unify-postgres psql -XAt --username=unify --dbname="$DB" -c "select count(*) from schema_migrations")
test "$source_tables" = "$restored_tables"
test "$source_migrations" = "$restored_migrations"
printf 'restore_test=passed tables=%s migrations=%s archive=%s\n' "$restored_tables" "$restored_migrations" "$ARCHIVE"
