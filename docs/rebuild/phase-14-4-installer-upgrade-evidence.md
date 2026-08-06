# Phase 14.4 Installer and Upgrade Evidence

**Status:** PASS
**Date:** 2026-08-06 UTC
**Production changed:** No

## Delivery

Phase 14.4 adds one non-interactive five-service deployment entry point:

```text
deploy/install.sh
deploy/five-service/install.mjs
```

The installer exposes explicit `install`, `verify`, `upgrade`, and `rollback` modes. It consumes the strict, non-secret `unify-five-service-installation/v1` declaration and refuses unknown fields, mutable image references, unsafe paths, duplicate volumes, invalid origins, and ambiguous unmanaged roots.

The operator procedure is documented in `docs/runbooks/FIVE-SERVICE-INSTALLER.md`.

## Host and deployment preflight

Production execution fails closed unless the host satisfies the declared support boundary:

- root on Ubuntu or Debian Linux;
- x86-64 or ARM64;
- at least 4 GiB RAM and 20 GiB free disk;
- Docker 24+ and Compose 2.20+;
- NTP-synchronized time;
- required `curl`, `getent`, `openssl`, `ss`, `systemctl`, and `tar` commands;
- resolvable public host;
- free host ports 80 and 443 for a fresh installation.

An ownership marker protects the managed root, and an exclusive process lock serializes installer operations. A non-empty unmanaged root, changed installation identity, or changed data/volume declaration requires explicit migration mode.

## Idempotent installation

A new release is first staged beneath an immutable release directory. Its Compose files, one-shot job definitions, migrations, framework declaration, backup script, validation module, installer, declaration, and rendered environment are covered by a checksummed definition inventory.

The installer then:

1. creates and validates persistent paths;
2. creates only missing secrets, applies container-readable files read-only beneath a root-only directory, and preserves existing values;
3. rejects partial TLS sets, inconsistent database URLs, and mismatched token bundles;
4. pulls and inspects digest-pinned images;
5. renders Compose with declaration values overriding ambient shell variables;
6. creates named volumes without replacing existing volumes;
7. starts PostgreSQL;
8. runs migrations, role reconciliation, and named-admin bootstrap as removable jobs;
9. starts exactly five steady-state services;
10. reconciles both framework registrations;
11. verifies container count, port boundaries, registration convergence, public health, and unauthenticated rejection;
12. creates and decrypt-tests an encrypted backup;
13. writes checksummed installation and operation manifests;
14. atomically updates `current` and `rollback` links;
15. installs the host backup service and timer.

An exact same-release reinstall and same-release upgrade perform verification only. They do not rewrite installer state, release definitions, secrets, volumes, or backups.

## Upgrade and rollback safety

Before changing an existing release, the installer creates and verifies an encrypted pre-upgrade backup. The accepted `current` link remains unchanged until every new-release gate passes.

If startup or verification fails, the installer reapplies and verifies the previous release. It retains failed and prior release definitions, image references, data, volumes, backups, and secrets, and records a secret-safe failure manifest.

Explicit rollback creates a pre-rollback backup, activates and verifies the retained target definitions without reversing forward-compatible migrations, and atomically swaps the current and rollback release links. Destructive reverse migration is intentionally unsupported and must be rejected during release engineering.

## Deterministic acceptance

```text
$ pnpm five-service:installer:verify
Phase 14.4 installer acceptance: PASS install=no-op upgrade=recovered rollback=verified secrets=21
```

The isolated deterministic harness proves:

- ambiguous unmanaged-root rejection;
- interrupted fresh-install resumption;
- clean installation;
- exact no-op reinstall with byte-identical state and secret checksums;
- verification mode;
- live-lock preservation and serialized installer rejection;
- accepted-manifest checksum tamper rejection;
- ambient deployment-variable override resistance;
- induced mid-upgrade failure and recovery to the accepted release;
- successful upgrade;
- explicit rollback;
- retention of release definitions, images, volumes, data, and credentials;
- no secret values in installer output.

## Real five-container acceptance

```text
$ node scripts/verify-five-service-installer-runtime.mjs
Phase 14.4 installer real-runtime acceptance: PASS project=unify-p144-3515103 containers=5 ports=33643,33227
```

The runtime harness used actual Phase 14 images and Docker Compose against an isolated root, project, data directories, secret set, volumes, and dynamic ingress ports. It exercised clean install, exact no-op reinstall, failed-upgrade recovery, successful upgrade, explicit rollback, encrypted backup verification, secret preservation, and exact five-container steady state. The fixture and its containers, networks, and volumes were removed afterward.

## Repository QA

```text
$ pnpm qa
PASS
```

The full repository gate passed lint, boundaries, static image and Compose policy, deterministic installer acceptance, TypeScript checking, all workspace tests and builds, contract reproducibility, standalone runtime checks, backup retention, identity capacity, canary self-test, and formatting.

## Scope boundary

The acceptance image mapping is guarded by both `--acceptance` and `UNIFY_INSTALLER_ACCEPTANCE=1`; production mode always pulls and inspects the digest-pinned declaration references. No Docker socket is mounted, no sixth steady-state container is introduced, and no production installation, service, database, secret, volume, backup schedule, or public endpoint was changed. Phase 14.6 remains responsible for controlled production cutover.
