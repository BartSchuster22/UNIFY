# Phase 14.6 Production Cutover and Obsolete-Topology Retirement Evidence

## Result

**PASS — 2026-08-06 UTC.**

ALICA-v1 production now runs one `unify` Compose project with exactly five healthy containers. Every required production gate passed before the obsolete topology was retired. Durable rollback assets remain retained.

## Accepted release

| Field | Value |
|---|---|
| Public origin | `https://unify.167-233-135-142.sslip.io` |
| Release | `phase-14.6-a14f6d73de73` |
| Source commit | `a14f6d73de739b509bff7021eccc4a0cccac76a0` |
| Installation root | `/opt/unify-five-service` |
| Compose project | `unify` |
| Production evidence | `/opt/unify/evidence/phase14-6-cutover-20260806` |
| Rollback baseline | `/opt/unify/rollback/phase14-current` |

The accepted public readiness response was:

```json
{"status":"ready","release":"phase-14.6-a14f6d73de73"}
```

## Pre-cutover gates

The controlled sequence preserved the required order:

1. inventory production and exact rollback inputs;
2. verify public health and run the correctly parameterized pre-cutover QA10;
3. freeze the previous topology and create a fresh application-consistent baseline;
4. verify encrypted PostgreSQL restore, framework snapshots, definitions, Caddy state, images, checksums, and rollback commands;
5. build and stage digest-pinned target images before stopping production;
6. preserve existing secrets and certificate identities;
7. begin the five-service cutover.

The fresh rollback baseline is:

```text
/opt/unify/rollback/phase14-baseline-20260806T134000Z
```

An earlier QA10 command omitted `UNIFY_PUBLIC_ORIGIN`; its failure was masked by `tee` because that invocation lacked `pipefail`. It is not counted as acceptance evidence. A corrected invocation with the required origin and secret-file inputs passed before cutover, and all later QA10 invocations used `pipefail` or checked the final `qa10_run=passed` marker.

## Production compatibility corrections

### Preserved adapter certificate identities

Preflight found that existing production leaf certificates use `alica-adapter` and `herman-adapter`, while the clean-host topology initially expected `alica` and `herman`. Replacing valid production credentials would violate secret preservation.

The release was corrected to:

- retain private network aliases `alica-adapter` and `herman-adapter`;
- use those TLS server names and declarative framework endpoints;
- generate matching identities on new installations;
- exercise those identities in static and live acceptance.

Full isolated five-service acceptance passed after this correction.

### Caddy health probe

The initial public-host Caddy health probe depended on public DNS hairpin behavior and timed out on production even though Caddy was serving correctly. The accepted probe validates the local TLS listener with BusyBox `nc` and keeps public HTTPS as a separate external smoke gate.

The correction was committed and pushed as:

```text
a14f6d73de739b509bff7021eccc4a0cccac76a0
fix: use local listener for caddy health
```

## Controlled failure recovery during cutover

Three pre-activation attempts stopped safely and automatically restored the original production topology:

1. a hardened helper container could not traverse the host Caddy state path;
2. the replacement tar stream omitted interactive stdin;
3. the target volume ownership prevented extraction from the rootless helper context.

A fourth staged activation exposed the public-host Caddy healthcheck issue. Before cleanup, container inspections and logs were retained under `failed-project/`; Core, PostgreSQL, Alica, and Herman were healthy, while only Caddy's health probe timed out. Automatic recovery removed the failed project, restarted the old containers and host Caddy, re-enabled backups, and returned public readiness/QA10 to PASS after every failed attempt.

Caddy state was then copied by host root directly between the archived host state and the named Docker volume, preserving content and assigning the target runtime UID/GID. No failed attempt deleted or restored a production data volume.

## Successful activation

Installer output:

```json
{"schemaVersion":"unify-installer-result/v1","mode":"install","releaseId":"phase-14.6-a14f6d73de73","changed":true,"project":"unify","status":"PASS"}
```

Idempotent verification output:

```json
{"schemaVersion":"unify-installer-result/v1","mode":"verify","releaseId":"phase-14.6-a14f6d73de73","changed":false,"project":"unify","status":"PASS"}
```

Existing-secret fingerprint verification reported:

```text
preserved_existing_secrets=29
```

## Final topology

```text
unify-caddy-1
unify-unify-core-1
unify-alica-1
unify-herman-1
unify-unify-postgres-1
```

Final assertions:

```text
running_containers=5
running_project=unify
legacy_container_records=0
legacy_networks=0
private_host_ports=closed
framework_shared_network=none
```

Only Caddy publishes host ports 80 and 443. Core, PostgreSQL, adapters, and native Hermes APIs have no host port publication. Alica and Herman share no Docker network.

## Functional and QA10 evidence

The production QA10 exercises:

- authentication;
- idempotent framework registration;
- framework health and identity;
- capabilities;
- profiles;
- providers/models;
- projects;
- boards;
- cronjobs;
- conversations/sessions;
- events;
- concurrency; and
- audit.

Ten consecutive full post-cutover runs passed:

```text
qa10_iteration=01 result=PASS
qa10_iteration=02 result=PASS
qa10_iteration=03 result=PASS
qa10_iteration=04 result=PASS
qa10_iteration=05 result=PASS
qa10_iteration=06 result=PASS
qa10_iteration=07 result=PASS
qa10_iteration=08 result=PASS
qa10_iteration=09 result=PASS
qa10_iteration=10 result=PASS
qa10_ten_consecutive=PASS
```

Additional complete runs passed after individual container restarts, after full-stack restart, after physical-host reboot, and after obsolete-topology retirement.

## Isolation and recovery evidence

### Independent container recovery

Each service restarted independently and returned healthy:

```text
service_restart=unify-postgres PASS
service_restart=alica PASS
service_restart=herman PASS
service_restart=unify-core PASS
service_restart=caddy PASS
full_stack_restart=PASS
```

### Framework failure isolation

Production failure-isolation probes passed in both directions:

```text
herman_peer_probe=PASS
alica_failure_isolated=PASS
alica_peer_probe=PASS
herman_failure_isolated=PASS
failure_isolation=PASS
```

Stopping Alica did not stop Herman, Core, PostgreSQL, or Caddy. The inverse also passed.

### Database isolation

The Alica and Herman adapter roles each observed zero rows for the opposite framework, and deliberate cross-framework inserts were denied by PostgreSQL row-level security:

```text
alica_cross_rows=0 cross_insert=DENIED
herman_cross_rows=0 cross_insert=DENIED
database_isolation=PASS
```

### Physical-host reboot

The kernel boot ID changed:

```text
boot_before=64929b62-a429-41aa-b01f-b9d0f6a9d4ac
boot_after=9d4d4fe6-aaae-4567-8064-e281127e13c8
physical_reboot=PASS
```

After reboot, Docker recovered exactly the five target containers without manual intervention; all were healthy, public readiness passed, host Caddy remained disabled, the encrypted-backup timer remained enabled/active, QA10 passed, installer verification passed, and the audit chain verified.

## Backup and isolated restoration

A fresh post-cutover backup was created by `unify-backup.service`:

```text
Result=success
ExecMainStatus=0
```

The latest encrypted backup checksum, migration checksum set, isolated PostgreSQL restore, and audit chain passed:

```text
Audit chain verified: 8 events
Restore rehearsal passed: tables=26 migrations=9
```

The production audit chain later verified with 20 events immediately after reboot and continued growing through subsequent QA10 acceptance runs.

## Obsolete-topology retirement

The user's instruction authorized retirement only after acceptance. Retirement began only after every gate above passed.

Removed:

- eleven obsolete stopped container records;
- all `alica-hermes_*` and `unify-alica-v1_*` networks;
- active-path legacy Compose and private-proxy Caddy definitions after checksummed archival;
- host Caddy activation; the unit is masked;
- the temporary host-local release-registry container record.

Retained:

- PostgreSQL and Caddy named volumes;
- Alica and Herman data directories;
- all secret files, including rollback-only proxy certificates;
- prior images and local registry storage;
- encrypted backups and framework snapshots;
- exact definitions, inspections, Caddy state, checksums, manifests, and rollback commands.

Retirement verification reported:

```text
retirement_acceptance_prerequisites=PASS
retired_obsolete_containers=11
running_containers=5
running_compose_projects=1
obsolete_topology_retirement=PASS
rollback_assets_retained=PASS
```

## Repository verification

Final repository verification passed:

```text
pnpm qa: exit 0
Five-service Compose static and security contract: PASS
All matched files use Prettier code style!
```

The final delivery commit records this production evidence and the updated as-built state. Production must be reverified against that pushed SHA before Phase 14.6 is considered administratively closed.
