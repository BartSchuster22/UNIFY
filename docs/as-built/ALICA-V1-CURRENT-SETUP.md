# ALICA-v1 Current Production Setup — Five-Service As Built

## Status

**Production as built and accepted on 2026-08-06 UTC.**

This document supersedes the pre-cutover snapshot for current operations. The complete historical topology remains in [ALICA-V1-PRE-PHASE14-SNAPSHOT.md](ALICA-V1-PRE-PHASE14-SNAPSHOT.md), the encrypted/checksummed production rollback set, and the Phase 14 evidence chain.

Secret values, private keys, passwords, connection strings, session material, and bearer tokens are intentionally excluded.

## Executive summary

| Attribute | Current production value |
|---|---|
| Host | `ALICA-v1` (`167.233.135.142`) |
| Public origin | `https://unify.167-233-135-142.sslip.io` |
| Release | `phase-14.6-a14f6d73de73` |
| Source commit | `a14f6d73de739b509bff7021eccc4a0cccac76a0` |
| Compose project | `unify` |
| Steady-state containers | Exactly five |
| Public ingress | Containerized Caddy |
| Public application ports | TCP 80/443; no private service publishes a host port |
| Database persistence | Existing volume `unify-postgres-data-v1` |
| Framework persistence | Existing bind mounts under `/srv/alica-stack/data` |
| Installation root | `/opt/unify-five-service` |
| Secrets and backups | `/opt/unify/secrets`, `/opt/unify/backups` |
| Backup schedule | `unify-backup.timer`, enabled and active |
| Host Caddy | Retired and masked |
| Obsolete container records/networks | Removed after acceptance |
| Rollback assets | Retained under `/opt/unify/rollback/phase14-current` |

Public readiness returns the active release:

```json
{"status":"ready","release":"phase-14.6-a14f6d73de73"}
```

## Runtime topology

```text
Internet
   │ TCP 80/443
   ▼
unify-caddy-1
   │ HTTP on unify_unify-ingress
   ▼
unify-unify-core-1
   ├── private TLS on unify_alica-control-private
   │      ▼
   │   unify-alica-1
   │      ├── Hermes gateway/API on loopback :8642
   │      └── UNIFY control adapter on :28082
   │
   ├── private TLS on unify_herman-control-private
   │      ▼
   │   unify-herman-1
   │      ├── Hermes gateway/API on loopback :8642
   │      └── UNIFY control adapter on :28082
   │
   └── PostgreSQL on unify_unify-db-private
          ▼
       unify-unify-postgres-1
```

Alica and Herman have separate control, database, and egress networks. They share no lateral Docker network. PostgreSQL joins separate Core, Alica, and Herman database networks; row-level security and distinct adapter login roles enforce framework tenancy.

## Container inventory

| Container | Compose service | Role | Host ports |
|---|---|---|---|
| `unify-caddy-1` | `caddy` | Public TLS ingress and security headers | 80/443 |
| `unify-unify-core-1` | `unify-core` | Authentication, authorization, framework registry, policy, operations, audit, and normalized API | None |
| `unify-alica-1` | `alica` | Supervised Alica Hermes runtime plus Alica control adapter | None |
| `unify-herman-1` | `herman` | Supervised Herman Hermes runtime plus Herman control adapter | None |
| `unify-unify-postgres-1` | `unify-postgres` | PostgreSQL 16.6 durable state | None |

All five services use `restart: unless-stopped`, health checks, resource limits, dropped capabilities, `no-new-privileges`, and read-only roots where supported. Core has no Docker socket, Hermes binary, or framework-data mount.

## Immutable image inputs

| Component | Installation digest reference |
|---|---|
| Hermes combined runtime | `localhost:5000/unify/hermes-runtime@sha256:4344acc7c8dea26c5100c13e719b4959c207f7f90dc609c45e69f638efd98961` |
| UNIFY Core | `localhost:5000/unify/core@sha256:4297146005607af026ae58913e16e3bd9a38a7dfafcd1981cbf61f0c1b2b6ed5` |
| Caddy | `localhost:5000/unify/caddy@sha256:d20541bd38dacf96857b0a8f3969b1f3518652c6008c947928c30c4ffe7c667b` |
| PostgreSQL | `postgres:16.6-alpine@sha256:1d04b9ba1d4996401f2552b51beda8187f175c0645c091e4781134fc9c9a3eef` |

The temporary host-local release registry container was stopped and removed after activation. Pulled immutable images remain in the Docker image store; the registry data and release inputs are retained as rollback/reconstruction assets.

## Paths

| Purpose | Path |
|---|---|
| Installer root | `/opt/unify-five-service` |
| Active release symlink | `/opt/unify-five-service/current` |
| Active release | `/opt/unify-five-service/releases/phase-14.6-a14f6d73de73` |
| Immutable source archive | `/opt/unify-phase14-source/a14f6d73de739b509bff7021eccc4a0cccac76a0` |
| Alica data | `/srv/alica-stack/data/alica` |
| Herman data | `/srv/alica-stack/data/herman` |
| Secrets | `/opt/unify/secrets` |
| Encrypted backups | `/opt/unify/backups` |
| Production evidence | `/opt/unify/evidence/phase14-6-cutover-20260806` |
| Pre-cutover rollback baseline | `/opt/unify/rollback/phase14-current` |
| Retired definitions | `/opt/unify/retired/phase14-obsolete-topology-20260806` and `/srv/alica-stack/retired/phase14-obsolete-topology-20260806` |

## Framework identity and TLS compatibility

Existing production adapter leaf certificates were preserved byte-for-byte. Their DNS identities are `alica-adapter` and `herman-adapter`, so the combined framework services retain those private network aliases and the declarative registry uses:

```text
hermes-alica  -> https://alica-adapter:28082
hermes-herman -> https://herman-adapter:28082
```

This is an intentional production compatibility decision. It avoids unauthorized certificate replacement while keeping the target five-container topology and separate private networks. New installations generate the same adapter certificate identities. A future certificate rotation may add canonical service-name SANs before changing these endpoints.

## Persistence and secrets

The cutover reused, rather than copied or recreated:

- PostgreSQL volume `unify-postgres-data-v1`;
- `/srv/alica-stack/data/alica`;
- `/srv/alica-stack/data/herman`;
- Caddy ACME state imported into `unify-caddy-data-v1`;
- all 29 existing files in `/opt/unify/secrets`.

The cutover preservation gate compared pre/post SHA-256 fingerprints and reported:

```text
preserved_existing_secrets=29
```

The installer created only missing target-role and backup secrets. Obsolete private-proxy certificates remain retained until the rollback-retention decision expires.

## Backup and restore

`unify-backup.timer` runs the current five-service encrypted backup workflow without another long-running container. The accepted post-cutover backup and isolated restore reported:

```text
Audit chain verified: 8 events
Restore rehearsal passed: tables=26 migrations=9
```

The restore creates an isolated temporary PostgreSQL container and volume, verifies backup and migration checksums, restores globals/data, validates the audit chain, and removes the temporary resources.

## Acceptance record

Phase 14.6 production acceptance passed all required gates:

- verified pre-cutover QA10 and fresh application-consistent rollback assets;
- installer `install` and idempotent `verify` PASS;
- exactly five healthy running containers in one Compose project;
- no private host ports and no Alica/Herman shared network;
- authentication, registrations, capabilities, profiles, providers, projects, boards, cronjobs, conversations, events, concurrency, and audit;
- ten consecutive complete production QA10 runs;
- independent restart of each container;
- full-stack stop/start recovery;
- Alica and Herman failure isolation in both directions;
- framework database row-level isolation and denied cross-framework inserts;
- physical-host reboot with a changed kernel boot ID and automatic five-container recovery;
- Caddy certificate/HSTS persistence across container restart and host reboot;
- fresh encrypted post-cutover backup and isolated restore;
- final QA10 and installer verification after obsolete-topology retirement;
- repository `pnpm qa` PASS.

Production evidence is retained at:

```text
/opt/unify/evidence/phase14-6-cutover-20260806
```

## Obsolete-topology retirement

Retirement occurred only after all acceptance gates passed and the user's conditional retirement authorization was satisfied.

Removed:

- eleven obsolete stopped container records, including old adapters, private proxies, framework runtimes, PostgreSQL record, one-shot jobs, and the temporary release-registry container;
- old `alica-hermes_*` and `unify-alica-v1_*` networks;
- active-path legacy Compose/Caddy definitions after checksummed archival;
- host Caddy activation; its systemd unit is masked.

Retained:

- database volume and framework data;
- all secrets, including obsolete proxy certificates during rollback retention;
- encrypted backups and framework snapshots;
- prior images;
- archived definitions, Caddy state, inspections, checksums, manifests, and exact rollback commands.

## Operations

Verify the active installation:

```bash
sudo node /opt/unify-phase14-source/a14f6d73de739b509bff7021eccc4a0cccac76a0/deploy/five-service/install.mjs \
  verify --root /opt/unify-five-service --project unify
```

Inspect the five services:

```bash
sudo docker compose \
  --env-file /opt/unify-five-service/current/compose.env \
  -f /opt/unify-five-service/current/compose.resolved.yaml \
  -p unify ps
```

Do not prune images, volumes, `/opt/unify/rollback`, `/opt/unify/backups`, `/opt/unify/secrets`, `/srv/alica-stack/data`, or retained proxy certificates until rollback retention is explicitly closed.
