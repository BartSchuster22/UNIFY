#!/usr/bin/env bash
set -euo pipefail
umask 077
ROOT=${UNIFY_ROOT:-/opt/unify}
BACKUPS="$ROOT/backups"
RECIPIENT=$(cat "$ROOT/secrets/backup-age-recipient")
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
TMP=$(mktemp "$BACKUPS/.unify-$STAMP.XXXXXX.dump")
trap 'rm -f "$TMP"' EXIT
mkdir -p "$BACKUPS"
docker exec unify-postgres pg_dump --format=custom --compress=9 --no-owner --no-acl --username=unify --dbname=unify > "$TMP"
test -s "$TMP"
age --recipient "$RECIPIENT" --output "$BACKUPS/unify-$STAMP.dump.age" "$TMP"
sha256sum "$BACKUPS/unify-$STAMP.dump.age" > "$BACKUPS/unify-$STAMP.dump.age.sha256"
find "$BACKUPS" -type f -name 'unify-*.dump.age*' -mtime +14 -delete
printf 'backup=%s encrypted=yes retention_days=14\n' "$BACKUPS/unify-$STAMP.dump.age"
