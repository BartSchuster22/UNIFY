# Gateway Backup and Restore

## Scope and retention

The backup contains only Gateway-owned PostgreSQL data and sanitized release metadata. It does not copy owner-service databases, private chat payload exports, Memory contents, or downstream credentials.

Keep encrypted artifacts outside the repository with restricted storage access. The local `backups/` directory and checksum files are ignored by Git. Apply the organization's retention policy to the encrypted file and its checksum together.

## Encryption key

`pnpm compose:secrets` creates `.secrets/backup_encryption_key` with mode `0600` if missing. Copy that key separately into the approved secret manager. A backup is unrecoverable without it; never place it beside an off-host backup or commit it.

Override its location with `BACKUP_ENCRYPTION_KEY_FILE`.

## Create and verify an encrypted backup

```bash
pnpm backup
sha256sum -c backups/gateway-<timestamp>.tar.enc.sha256
```

For deterministic rehearsal automation:

```bash
BACKUP_FILE=/secure/path/gateway-release.tar.enc pnpm backup
```

The script:

1. creates a PostgreSQL custom-format dump with no owner or ACL;
2. records UTC time, source revision, image IDs, deployment mode, migration checksums, and resolved Compose configuration;
3. archives in a temporary mode-`0700` directory;
4. encrypts with AES-256-CBC, PBKDF2, salt, and 200,000 iterations;
5. writes a SHA-256 checksum and mode-`0600` artifacts;
6. deletes plaintext temporary material on exit.

Do not treat successful backup creation as proof of recoverability.

## Isolated restore rehearsal

```bash
pnpm restore:rehearse /secure/path/gateway-release.tar.enc
```

The rehearsal verifies the encrypted checksum and current migration-source checksums, decrypts only into a temporary directory, starts a disposable PostgreSQL 16.6 container and volume, restores with `--exit-on-error`, verifies table and migration counts, and runs the Gateway audit-chain verifier against the isolated database.

The trap removes the disposable container, volume, and plaintext files on both success and failure. The live PostgreSQL container and volume are never attached or modified.

A passing rehearsal reports table count, migration count, isolated container name, audit verification, and the release manifest. Store only sanitized command results as evidence; do not store the dump or decrypted records in repository evidence.

## Disaster restore

1. Freeze Gateway writes or deploy read-only mode.
2. Confirm backup checksum and retrieve the encryption key independently.
3. Rehearse against an isolated database first.
4. Provision a clean PostgreSQL version matching the release manifest.
5. Restore with `pg_restore --exit-on-error --no-owner`.
6. Run migrations only from the recorded release.
7. Run `node dist/cli/verify-audit.js` against the restored database.
8. Start the recorded Gateway image in read-only mode.
9. Verify readiness, named authentication, cutover status, read surfaces, source health, and event reconciliation.
10. Record the recovery point/time and require explicit approval before re-enabling any mutation domain.

Never restore a rehearsal over the live volume and never delete the prior live volume until recovery acceptance is written.
