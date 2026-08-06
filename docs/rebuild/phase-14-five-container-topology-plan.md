# Phase 14 — Five-Container Single-Instance Rebuild Plan

## Status

**Plan only.** This document does not authorize or perform a production cutover.

## Objective

Rebuild the ALICA-v1 installation as one automated Docker Compose stack with exactly five steady-state containers:

1. `alica`
2. `herman`
3. `unify-core`
4. `unify-postgres`
5. `caddy`

The rebuild must preserve the accepted standalone UNIFY behavior, the immutable Hermes source-of-truth boundary, existing Alica and Herman data, authentication, authorization, isolation, idempotency, audit evidence, backups, restart recovery, host-reboot recovery, and public HTTPS behavior.

## Fixed deployment constraint

UNIFY Core and every managed Hermes framework runtime are always deployed on the same server instance and in the same Compose project. Multi-host framework transport is outside this phase.

## Non-goals

- Do not merge Alica and Herman into one runtime or data directory.
- Do not patch the pinned upstream Hermes source.
- Do not give UNIFY Core access to the Docker socket.
- Do not mount Alica or Herman data into UNIFY Core.
- Do not reintroduce Worker, `/CHAT`, Agency, DMM, or another retired owner.
- Do not replace PostgreSQL or change the public UNIFY API contract.
- Do not remove Caddy in this phase.
- Do not destroy existing volumes, bind-mounted data, backups, secrets, or retirement evidence during cutover.

## Current topology

The production host currently uses two Compose projects plus a host Caddy service:

```text
alica-hermes project
├── alica
└── herman

unify-alica-v1 project
├── unify-core
├── unify-postgres
├── unify-alica-adapter
├── unify-herman-adapter
├── unify-alica-api
└── unify-herman-api

host systemd
└── caddy
```

The two adapter containers run the UNIFY-owned `hermes-control/v1` adapter in a Hermes runtime image and execute the local Hermes CLI against the matching framework data directory. The two private Caddy containers terminate TLS between each adapter and the corresponding native Hermes API.

## Target topology

```text
                         Internet
                            │
                     TCP 80 / TCP 443
                            │
                      ┌─────▼─────┐
                      │   caddy   │
                      └─────┬─────┘
                            │ HTTP on private ingress network
                      ┌─────▼─────┐
                      │unify-core │
                      └──┬─────┬──┘
          private TLS    │     │    private TLS
                ┌────────┘     └────────┐
          ┌─────▼─────┐           ┌─────▼─────┐
          │   alica   │           │  herman   │
          │ Hermes    │           │ Hermes    │
          │ API       │           │ API       │
          │ adapter   │           │ adapter   │
          └─────┬─────┘           └─────┬─────┘
                │ Alica-only DB         │ Herman-only DB
                │ network               │ network
                └──────────┐        ┌───┘
                    ┌──────▼────────▼─┐
                    │ unify-postgres  │
                    └─────────────────┘
```

Only Caddy publishes host ports. No framework, adapter, Core, or PostgreSQL port is published to the host.

## Architecture decisions

### 1. Keep the adapter contract, remove the adapter containers

The adapter behavior remains required because the pinned Hermes runtime does not natively expose the complete `hermes-control/v1` contract. The current adapter also executes the Hermes CLI and therefore needs the matching Hermes binary and `HERMES_HOME` data.

The adapter must **not** be moved into `unify-core`, because that would require one or more unacceptable designs:

- mounting both framework data directories into Core;
- installing and executing both framework runtimes from Core; or
- granting Core access to the Docker socket so it can use `docker exec`.

Instead, each framework container will run two supervised application processes:

```text
alica container
├── Hermes gateway/API
└── UNIFY Hermes control adapter for Alica

herman container
├── Hermes gateway/API
└── UNIFY Hermes control adapter for Herman
```

This preserves per-framework process, filesystem, credential, restart, and resource boundaries while removing two containers.

### 2. Remove both private API proxy containers

Inside each framework container, the adapter will call its matching native Hermes API through loopback:

```text
http://127.0.0.1:8642
```

The native API must bind only to loopback. Its bearer token remains mandatory and comes from a mounted secret file. It is never exposed on a Docker network or host port.

The control adapter continues to expose authenticated TLS to UNIFY Core on the framework's private Docker network:

```text
https://alica:28082
https://herman:28082
```

This leaves one encrypted and authenticated inter-container hop and removes the redundant adapter-to-private-Caddy-to-local-Hermes hop.

### 3. Preserve immutable Hermes

Create a UNIFY-owned derived image from the pinned Hermes digest. The image may add:

- built UNIFY adapter artifacts;
- s6 service definitions;
- secret initialization hooks;
- health checks; and
- UNIFY-owned configuration.

It must not patch upstream Hermes source or alter the pinned release/commit verification. The adapter must continue failing closed if the runtime release or commit differs from the supported baseline.

### 4. Use one Compose project

Replace the current external-network coupling and two Compose projects with one production file and one project name, for example:

```text
unify
```

The final steady-state check must report one Compose project and five running containers.

### 5. Preserve logical framework isolation

Co-location does not remove isolation requirements. Alica and Herman retain independent:

- framework IDs and instance IDs;
- data directories or volumes;
- native API bearer tokens;
- control-plane bearer token bundles;
- adapter TLS private keys and certificates;
- database credentials or framework-scoped database authorization;
- control networks;
- resource limits;
- health state and circuit state;
- provenance and audit records.

Alica must never mount Herman data or secrets, and Herman must never mount Alica data or secrets.

## Target container responsibilities

| Container | Processes | Persistent data | Network access |
|---|---|---|---|
| `alica` | Hermes gateway/API and Alica control adapter | Existing Alica Hermes data | Alica control network and Alica-only database network |
| `herman` | Hermes gateway/API and Herman control adapter | Existing Herman Hermes data | Herman control network and Herman-only database network |
| `unify-core` | Current production UNIFY Core/Gateway runtime | None outside PostgreSQL | Ingress, database, Alica control, and Herman control networks |
| `unify-postgres` | PostgreSQL 16.6 pinned image | Existing UNIFY database volume | Core, Alica, and Herman private database networks |
| `caddy` | Public HTTPS ingress | Caddy certificate state and access logs | Published 80/443 and private ingress network |

## Target network design

| Network | Members | Internal | Purpose |
|---|---|---:|---|
| `unify-ingress` | `caddy`, `unify-core` | Yes | Caddy-to-Core HTTP only |
| `unify-db-private` | `unify-core`, `unify-postgres` | Yes | Core PostgreSQL access; no published database port |
| `alica-db-private` | `alica`, `unify-postgres` | Yes | Alica adapter PostgreSQL access with no Herman member |
| `herman-db-private` | `herman`, `unify-postgres` | Yes | Herman adapter PostgreSQL access with no Alica member |
| `alica-control-private` | `unify-core`, `alica` | Yes | Core-to-Alica adapter TLS only |
| `herman-control-private` | `unify-core`, `herman` | Yes | Core-to-Herman adapter TLS only |
| `alica-egress` | `alica` | No | Alica-only outbound provider/platform access; no other application member |
| `herman-egress` | `herman` | No | Herman-only outbound provider/platform access; no other application member |
| `caddy-egress` | `caddy` | No | ACME and certificate-maintenance egress; no other application member |

The three single-member egress networks preserve required provider/platform and ACME access without placing Alica, Herman, or Caddy on a shared lateral network. Caddy reaches Core only through the dedicated internal ingress network.

## Port and endpoint rules

| Endpoint | Bind/exposure |
|---|---|
| Caddy HTTP | Host `0.0.0.0:80` and `[::]:80` |
| Caddy HTTPS | Host `0.0.0.0:443` and `[::]:443` |
| UNIFY Core | Container network only, `unify-core:8080` |
| Alica adapter | `alica-control-private`, `alica:28082`, TLS |
| Herman adapter | `herman-control-private`, `herman:28082`, TLS |
| Alica native Hermes API | Loopback only, `127.0.0.1:8642` |
| Herman native Hermes API | Loopback only, `127.0.0.1:8642` |
| PostgreSQL | Three separate private database networks, `unify-postgres:5432` |

Externally reachable ports after cutover must remain limited to 80 and 443.

## Image design

### Combined framework image

Add a production image such as `Dockerfile.hermes-framework`:

1. Build `@aquiero/contracts` and `@aquiero/hermes-control-adapter` in a pinned Node builder.
2. Start from the pinned `nousresearch/hermes-agent` runtime digest.
3. Copy only production adapter artifacts and dependencies.
4. Add s6 definitions for:
   - secret initialization;
   - Hermes gateway/API;
   - UNIFY control adapter.
5. Run both application processes as the existing non-root Hermes runtime user where supported.
6. Keep the root filesystem read-only and provide only explicit writable mounts/tmpfs paths.
7. Drop capabilities and enforce `no-new-privileges`.
8. Do not include deployment secrets in image layers.

The same immutable image is used for Alica and Herman. Runtime identity, paths, tokens, certificates, and resource limits come from per-service configuration.

### Combined health behavior

A framework container is healthy only when all of the following pass:

- the Hermes gateway process is running;
- the native Hermes API answers on loopback with its credential;
- the adapter process is running;
- the adapter can access PostgreSQL event/idempotency/audit tables;
- the authenticated adapter health contract reports the expected framework ID, Hermes release, and commit.

A failed child process must make the container unhealthy and cause s6 or Docker restart behavior to recover it. Silent partial health is not accepted.

### Core image

Keep the current `unify-core` production behavior. Do not merge the Hermes runtime, Hermes CLI, framework data, or Docker control into Core. Update only endpoint/bootstrap configuration required for the new service names.

### Caddy image

Use a pinned Caddy image with:

- public 80/443 bindings;
- a persistent `/data` volume for ACME state;
- writable `/config` and log locations without making the full root filesystem writable;
- a private upstream of `http://unify-core:8080`;
- existing HSTS and security headers;
- no Docker socket and no dynamic container discovery plugin.

## Secret model

Retain:

- PostgreSQL password and database URLs;
- authentication pepper;
- bootstrap administrator password until bootstrap is complete;
- Alica and Herman control token bundles;
- Alica and Herman native API tokens;
- framework CA certificate;
- one adapter TLS key/certificate pair per framework;
- backup age identity and recipient.

Remove after successful cutover and rollback-window expiry:

- `alica-api.key` and `alica-api.crt` used only by `unify-alica-api`;
- `herman-api.key` and `herman-api.crt` used only by `unify-herman-api`;
- obsolete private-proxy configuration.

Do not remove obsolete secrets before rollback is no longer required. Secret generation remains fail-closed and must not replace existing values during reinstall or upgrade.

## Database access

The first five-container release should preserve the current durable adapter event, idempotency, and audit tables to avoid a simultaneous behavior and persistence rewrite.

Improve least privilege as part of the rebuild:

- create a framework-adapter database role with access only to required adapter tables and sequences;
- use separate credentials for Core and adapters;
- ensure neither framework receives PostgreSQL superuser or schema-owner credentials;
- retain framework ID predicates and database constraints for cross-framework isolation;
- verify Alica cannot read or mutate Herman-scoped adapter records and vice versa.

If per-framework database credentials are introduced, create distinct Alica and Herman roles rather than sharing one adapter password.

## Declarative framework registration

Replace the manual post-start registration dependency with idempotent reconciliation driven by deployment configuration.

Desired registrations:

```text
hermes-alica  -> https://alica:28082
hermes-herman -> https://herman:28082
```

Requirements:

- preserve existing canonical framework IDs and instance IDs;
- update endpoints through the authenticated registry service, never direct ad hoc SQL;
- probe identity, version, capabilities, TLS trust, and credential correctness before marking a registration verified;
- fail closed on identity, commit, release, endpoint, or credential drift;
- make repeated startup reconciliation a no-op when configuration matches;
- do not delay Core readiness forever if one framework is temporarily unhealthy; expose accurate degraded readiness and framework status according to the accepted health contract.

For low-risk transition, the combined containers may temporarily carry the old Docker DNS aliases `alica-adapter` and `herman-adapter`. Certificates may include old and new DNS SANs during the rollback window. The final accepted registration endpoints must use `alica` and `herman`.

## Automated installation behavior

Provide one non-interactive installer entry point, for example:

```bash
sudo ./deploy/install.sh \
  --root /opt/unify \
  --origin https://unify.example.com \
  --release <immutable-release-id>
```

The installer must:

1. Validate supported OS, CPU architecture, RAM, disk, Docker/Compose version, ports 80/443, DNS/origin, time synchronization, and required commands.
2. Refuse to operate on an ambiguous or partially managed installation without an explicit migration mode.
3. Create required directories, ownership, modes, networks, and persistent volumes.
4. Generate missing secrets without printing values and preserve every existing secret.
5. Build, pull, or load images pinned to the requested release and verify image digests/SBOM policy.
6. Render and validate the final Compose configuration without leaking secrets.
7. Run migrations and administrator bootstrap as ephemeral `--rm` jobs so no extra container records remain.
8. Start the five services in dependency order.
9. Reconcile and verify Alica and Herman registrations.
10. Install or configure encrypted backup scheduling without creating another container.
11. Run health, public exposure, authentication, framework inventory, backup, and restoration smoke gates.
12. Record a checksummed installation manifest and exact image digests.
13. Return nonzero with a precise safe error if any gate fails.

Re-running the installer with the same release and configuration must be idempotent. It must preserve secrets, data, registrations, Caddy state, and backups.

## Compose requirements

The production Compose file must:

- define exactly the five steady-state services;
- use explicit pinned image digests or immutable release tags resolved in the installation manifest;
- include health-based `depends_on` only where it reflects real readiness;
- use `restart: unless-stopped` or an explicitly documented equivalent;
- use read-only root filesystems where supported;
- drop all Linux capabilities unless a documented capability is required;
- set `no-new-privileges:true`;
- set CPU, memory, PID, tmpfs, and log rotation limits;
- publish only Caddy ports 80/443;
- contain no Docker socket mount;
- contain no external network dependency on the previous `alica-hermes` project;
- use existing Alica, Herman, and PostgreSQL data without copying them into image layers;
- ensure ephemeral migration/bootstrap jobs are removed after execution.

## Work packages

### Phase 14.0 — Freeze baseline and produce rollback assets

**Status: PASS (2026-08-06 UTC).** See [Phase 14.0 baseline evidence](phase-14-0-baseline-evidence.md).

- Record current repository commit, image IDs/digests, Compose configurations, container inspections, networks, volumes, bind mounts, secret checksums, systemd units, and public DNS/TLS state.
- Run the existing production QA10 once and require PASS before changing architecture.
- Create and verify a fresh encrypted PostgreSQL backup.
- Create checksummed Alica and Herman data snapshots while using an application-consistent stop/freeze procedure.
- Archive the existing Compose files, private Caddy files, host Caddy configuration, and service units.

**Exit gate:** baseline QA10 passes and every rollback artifact has been restored or checksum-tested.

### Phase 14.1 — Build the combined framework runtime

**Status: PASS (2026-08-06 UTC).** See [Phase 14.1 combined runtime evidence](phase-14-1-combined-runtime-evidence.md).

- Create the derived pinned Hermes+adapter image.
- Add s6 services for the Hermes gateway and adapter.
- Bind the native Hermes API to loopback only.
- Configure the adapter to use `http://127.0.0.1:8642` with the native API token.
- Serve `hermes-control/v1` over adapter-native TLS on port 28082.
- Preserve immutable Hermes baseline verification.
- Add combined process and dependency health checks.

**Exit gate:** one test container exposes the complete authenticated control contract, performs real CLI-backed reads/writes against isolated fixture data, reads conversation data through loopback, and becomes unhealthy when either child process fails.

### Phase 14.2 — Build the five-service Compose stack

**Status: PASS (2026-08-06 UTC).** See [Phase 14.2 five-service Compose evidence](phase-14-2-five-service-compose-evidence.md).

- Define exactly five long-running services.
- Add target networks, secrets, volumes, limits, hardening, and health checks.
- Containerize the existing public Caddy behavior and persist ACME state.
- Remove private proxy services and external framework-network dependencies.
- Keep migration/bootstrap execution ephemeral and removable.

**Exit gate:** `docker compose config` validates, security assertions pass, and a clean test host reaches steady state with exactly five running containers.

### Phase 14.3 — Make configuration and registration declarative

**Status: PASS (2026-08-06 UTC).** See [Phase 14.3 declarative configuration evidence](phase-14-3-declarative-configuration-evidence.md).

- Replace hardcoded ALICA-v1 paths and post-install assumptions with validated installation inputs.
- Add idempotent framework registration reconciliation for the two local service endpoints.
- Preserve framework identity, credential, provenance, circuit, and audit behavior.
- Add least-privilege database roles for framework adapters.
- Update backup scripts and QA scripts for service-name and topology changes.

**Exit gate:** fresh install, same-version reinstall, and restart all converge without duplicate registration, secret replacement, or data mutation outside expected evidence.

### Phase 14.4 — Build the installer and upgrade path

**Status: PASS (2026-08-06 UTC).** See [Phase 14.4 installer and upgrade evidence](phase-14-4-installer-upgrade-evidence.md).

- Implement preflight, secret preparation, Compose rendering, image verification, migration, startup, registration, backup setup, smoke testing, and manifest output.
- Add `install`, `verify`, `upgrade`, and `rollback` modes or equivalent explicit commands.
- Ensure a failed upgrade does not delete the previous images or rollback definitions.

**Exit gate:** an empty supported VPS can be installed non-interactively, a second identical run is a no-op, and an induced mid-install failure recovers safely.

### Phase 14.5 — Automated and live acceptance

**Status: PASS (2026-08-06 UTC).** See [Phase 14.5 automated and live acceptance evidence](phase-14-5-automated-live-acceptance-evidence.md).

Run unit, integration, Compose, security, and production-equivalent tests covering:

- both supervised processes in each framework container;
- framework CLI reads and mutations;
- native conversation API reads through loopback;
- token rejection and rotation;
- TLS identity and CA validation;
- framework provenance;
- database isolation;
- idempotency and concurrent commands;
- audit immutability and secret scanning;
- child-process crash recovery;
- full-container restart recovery;
- Caddy certificate persistence;
- encrypted backup and isolated restoration;
- external port exposure.

**Exit gate:** repository QA and a clean-host five-container acceptance suite pass.

### Phase 14.6 — Controlled ALICA-v1 cutover

1. Announce a bounded maintenance window and stop new mutations.
2. Run pre-cutover QA10 and require PASS.
3. Create and verify fresh database and framework-data backups.
4. Build/pull and verify all target images before stopping production.
5. Stop the current UNIFY and framework Compose projects and host Caddy without deleting volumes, data, networks, images, or secrets.
6. Start the new PostgreSQL against the existing UNIFY volume and run forward migrations, if any.
7. Start combined Alica and Herman against their existing data directories.
8. Start Core and reconcile registrations to the new endpoints.
9. Start containerized Caddy using preserved/imported ACME state where compatible.
10. Verify HTTPS, authentication, framework inventory, mutations, conversations, events, backups, and audit.
11. Run ten consecutive production QA10 passes.
12. Restart each container independently and rerun acceptance.
13. Reboot the host and rerun acceptance.
14. Create and restore a fresh post-cutover encrypted backup.
15. Keep all old definitions, images, networks, and proxy secrets through the rollback window.

**Exit gate:** every production gate passes and the user explicitly accepts retirement of obsolete deployment artifacts.

### Phase 14.7 — Retire obsolete topology

Only after Phase 14.6 passes:

- remove obsolete stopped adapter and private-proxy container records;
- remove the old `alica-hermes` and `unify-alica-v1` Compose project definitions from active deployment paths;
- remove unused external networks;
- disable and remove host Caddy only after containerized Caddy is proven across reboot;
- remove obsolete private API proxy certificates only after rollback expiry;
- retain checksummed cutover evidence and backups according to retention policy;
- update architecture, deployment, backup, restore, and incident runbooks.

**Exit gate:** one Compose project, exactly five running containers, no legacy runtime dependency, clean repository, pushed release, and verified production state.

## Required test and acceptance matrix

| Gate | Required evidence |
|---|---|
| Container count | Exactly five running production containers; no stale one-shot containers; one Compose project |
| Functional parity | Health, capabilities, profiles, providers/models, projects, boards/tasks, cronjobs, conversations/messages, events, and governed mutations work for Alica and Herman |
| Framework isolation | Separate data, secrets, networks, identities, provenance, and database scopes; deliberate cross-framework access fails |
| Authentication | Invalid login rejection, valid login, session verification, logout, and revoked-session rejection |
| Authorization/CSRF | Unauthenticated access rejected; scoped authorization and CSRF enforced |
| Idempotency | Exact replay succeeds; conflicting replay fails; evidence survives restart |
| Concurrency | Parallel reads and writes preserve truthful state and database constraints |
| Auditing | Immutable audit chain remains valid and contains no secret value |
| Native API privacy | Port 8642 reachable only inside the matching container loopback namespace |
| Adapter privacy | Port 28082 reachable only from Core on the matching private network |
| Database privacy | Port 5432 is unpublished and framework roles are least privilege |
| Failure isolation | Stopping Alica does not stop Herman, Core, PostgreSQL, or Caddy; inverse test also passes |
| Child recovery | Killing Hermes or adapter child process causes truthful unhealthy state and supervised recovery |
| Container recovery | Restart each of five containers independently and pass acceptance afterward |
| Host recovery | Reboot host; all five containers recover without manual intervention |
| Caddy persistence | Trusted HTTPS certificate and HSTS survive container and host restart |
| Backup/restore | Fresh encrypted database backup restores into isolation with matching tables/migrations; framework data snapshots are verifiable |
| Public exposure | Only 80/443 publicly reachable; 5432, 8080, 8642, 18080, 28082, and Caddy admin port remain closed |
| Security hardening | No Docker socket, no privileged container, required capability drops, read-only roots, non-root execution where supported, pinned images |
| QA10 | Ten consecutive complete production runs pass after cutover, then pass after container restarts and host reboot |

## Rollback plan

Rollback remains available until explicit retirement approval.

Trigger rollback on any failed correctness, security, isolation, recovery, restoration, or exposure gate.

1. Stop the five-container project without deleting volumes.
2. Restore the prior framework registration endpoints if they were changed.
3. Start the archived `alica-hermes` and `unify-alica-v1` projects with their exact prior image digests and configurations.
4. Restart host Caddy with the archived configuration and certificate state.
5. If a forward database migration is incompatible, restore the verified pre-cutover encrypted database backup; never attempt an unsupported down migration.
6. If framework data changed incompatibly, restore the application-consistent Alica and Herman snapshots.
7. Run the prior production QA10 and keep the new topology stopped for investigation.

Rollback tests must be rehearsed on a non-production copy before production cutover.

## Key risks and controls

| Risk | Control |
|---|---|
| One framework container now has two processes | s6 supervision, combined health, child-kill tests, truthful unhealthy state |
| Adapter starts before native API | explicit readiness dependency with bounded retry and fail-closed startup |
| Core reaches the wrong framework | separate networks, credentials, TLS SANs, IDs, instance IDs, and provenance checks |
| Native API accidentally exposed | loopback bind plus namespace-level network tests and external/internal port probes |
| Core gains excessive framework access | keep CLI and data in framework containers; prohibit Docker socket and framework-data mounts in Core |
| Framework gets excessive database access | dedicated least-privilege roles and cross-framework SQL isolation tests |
| Caddy ACME state is lost | persistent volume, pre-cutover archive, restart/reboot test |
| Existing registrations drift | authenticated idempotent reconciliation and temporary DNS aliases during transition |
| Installer rotates secrets on rerun | create-if-absent semantics and checksum assertions |
| Cutover damages data | mutation freeze, verified backups/snapshots, no volume deletion, rehearsed rollback |

## Definition of done

Phase 14 is complete only when all statements are true:

- Production has exactly the five requested running containers.
- Alica and Herman each run Hermes plus their own UNIFY control adapter in one supervised container.
- The private Alica and Herman Caddy proxy containers no longer exist.
- Public Caddy runs as the fifth container and is the only public boundary.
- The installation is one declarative Compose project with an idempotent automated installer.
- Core has no Docker socket, Hermes binary, or framework data mount.
- Hermes remains pinned and unmodified.
- Existing Alica, Herman, and UNIFY data and identities are preserved.
- Full functional, security, isolation, idempotency, concurrency, audit, restart, reboot, backup/restore, and exposure gates pass.
- Ten consecutive production QA10 runs pass.
- Rollback is rehearsed before obsolete artifacts are retired.
- Documentation, release manifest, image digests, SBOMs, and checksummed evidence are committed and pushed.
- The repository is clean and production is verified at the pushed release.
