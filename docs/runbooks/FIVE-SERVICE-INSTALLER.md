# Five-service installer, upgrade, and rollback

The Phase 14 installer is the only supported non-interactive orchestration entry point for the five-service topology. It does not modify the active ALICA-v1 deployment unless an operator supplies that installation's paths and explicitly selects migration mode. Phase 14.6 owns the production cutover.

## Input

Copy and edit `deploy/five-service/installation-inputs.example.json`. The input is strict and contains no secret values. Every image must use a repository digest:

```text
registry.example.com/unify/core@sha256:<64 lowercase hex characters>
```

Validate before installation:

```bash
node scripts/validate-five-service-installation.mjs /secure/path/installation.json
```

The installer rejects unknown fields, mutable images, invalid origins, overlapping paths, duplicate volumes, and unsafe path characters.

## Commands

Run from a checked-out or unpacked release:

```bash
sudo ./deploy/install.sh install \
  --root /opt/unify \
  --input /secure/path/installation.json

sudo /opt/unify/current/deploy/five-service/install.mjs verify \
  --root /opt/unify

sudo ./deploy/install.sh upgrade \
  --root /opt/unify \
  --input /secure/path/next-release.json

sudo /opt/unify/current/deploy/five-service/install.mjs rollback \
  --root /opt/unify
```

Use `--target <release-id>` to select a retained rollback release. Use `--project <name>` only at initial installation and preserve it thereafter.

`--migration-mode` is mandatory when adopting a non-empty, previously unmanaged root or intentionally changing installation identity, data paths, volumes, or origin. It does not delete, import, or infer legacy resources; the operator must provide the exact validated declaration.

## Preflight

Production mode requires:

- root execution on Ubuntu or Debian Linux;
- x86-64 or ARM64;
- at least 4 GiB RAM and 20 GiB free disk;
- Docker 24 or newer and Compose 2.20 or newer;
- `curl`, `getent`, `openssl`, `ss`, `systemctl`, and `tar`;
- NTP-synchronized time;
- resolvable public DNS;
- free ports 80 and 443 for a fresh non-migration installation.

A non-empty root without `installer-owned.json` or `installer-state.json` is rejected unless migration mode is explicit. A process lock serializes installer operations; a dead process lock is recoverable.

## Secret behavior

The installer creates only missing secrets using mode `0600`; the secrets directory uses `0700`. Files mounted into non-root containers are then made read-only (`0444`) inside that root-only traversable directory, while host-only private material remains `0600`. It never prints secret values. Existing secrets, framework token bundles, TLS keys, PostgreSQL passwords, authentication pepper, bootstrap password, and backup encryption key are preserved.

Related secrets are checked for consistency. Partial TLS material, mismatched token bundles, or database URLs inconsistent with preserved passwords cause a safe failure rather than replacement.

## Installation order

1. Validate host and declaration.
2. Claim or verify installer ownership.
3. Stage checksummed immutable release definitions.
4. Create directories and preserve/generate secrets.
5. pull and inspect digest-pinned images without deleting older images;
6. render and validate Compose;
7. create persistent volumes if absent;
8. start PostgreSQL;
9. run migrations, database-role reconciliation, and named-admin bootstrap as removable jobs;
10. start exactly five services;
11. reconcile both framework registrations;
12. verify container count, publication boundaries, registration convergence, HTTPS health, and unauthenticated rejection;
13. create and decrypt-test an encrypted backup;
14. write the checksummed installation manifest;
15. atomically move `current` and `rollback` links;
16. install the host `unify-backup.service` and `unify-backup.timer`.

No Docker socket is mounted and no sixth steady-state container is introduced.

## Idempotency

Running `install` again with the exact same release and declaration performs verification only. It does not rewrite state, secrets, release definitions, registrations, volumes, Caddy state, or backups.

Running `upgrade` with the current release is likewise a verification-only no-op.

## Upgrade failure recovery

Before changing an existing installation, the installer creates and validates an encrypted backup. `current` remains on the accepted release until all new-release gates pass. If startup or verification fails, it re-applies and verifies the previous release definitions. The failed release directory, previous images, rollback definitions, data, volumes, backups, and secrets are retained. A secret-safe failure record is written beneath `/opt/unify/failures`.

Forward migrations are not automatically reversed. Rollback starts the retained previous application definitions against the forward-compatible database schema; a migration requiring destructive reversal must be rejected during release engineering.

## Rollback

Rollback creates a pre-rollback backup, starts and verifies the retained target definitions, then atomically swaps `current` and `rollback`. It does not remove the release being left, images, volumes, data, Caddy state, backups, or secrets.

## Manifests

`/opt/unify/manifests/<release-id>.json` records:

- exact image references and inspected image IDs;
- checksums for installation input, resolved Compose, and release definitions;
- hashes—not values—of required secrets;
- previous release;
- verified backup path and checksum;
- installation timestamp and Compose project.

A sibling `.sha256` file protects each manifest. Release directories contain their own checksummed definition inventory and a copy of the installer, validation module, migrations, Compose files, registration declaration, and backup script.

## Acceptance

Repository acceptance uses an isolated filesystem and deterministic Docker simulator; it cannot be enabled accidentally because both `--acceptance` and `UNIFY_INSTALLER_ACCEPTANCE=1` are required.

```bash
pnpm five-service:installer:verify
```

It proves interrupted fresh-install resumption, exact no-op reinstall, verification, resistance to ambient deployment-variable overrides, failed-upgrade recovery, successful upgrade, explicit rollback, retained definitions/images/volumes, and unchanged secret checksums.

A production-equivalent Docker harness is available for release engineering hosts that already contain the three Phase 14 images:

```bash
node scripts/verify-five-service-installer-runtime.mjs
```

It uses an isolated root, Compose project, volumes, secrets, data paths, and dynamic ingress ports; exercises clean install, no-op reinstall, failed-upgrade recovery, upgrade, rollback, and real encrypted backups; and removes its fixture afterward. This runtime harness is evidence for release engineering and is not part of the ordinary static lint gate.
