# Phase 14.5 Automated and Live Acceptance Evidence

**Status:** PASS

**Date:** 2026-08-06 UTC

**Production changed:** No

## Scope

Phase 14.5 executed repository-wide automated gates and production-equivalent Docker acceptance against isolated projects, data directories, secrets, named volumes, networks, and dynamic ingress ports. It did not attach to, stop, restart, migrate, or alter the production installation.

The final accepted implementation also closes gaps discovered by live testing:

- PostgreSQL row-level security fixes each adapter login to its declared framework for event, idempotency, and audit records.
- Adapter audit records are append-only, and broad update/delete privileges are revoked.
- Alica and Herman use separate internal PostgreSQL networks and share no Docker network.
- Hermes project-list parsing accepts the pinned runtime's valid single-space column separation.
- Governed work and conversation mutations route through the selected registered framework instead of a hard-coded framework identity.
- Encrypted backups include sanitized PostgreSQL role definitions without password verifiers, so policies can be restored into isolation before the database dump.
- Restore rehearsal uses the declared immutable Core image and explicit Node entrypoint.

## Automated repository gates

```text
$ pnpm qa
PASS
```

The complete QA gate passed:

- ESLint and source-of-truth/standalone boundary checks;
- production image, combined Hermes image, five-service Compose, installation-declaration, and deterministic installer policy;
- every workspace TypeScript typecheck;
- every workspace unit/integration test;
- every workspace build;
- generated-contract reproducibility;
- backup-retention, identity-capacity, and production-canary self-tests;
- repository-wide Prettier verification.

Focused results on the changed runtime surfaces were:

```text
Gateway: 11 test files, 65 tests passed
Hermes control adapter: 3 test files, 19 tests passed
Five-service Compose static and security contract: PASS
No known vulnerabilities found
CycloneDX SBOM generated: 129 production components
Production image definitions and Compose hardening verified
Hermes combined image static contract: PASS
```

Migration tests verify all three adapter persistence tables receive row-level security policies and that the adapter audit table is immutable. Mutation tests verify selected-framework conversation routing. Adapter tests include the pinned Hermes project's long-name output format.

## Combined framework runtime

```text
$ node scripts/verify-hermes-combined-runtime.mjs
Hermes combined runtime container acceptance: PASS
```

This exercised the real combined Hermes-plus-adapter image, authenticated control contract, CLI-backed operations, loopback native API, supervision, and container hardening.

## Five-service live acceptance

```text
$ node scripts/verify-five-service-runtime.mjs
Phase 14.5 five-service live acceptance: PASS project=unify-phase143-3706459-1786021654260 containers=5 ports=46665,37611
```

The clean-fixture suite verified:

- one Compose project with exactly five healthy steady-state containers and no retained one-shot jobs;
- public HTTPS readiness and HSTS on dynamic isolated ports;
- invalid/valid authentication, session lookup, CSRF rejection/enforcement, logout, and revoked-session rejection;
- both declarative framework registrations and their accepted provenance;
- real CLI-backed work creation in Alica and Herman;
- exact sequential replay and eight-way concurrent idempotency convergence;
- governed conversation creation and message execution through each framework;
- no cross-framework work or conversation projection leakage;
- per-framework PostgreSQL visibility, cross-framework write rejection, and immutable audit rows;
- wrong control token rejection and wrong TLS server identity rejection;
- native API loopback privacy and cross-framework adapter network isolation;
- valid Core audit chain;
- encrypted database backup, checksum/decryption verification, restored PostgreSQL roles, isolated database restoration, matching migrations/tables, and restored audit verification;
- overlapping and cutover control-token rotation with fail-closed behavior and Core recovery;
- supervised Hermes gateway and control-adapter child-process recovery in both framework containers;
- independent restart and healthy recovery of each of the five containers;
- complete project stop/start and two repeated all-service restart loops;
- Caddy certificate-state preservation across restarts;
- persistence of projects, conversations, framework registration state, database role password verifiers, and reconciliation convergence;
- only Caddy host ports published; Core, PostgreSQL, native Hermes API, and control-adapter ports remained private.

The final suite removed its containers, networks, volumes, data fixture, secrets, and backup fixture after PASS.

## Installer regression acceptance

```text
$ pnpm five-service:installer:verify
Phase 14.4 installer acceptance: PASS install=no-op upgrade=recovered rollback=verified secrets=21

$ node scripts/verify-five-service-installer-runtime.mjs
Phase 14.4 installer real-runtime acceptance: PASS project=unify-p144-3744782 containers=5 ports=33049,35303
```

The final Phase 14.5 tree therefore preserves installer behavior across clean installation, exact no-op reinstall, failed-upgrade recovery, successful upgrade, rollback, encrypted backup verification, retained data/artifacts/secrets, and five-container verification.

## Security and delivery boundary

Dependency audit reported no known production vulnerabilities at the configured high-severity gate. Static and live checks reject Docker socket access, privileged containers, mutable image references, excess public ports, cross-framework network reachability, cross-framework database access, invalid TLS identity, invalid control credentials, and secret disclosure.

All acceptance resources used unique test-only names. Cleanup targeted only those isolated names. Production containers, databases, volumes, secrets, backups, public ports, and service definitions were not changed. Physical host reboot and production QA10 remain Phase 14.6 cutover gates; Phase 14.5 proves the clean-host five-container suite and repository QA exit gate.
