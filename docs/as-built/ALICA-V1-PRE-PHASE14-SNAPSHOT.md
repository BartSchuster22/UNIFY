# ALICA-v1 Current Production Setup — As Built

## Document purpose

This is the comprehensive, secret-safe, point-in-time record of the production ALICA-v1 installation **before** the planned five-container rebuild.

It is intended for:

- understanding why the current system works;
- reproducing the current architecture on another host;
- operating and recovering the current installation;
- preserving exact paths, identities, trust relationships, and startup order;
- comparing the existing deployment with the proposed five-container topology; and
- supporting rollback if a later rebuild fails.

This document records live observations from `167.233.135.142` at **2026-08-06 06:37–06:47 UTC**, repository deployment definitions, and the accepted Phase 12/13 evidence. Secret values, private keys, passwords, session material, and bearer tokens are intentionally excluded.

> This is an as-built snapshot, not an authorization to recreate, modify, stop, or retire production. Revalidate live state immediately before using it for a migration or recovery.

## Executive summary

| Attribute | Current value |
|---|---|
| Host | `ALICA-v1` |
| Public IPv4 | `167.233.135.142` |
| Provider/platform | Hetzner KVM vServer |
| Public origin | `https://unify.167-233-135-142.sslip.io` |
| UNIFY release | `03cc758b31f85cdf891b3f88685064e43205a30f` |
| Hermes release | `0.20.0` (`2026.8.3`) |
| Hermes upstream commit | `b8b17b8cee50b85adb7fba6ea332dc06731b86f4` |
| PostgreSQL | `16.6` Alpine, pinned digest |
| Compose projects | `alica-hermes`, `unify-alica-v1` |
| Running containers | 8 |
| Exited successful setup containers | 2 |
| Public ingress | Host-installed Caddy systemd service |
| Public application ports | TCP 80/443; UDP 443 for HTTP/3 |
| SSH | TCP 22 |
| Database persistence | Docker volume `unify-postgres-data-v1` |
| Framework persistence | Bind mounts under `/srv/alica-stack/data` |
| Backup | Daily age-encrypted PostgreSQL custom dump, 14-day retention |
| Last accepted QA | Phase 13 QA10 PASS, including restart, reboot, and restore |

The application is healthy at the snapshot time. Public readiness returned:

```json
{"status":"ready","release":"03cc758b31f85cdf891b3f88685064e43205a30f"}
```

## Host inventory

### Compute and operating system

| Attribute | Observed value |
|---|---|
| Hostname | `ALICA-v1` |
| Operating system | Ubuntu 26.04 LTS |
| Kernel | `7.0.0-28-generic` |
| Architecture | `x86_64` |
| Virtualization | KVM |
| CPU | 4 vCPU, AMD EPYC-Rome Processor |
| RAM | 7.6 GiB total, 6.4 GiB available at snapshot |
| Swap | 1.9 GiB zram, unused at snapshot |
| Time zone | `Etc/UTC` |
| NTP | Synchronized |
| Boot ID | `64929b62a42941aab01fb9d0f6a9d4ac` |
| Host uptime at snapshot | Approximately 13 hours |

### Disk and filesystems

| Filesystem | Type | Size | Used | Available | Use |
|---|---|---:|---:|---:|---:|
| `/dev/sda1` mounted at `/` | ext4 | 75 GiB | 7.1 GiB | 65 GiB | 10% |
| `/dev/sda15` mounted at `/boot/efi` | vfat | 253 MiB | 154 KiB | 252 MiB | 1% |

Root inode use was 6%: approximately 255,000 used and 4.5 million available.

Block layout:

```text
sda      76.3G
├─sda1     76G ext4  /
├─sda14      1M
└─sda15    256M vfat /boot/efi
zram0      1.9G swap
```

### Access and privilege

The deployment account is:

```text
uid=1000(deploy) gid=1000(deploy) groups=deploy,sudo
```

It currently has unrestricted passwordless sudo:

```text
(ALL : ALL) NOPASSWD: ALL
```

The deployment host uses the private key at this management-host path:

```text
/home/herman/.ssh/alica_v1_deploy_ed25519
```

The private key itself is not part of this document or repository. The production SSH ED25519 host fingerprint is:

```text
SHA256:Kt3WIsYKwLR4vE1BSBitNfjTsh0ey30xIWoIG7JC0j4
```

A strict connection pattern is:

```bash
ssh -i /home/herman/.ssh/alica_v1_deploy_ed25519 \
  -o BatchMode=yes \
  -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes \
  deploy@167.233.135.142
```

Do not replace strict host-key verification with an unauthenticated connection in automation.

## Installed platform software

| Package/component | Version |
|---|---|
| Docker Engine | `29.1.3` |
| Docker Compose | `2.40.3+ds1-0ubuntu1` |
| Host Caddy | `2.6.2-14` |
| Private proxy Caddy image | `v2.10.2` |
| age | `1.2.1` |
| OpenSSL | `3.5.5` |
| UFW | `0.36.2` |
| chrony | `4.8` |

Docker daemon properties:

| Setting | Value |
|---|---|
| Storage driver | `overlay2` |
| Cgroup driver/version | `systemd`, cgroup v2 |
| Log driver | `local` |
| Live restore | Enabled |
| Security options | AppArmor, default seccomp, cgroup namespaces, no-new-privileges |
| Userland proxy | Disabled |
| Inter-container communication default | Disabled (`icc: false`) |
| Default Docker address pool | `172.20.0.0/14`, `/24` networks |
| Default file-descriptor ulimit | 65,536 soft/hard |
| Container log rotation | 10 MiB × 5 files |

Canonical daemon configuration:

```text
/etc/docker/daemon.json
```

## Current topology

### Logical request path

```text
Internet
   │
   │ TCP 80/443, UDP 443
   ▼
Host Caddy service
   │
   │ HTTP to 127.0.0.1:18080
   ▼
unify-core container :8080
   ├── HTTPS + Alica control bearer token
   │      ▼
   │   unify-alica-adapter :28082
   │      ├── local Hermes CLI against /opt/data
   │      ├── PostgreSQL event/idempotency/audit persistence
   │      └── HTTPS + native API bearer token
   │             ▼
   │          unify-alica-api :8443
   │             └── HTTP to alica:8642
   │                    ▼
   │                 alica Hermes runtime
   │
   └── HTTPS + Herman control bearer token
          ▼
       unify-herman-adapter :28082
          ├── local Hermes CLI against /opt/data
          ├── PostgreSQL event/idempotency/audit persistence
          └── HTTPS + native API bearer token
                 ▼
              unify-herman-api :8443
                 └── HTTP to herman:8642
                        ▼
                     herman Hermes runtime

unify-core, both adapters
   └── PostgreSQL to unify-postgres:5432 on an internal network
```

### Important ownership boundary

- Hermes remains the immutable source of truth for native framework state.
- The UNIFY-owned adapter exposes the versioned `hermes-control/v1` contract.
- UNIFY Core owns authentication, authorization, framework registration, policy, normalized API projection, operations, audit, and event ingestion.
- Worker, `/CHAT`, Agency, DMM, and MemoryV4 are not production runtime dependencies.
- Alica and Herman have separate identities, credentials, runtime networks, control networks, data directories, and provenance.

### Important implementation detail

Each adapter image contains the pinned Hermes runtime and runs the Hermes CLI locally. The matching framework data directory is mounted read-write into both:

- the live Hermes runtime container; and
- that framework's adapter container.

For example, `/srv/alica-stack/data/alica` is mounted at `/opt/data` in both `alica` and `unify-alica-adapter`. This is why the existing adapter cannot simply be moved into Core without changing the execution model.

## Docker Compose projects

### Project 1: `alica-hermes`

Configuration files:

```text
/srv/alica-stack/compose.yaml
/opt/unify/deploy/alica-v1/hermes-api.override.yaml
```

Working directory:

```text
/srv/alica-stack
```

Services:

- `alica`
- `herman`

The base Compose file defines hardened Hermes gateway runtimes. The UNIFY override replaces the image with `unify-hermes-api:<release>`, enables the native Hermes API on port 8642 inside each isolated runtime network, and mounts an independent native API token.

### Project 2: `unify-alica-v1`

Configuration file:

```text
/opt/unify/compose.yaml
```

Working directory:

```text
/opt/unify
```

Steady-state services:

- `unify-postgres`
- `unify-alica-adapter`
- `unify-herman-adapter`
- `unify-alica-api`
- `unify-herman-api`
- `unify-core`

One-shot setup services retained as exited records:

- `migrate`
- `bootstrap-admin`

## Container inventory

### Running containers

| Container | Image/tag | Role | Health | Published host ports |
|---|---|---|---|---|
| `alica` | `unify-hermes-api:03cc758…` | Alica Hermes gateway/API | Healthy | None |
| `herman` | `unify-hermes-api:03cc758…` | Herman Hermes gateway/API | Healthy | None |
| `unify-alica-adapter` | `unify-hermes-control-adapter:03cc758…` | Alica `hermes-control/v1` adapter | Healthy | None |
| `unify-herman-adapter` | `unify-hermes-control-adapter:03cc758…` | Herman `hermes-control/v1` adapter | Healthy | None |
| `unify-alica-api` | `unify-caddy-proxy:03cc758…` | Private TLS bridge to Alica API | No Docker healthcheck | None |
| `unify-herman-api` | `unify-caddy-proxy:03cc758…` | Private TLS bridge to Herman API | No Docker healthcheck | None |
| `unify-core` | `unify-core:03cc758…` | Production UNIFY Core/Gateway | Healthy | `127.0.0.1:18080 → 8080` |
| `unify-postgres` | pinned `postgres:16.6-alpine` | UNIFY database | Healthy | None |

### Exited successful setup containers

| Container | Exit | Purpose |
|---|---:|---|
| `unify-alica-v1-migrate-1` | 0 | Applies forward database migrations |
| `unify-alica-v1-bootstrap-admin-1` | 0 | Idempotently creates/verifies the initial administrator |

Their inherited image health state may display as unhealthy after exit; the meaningful setup result is exit code 0.

### Current image identities

| Image | Immutable/runtime identity |
|---|---|
| `unify-core:03cc758…` | Image ID `sha256:e9067d66bf05c38b28cc325dd8d1b97a7e9eee85fb0942df37ed6eb278864dde` |
| `unify-hermes-api:03cc758…` | Image ID `sha256:1af487a9c7da59c8dbc65f17db4456930015436bcf190a942cb5406cac0035e2` |
| `unify-hermes-control-adapter:03cc758…` | Image ID `sha256:d725830576cd7db81c6f2d1cbf4cc79907cc878d57b9277633425b7f08491cd5` |
| `unify-caddy-proxy:03cc758…` | Image ID `sha256:ee98d848b3b9f7ed71f5aa5f77eb4d20d60496051e2c1fa35d071f38e3a9c1c6` |
| Hermes base | `nousresearch/hermes-agent@sha256:fcbe95482353e41cd30d39ddfc0f57ba3720f6da6969a7a69cdfb0d84b045cb6` |
| PostgreSQL | `postgres:16.6-alpine@sha256:1d04b9ba1d4996401f2552b51beda8187f175c0645c091e4781134fc9c9a3eef` |

Several prior release tags remain locally and share image layers. Do not prune them before a rollback retention decision.

## Container runtime configuration

### `alica` and `herman`

Common runtime behavior:

- entrypoint: `/opt/hermes/docker/entrypoint-dispatch.sh`;
- command: `gateway run`;
- container starts as root so s6 can initialize, then uses configured Hermes UID/GID 10000;
- read-only root filesystem;
- `no-new-privileges:true`;
- selected capabilities dropped;
- `/run` and `/tmp` supplied as tmpfs;
- 3 GiB memory limit each;
- 2 CPU limit each;
- 512 PID limit each;
- 30-second stop grace period;
- `restart: unless-stopped`;
- health checks the s6 `main-hermes` service;
- no host ports.

Per-framework persistent bind mounts:

```text
/srv/alica-stack/data/alica  → /opt/data
/srv/alica-stack/data/herman → /opt/data
```

Per-framework native API secret mounts:

```text
/opt/unify/secrets/alica-api-token  → /run/secrets/hermes-api-token
/opt/unify/secrets/herman-api-token → /run/secrets/hermes-api-token
```

Native API configuration:

```text
API_SERVER_ENABLED=true
API_SERVER_HOST=0.0.0.0
API_SERVER_PORT=8642
GATEWAY_ALLOW_ALL_USERS=false
HERMES_HOME=/opt/data
```

Although the API binds to `0.0.0.0` inside the container, it is not published to the host and each framework is attached to its own Docker network.

### Framework adapters

Common runtime behavior:

- command: `node dist/server.js`;
- runtime user `10000:10000`;
- read-only root filesystem;
- all Linux capabilities dropped;
- `no-new-privileges:true`;
- 512 MiB memory limit each;
- 0.5 CPU limit each;
- `restart: unless-stopped`;
- native TLS on port 28082;
- port 28082 is not published;
- full pinned Hermes runtime present for local CLI execution;
- matching framework `/opt/data` bind mounted read-write;
- direct PostgreSQL access for adapter events, idempotency, and audit.

Identity and upstreams:

| Adapter | Framework ID | Instance ID | Native API upstream |
|---|---|---|---|
| Alica | `hermes-alica` | `alica-v1-private` | `https://alica-api:8443` |
| Herman | `hermes-herman` | `herman-v1-private` | `https://herman-api:8443` |

Scopes:

```text
control:read,control:execute,control:events
```

Adapter endpoints registered in Core:

```text
https://alica-adapter:28082
https://herman-adapter:28082
```

The Gateway-to-adapter timeout is 20 seconds. Conversation command calls have a longer bounded timeout in the control client.

### Private API proxies

Each proxy:

- runs pinned Caddy in a dedicated container;
- uses runtime user `10000:10000`;
- has a read-only root filesystem;
- drops all capabilities;
- sets `no-new-privileges:true`;
- has 128 MiB memory, 0.25 CPU, and 64 PID limits;
- uses tmpfs for `/tmp`, `/data`, and `/config`;
- publishes no host port;
- bridges one UNIFY-private network and one matching Hermes runtime network.

Alica route:

```caddyfile
https://alica-api:8443 {
    tls /run/secrets/alica-api-tls-cert /run/secrets/alica-api-tls-key
    reverse_proxy http://alica:8642
}
```

Herman uses the same pattern with `herman-api` and `herman:8642`.

### `unify-core`

Runtime behavior:

- current image is the standalone UNIFY Gateway/Core production runtime;
- distroless Node.js runtime;
- user `65532:65532`;
- command `dist/server.js`;
- read-only root filesystem;
- all capabilities dropped;
- `no-new-privileges:true`;
- 768 MiB memory limit;
- 1 CPU limit;
- `restart: unless-stopped`;
- internal listen address `0.0.0.0:8080`;
- only host binding is `127.0.0.1:18080`;
- request limit is 600 requests per minute;
- allowed origin is the exact public HTTPS origin;
- trusts the private framework CA through `NODE_EXTRA_CA_CERTS`;
- reads independent framework bearer credentials from mounted files.

Core starts only after:

1. migration exits successfully;
2. administrator bootstrap exits successfully;
3. Alica adapter is healthy; and
4. Herman adapter is healthy.

### `unify-postgres`

Runtime behavior:

- PostgreSQL 16.6 Alpine pinned digest;
- database `unify`;
- role `unify`;
- password supplied through a Docker secret bind mount;
- data in named volume `unify-postgres-data-v1`;
- no published port;
- attached only to the internal database network;
- 1 GiB memory limit;
- 1 CPU limit;
- 128 MiB shared memory;
- `restart: unless-stopped`;
- `no-new-privileges:true`;
- health check uses `pg_isready -U unify -d unify`.

## Hermes runtime baseline

Alica, Herman, and both adapter images reported the same baseline:

```text
Hermes Agent v0.20.0 (2026.8.3) · upstream b8b17b8c
Install directory: /opt/hermes
Install method: docker
Python: 3.13.5
OpenAI SDK: 2.24.0
```

The full supported upstream commit is:

```text
b8b17b8cee50b85adb7fba6ea332dc06731b86f4
```

The adapter verifies this immutable baseline before listening. A release/commit mismatch is a startup failure, not a warning.

## Docker networks

| Network | Subnet | Internal | Current members | Purpose |
|---|---|---:|---|---|
| `alica-hermes_alica_net` | `172.20.0.0/24` | No | `alica`, `unify-alica-api` | Alica native API runtime path |
| `alica-hermes_herman_net` | `172.20.1.0/24` | No | `herman`, `unify-herman-api` | Herman native API runtime path |
| `unify-alica-v1_herman-unify-private` | `172.20.2.0/24` | Yes | Core, Herman adapter, Herman API proxy | Herman control path |
| `unify-alica-v1_unify-db-private` | `172.20.3.0/24` | Yes | Core, PostgreSQL, both adapters | Database path |
| `unify-alica-v1_alica-unify-private` | `172.20.4.0/24` | Yes | Core, Alica adapter, Alica API proxy | Alica control path |
| `unify-alica-v1_unify-proxy` | `172.20.5.0/24` | No | Core only | Non-internal Core network; host Caddy does not join it |

Static container IP addresses are observations, not durable configuration. Service discovery uses Docker DNS aliases and service names.

The runtime Alica/Herman networks are not marked internal, but no framework or proxy ports are published. Public filtering is additionally enforced by UFW and the `DOCKER-USER` chain.

## Persistent storage

### Framework state

| Framework | Host path | Container path | Snapshot size |
|---|---|---|---:|
| Alica | `/srv/alica-stack/data/alica` | `/opt/data` | 81 MiB |
| Herman | `/srv/alica-stack/data/herman` | `/opt/data` | 81 MiB |

The complete `/srv/alica-stack` tree was 161 MiB at snapshot time.

These directories contain the complete independent Hermes homes. Treat them as application data, not rebuildable image content. Snapshot them only with an application-consistent stop/freeze procedure.

### UNIFY database

| Attribute | Value |
|---|---|
| Docker volume | `unify-postgres-data-v1` |
| Host mountpoint | `/var/lib/docker/volumes/unify-postgres-data-v1/_data` |
| Filesystem use | Approximately 64–67 MiB |
| Logical database size | 9,260 KiB |
| Application tables | 26 in `public` |
| Applied migrations | 7 |

Applied migrations:

```text
001_gateway_foundation
002_governance_guards
002_hermes_control_registry
003_hermes_adapter_foundations
004_gateway_hermes_framework
005_hermes_work_cutover
006_hermes_020_baseline
```

The duplicate numeric prefix is intentional historical naming; migration identity is the complete string.

### Caddy and logs

| Path | Purpose | Snapshot size |
|---|---|---:|
| `/var/lib/caddy` | ACME certificates and Caddy application state | 104 KiB |
| `/var/log/caddy` | Public access logs | 1.5 MiB |
| systemd journal | Host/service logs | 226.1 MiB |

Preserve `/var/lib/caddy` for a rollback to host Caddy.

## Secret and trust model

All deployment secrets are stored under:

```text
/opt/unify/secrets
```

The directory is traverse-only for nonowners and files are generally mode 0600. Values are mounted as files rather than embedded in Compose environment values or image layers.

### Secret categories

| Category | Files |
|---|---|
| PostgreSQL | `postgres-password`, `database-url`, `database-url-adapter` |
| UNIFY auth | `auth-pepper`, `bootstrap-admin-password` |
| Core-to-adapter control auth | `alica-token`, `herman-token`, `alica-token-bundle.json`, `herman-token-bundle.json` |
| Adapter-to-Hermes API auth | `alica-api-token`, `herman-api-token` |
| Private framework CA | `framework-ca.key`, `framework-ca.crt`, `framework-ca.srl` |
| Adapter TLS | `alica.key`, `alica.crt`, `herman.key`, `herman.crt` |
| Native API proxy TLS | `alica-api.key`, `alica-api.crt`, `herman-api.key`, `herman-api.crt` |
| Backup encryption | `backup-age.key`, `backup-age-recipient` |

### Trust paths

Core to adapter:

```text
Core bearer token file
+ private framework CA trust
+ independent adapter certificate/key
```

Adapter to native API proxy:

```text
Independent native API bearer token
+ private framework CA trust
+ independent API proxy certificate/key
```

Alica and Herman do not share bearer token values or TLS private keys.

### Ownership pattern

- PostgreSQL and backup key material: root-owned.
- Core-readable files: UID/GID 65532.
- Adapter/private-proxy-readable files: UID/GID 10000.
- Private CA key is retained on the host and must remain protected.

Never copy secret contents into documentation, shell history, CI output, issue trackers, or Git. For a new installation, generate fresh values rather than cloning production secrets unless performing an explicitly authorized disaster-recovery restoration.

## Public ingress

### Host Caddy

Caddy runs directly on the host as:

```text
caddy.service
/usr/bin/caddy run --environ --config /etc/caddy/Caddyfile
User=caddy
Group=caddy
```

It is enabled and active. Configuration:

```text
/etc/caddy/Caddyfile
```

Behavior:

```caddyfile
unify.167-233-135-142.sslip.io {
    encode zstd gzip
    reverse_proxy 127.0.0.1:18080
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy no-referrer
    }
    log {
        output file /var/log/caddy/unify-access.log
        format json
    }
}
```

At snapshot time:

- HTTP redirected with status 308 to HTTPS;
- readiness returned HTTP/2 200;
- HTTP/3 was advertised;
- HSTS was enabled;
- no recent Caddy warning/error journal entries were present.

Both Core and Caddy emit some security headers, so the live readiness response contains duplicate HSTS, referrer-policy, content-type, and frame-option headers. This is current behavior and should be normalized in a later change rather than silently changed during recovery.

### TLS certificate

| Attribute | Observed value |
|---|---|
| Subject | `CN=unify.167-233-135-142.sslip.io` |
| Issuer | Let's Encrypt `YE2` |
| Valid from | 2026-08-05 15:20:43 UTC |
| Valid until | 2026-11-03 15:20:42 UTC |
| SHA-256 fingerprint | `73:6C:84:F6:61:0B:15:B1:30:4B:4A:AF:5F:52:40:4D:68:E1:E2:32:D5:FC:CB:A0:FE:41:B4:E8:AF:6D:2D:19` |

Certificate state is automatically managed under the Caddy data directory.

## Host firewall and exposure

### UFW

UFW is active with:

- default deny incoming;
- default allow outgoing;
- default deny routed;
- low-level logging enabled.

Rules:

| Port | Rule |
|---|---|
| TCP 22 | Explicit allow from deployment host `188.245.221.1` and rate-limited allow from other addresses |
| TCP 80 | Public allow for HTTP/ACME redirect |
| TCP 443 | Public allow for HTTPS |
| IPv6 22/80/443 | Equivalent rate-limit/allow behavior |

Therefore, the host has three intentional public TCP services: SSH 22 and web 80/443. Phase 13's “only 80/443” statement refers to application exposure, excluding the separately controlled SSH management service.

### Docker ingress guard

Systemd unit:

```text
alica-docker-firewall.service
```

Script:

```text
/usr/local/sbin/alica-docker-firewall
```

The script recreates the IPv4/IPv6 `DOCKER-USER` chains at boot, permits established traffic and original-destination TCP 80/443, drops other new traffic arriving on `eth0`, and returns for nonexternal traffic.

The unit is enabled and active.

### Observed listeners

Intentional listeners at snapshot:

- host SSH on TCP 22;
- host Caddy on TCP 80/443 and UDP 443;
- Caddy admin API on loopback TCP 2019;
- UNIFY Core Docker binding on loopback TCP 18080;
- local DNS, chrony, containerd, and system services on loopback/link-local addresses.

PostgreSQL 5432, native Hermes API 8642, UNIFY Core 8080, adapter 28082, and Caddy admin 2019 are not externally published.

## Database backup and restoration

### Backup service

Systemd units:

```text
/etc/systemd/system/unify-backup.service
/etc/systemd/system/unify-backup.timer
```

Timer behavior:

```text
OnCalendar=*-*-* 02:15:00 UTC
RandomizedDelaySec=900
Persistent=true
```

The service runs:

```text
/opt/unify/backup.sh
```

Backup algorithm:

1. Execute `pg_dump` inside `unify-postgres`.
2. Produce a PostgreSQL custom-format archive with compression level 9.
3. Write plaintext only to a mode-0600 temporary file.
4. Encrypt to the deployment-specific age recipient.
5. Write a SHA-256 checksum sidecar.
6. Remove plaintext temporary data through a trap.
7. Delete encrypted backup/checksum files older than 14 days.

Backup directory:

```text
/opt/unify/backups
```

Observed archives:

| Archive | Size | Checksum status |
|---|---:|---|
| `unify-20260805T162203Z.dump.age` | 65,901 bytes | Verified |
| `unify-20260805T173504Z.dump.age` | 85,488 bytes | Verified |
| `unify-20260806T022021Z.dump.age` | 87,002 bytes | Verified |

The latest scheduled run completed successfully at 2026-08-06 02:20 UTC. The next trigger was scheduled for 2026-08-07 around 02:15 UTC plus randomized delay.

### Restore rehearsal

Restore script:

```text
/opt/unify/test-restore.sh
```

It:

1. selects the newest archive unless one is supplied;
2. verifies the checksum;
3. decrypts to a temporary file;
4. creates an isolated temporary PostgreSQL database;
5. restores with `pg_restore --exit-on-error`;
6. compares production/restored application table counts;
7. compares production/restored migration counts; and
8. drops the temporary database and plaintext file.

Accepted Phase 13 evidence recorded 26 application tables and 7 migrations after restore.

### Framework-data backup gap

The automated daily timer protects the UNIFY PostgreSQL database only. It does **not** back up:

```text
/srv/alica-stack/data/alica
/srv/alica-stack/data/herman
```

Before rebuild, migration, or destructive framework work, create separate application-consistent, encrypted, checksummed snapshots of both directories. This is mandatory for complete disaster recovery.

## Startup and dependency behavior

### Host boot

1. `docker.service` starts and has live restore enabled.
2. Existing containers with `restart: unless-stopped` recover.
3. `alica-docker-firewall.service` applies the `DOCKER-USER` ingress guard.
4. `caddy.service` starts and reads `/etc/caddy/Caddyfile`.
5. `unify-backup.timer` resumes persistently.

Phase 13 verified host reboot recovery with a changed boot ID and a subsequent full QA10 pass.

### Compose startup

Framework project:

```bash
cd /srv/alica-stack
export RELEASE_ID=<release>
sudo docker compose \
  -f compose.yaml \
  -f /opt/unify/deploy/alica-v1/hermes-api.override.yaml \
  up -d
```

UNIFY project:

```bash
cd /opt/unify
export RELEASE_ID=<release>
export UNIFY_PUBLIC_ORIGIN=https://unify.167-233-135-142.sslip.io
sudo docker compose -f compose.yaml up -d
```

Dependency sequence inside the UNIFY project:

```text
PostgreSQL healthy
  → migration exits 0
    → administrator bootstrap exits 0
      → private API proxies started
        → adapters healthy
          → Core starts and becomes healthy
```

Framework registration is a separate authenticated operation:

```bash
cd /opt/unify
export UNIFY_PUBLIC_ORIGIN=https://unify.167-233-135-142.sslip.io
sudo ./register-frameworks.sh
```

The registration script logs in as the bootstrap administrator, obtains CSRF state, and idempotently registers/probes:

```text
hermes-alica  → https://alica-adapter:28082
hermes-herman → https://herman-adapter:28082
```

It requires exact `hermes-control/v1`, Hermes 0.20.0, and the pinned upstream commit.

## Current build and deployment behavior

The production installation uses locally built release-tagged images rather than a remote image registry.

Expected build context:

```text
/opt/unify
```

Relevant Dockerfiles:

```text
Dockerfile.gateway
Dockerfile.hermes-control-adapter
Dockerfile.hermes-api
Dockerfile.caddy-proxy
```

Representative build sequence:

```bash
cd /opt/unify
export RELEASE_ID=<full-git-commit>

docker build -f Dockerfile.gateway \
  -t "unify-core:$RELEASE_ID" .

docker build -f Dockerfile.hermes-control-adapter \
  -t "unify-hermes-control-adapter:$RELEASE_ID" .

docker build -f Dockerfile.hermes-api \
  -t "unify-hermes-api:$RELEASE_ID" .

docker build -f Dockerfile.caddy-proxy \
  -t "unify-caddy-proxy:$RELEASE_ID" .
```

Production then starts the framework project with the override, starts the UNIFY project, registers frameworks, installs/enables Caddy and backup units, validates public/private exposure, runs restore rehearsal, and runs QA10.

Do not treat this command list as a complete new-host installer. The current installation has known procedural drift described below.

## Secret preparation behavior

Production has:

```text
/opt/unify/prepare-secrets.sh
```

It is fail-closed: if any file already exists in `/opt/unify/secrets`, it refuses to replace the directory contents.

The production copy generates the original database, auth, framework-control, framework-CA, adapter TLS, and backup age materials. However, the current live stack also requires native API tokens and private API proxy certificates that are not generated by that deployed script copy.

The repository's newer `deploy/alica-v1/prepare-secrets.sh` contains the expanded generation logic. For future reuse:

- do not run the production copy and assume the complete current stack can start;
- do not overwrite existing production secrets;
- use a reviewed, version-controlled installer on a clean target;
- verify the full required secret inventory before Compose startup; and
- generate new-host secrets rather than copying live production values.

## Configuration file inventory

The following hashes identify the live files at snapshot time. Hashes verify file identity without exposing secrets.

| File | SHA-256 |
|---|---|
| `/srv/alica-stack/compose.yaml` | `81adac606c2000461eea5f911cd8f38141e86c18eb86b1d4dd52aaab59c2ac6d` |
| `/opt/unify/compose.yaml` | `a35bd99699e0cb5b888d66376eeab26e1ac2f4aae9b846b0a19f9b180ea1f273` |
| `/opt/unify/deploy/alica-v1/hermes-api.override.yaml` | `649a06ee1e51cac6e75d19603fc2f4cf0b5a4d40acc698a24059f0e3c4ee5eb6` |
| `/etc/caddy/Caddyfile` | `c4c6e5d160ccbfe7820c2f390aed72338d64a2c6f89abb2fee73d3902c5fb27f` |
| `/opt/unify/deploy/alica-v1/alica-api.Caddyfile` | `aa213301012679cfdfe20299e09f4c55a3ab0ea3d93cb37a9dfcf8acf861cede` |
| `/opt/unify/deploy/alica-v1/herman-api.Caddyfile` | `ba3bc32998825ac593891d580e6d39fea990f97a3a41a1d5c2ec434079ea1e1c` |
| `/etc/docker/daemon.json` | `8c44192b996ebb22e6bc9e3c8ddeea3a6083c10a9f56df1a4cac12575a0d7024` |
| `/usr/local/sbin/alica-docker-firewall` | `1a9f9f8e8e1e77251a579cbbbfa175b15a9e7008ac0175cd8343958096d26af2` |
| `/etc/systemd/system/alica-docker-firewall.service` | `aac4f6ab320212018b2f5178b831bc0be65e84221256572eb0d33b4ebd8073f4` |
| `/opt/unify/backup.sh` | `418b2fbca32c9a199d0db7a3d4954af0cc56c7656686e923d8397a0936b7d1c1` |
| `/opt/unify/test-restore.sh` | `e362cceebc938d392e9ad5723453ed01c697d74d9f6b34b308695e9785e5e12f` |
| `/etc/systemd/system/unify-backup.service` | `5b37db5446959a3c618a7af8fa85dada66e1acda7612ac0c9b1efef1b40bcbd0` |
| `/etc/systemd/system/unify-backup.timer` | `db5890d322ca4ae879030833f52b19730490a8e13d2aea462602c2f7d5d6361c` |
| `/opt/unify/prepare-secrets.sh` | `6fe76c235071494740954d1278a992a34cb2af39f129331b41d0e3d63a2ea4da` |
| `/opt/unify/register-frameworks.sh` | `0296bc698943ab1d2236b833f73368c2bd753289b6b2f2692410fd614bf2504d` |

Compose and Caddy configuration validation passed against these live files at snapshot time.

## Operational commands

All commands below are read-only unless explicitly labeled.

### Check overall state

```bash
sudo docker compose ls
sudo docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}\t{{.Ports}}'
systemctl --no-pager --full status caddy.service
systemctl --no-pager --full status unify-backup.timer
systemctl --no-pager --full status alica-docker-firewall.service
```

### Check public readiness

```bash
curl --fail-with-body --silent --show-error \
  https://unify.167-233-135-142.sslip.io/api/v1/health/ready
```

### Check local Core readiness

```bash
curl --fail-with-body --silent --show-error \
  http://127.0.0.1:18080/api/v1/health/ready
```

### Validate configurations

```bash
export RELEASE_ID=03cc758b31f85cdf891b3f88685064e43205a30f
export UNIFY_PUBLIC_ORIGIN=https://unify.167-233-135-142.sslip.io

sudo docker compose \
  -f /srv/alica-stack/compose.yaml \
  -f /opt/unify/deploy/alica-v1/hermes-api.override.yaml \
  config --quiet

sudo docker compose -f /opt/unify/compose.yaml config --quiet
sudo caddy validate --config /etc/caddy/Caddyfile
```

### View logs

```bash
sudo docker logs --since 30m unify-core
sudo docker logs --since 30m unify-alica-adapter
sudo docker logs --since 30m unify-herman-adapter
sudo docker logs --since 30m alica
sudo docker logs --since 30m herman
sudo journalctl -u caddy.service --since '-30 minutes' --no-pager
sudo journalctl -u unify-backup.service -n 100 --no-pager
```

Do not enable debug logging that prints request authorization headers or secret-file contents.

### Trigger a database backup

This is a state-changing operational command because it creates an archive:

```bash
sudo systemctl start unify-backup.service
sudo journalctl -u unify-backup.service -n 30 --no-pager
```

### Rehearse latest database restore

This temporarily creates and removes an isolated test database:

```bash
sudo /opt/unify/test-restore.sh
```

### Run production QA10

This performs authenticated registration replays and reads but should be treated as an active acceptance operation:

```bash
sudo env \
  UNIFY_PUBLIC_ORIGIN=https://unify.167-233-135-142.sslip.io \
  /opt/unify/qa10-production.sh
```

Do not use the production QA script for UI testing that could create real framework work. The current script exercises authentication, registration, reads, concurrency, audit, logout, and secret scanning.

## Accepted QA and recovery evidence

Phase 13 acceptance is recorded in:

```text
/opt/unify/evidence/phase13-20260805T172802Z
```

The directory contains:

- ten consecutive QA10 run logs;
- final-head QA10 log;
- container restart evidence;
- host reboot before/after boot IDs;
- post-reboot container and health evidence;
- post-reboot QA10 log;
- encrypted backup evidence;
- isolated restore evidence; and
- `SHA256SUMS` covering the evidence files.

All entries in `SHA256SUMS` verified successfully during preparation of this document. All three currently retained encrypted backup checksum files also verified successfully.

Accepted gates include:

- authentication and revoked sessions;
- authorization and CSRF;
- independent framework identity and credential isolation;
- idempotent registration;
- concurrent reads;
- immutable audit and no secret leakage;
- framework health, capabilities, profiles, providers, projects, boards, cronjobs, conversations, and events;
- container restart recovery;
- host reboot recovery;
- encrypted backup and isolated restore;
- public exposure checks;
- repository QA; and
- live PostgreSQL integration tests.

## Known drift, limitations, and reuse warnings

### 1. Two Compose projects and eight running containers

The current system is operationally more complex than required by the permanent single-instance constraint. The five-container rebuild plan addresses this separately.

### 2. Production secret-preparation script is incomplete for the final topology

The live `/opt/unify/prepare-secrets.sh` predates the native API token/proxy certificate additions. The existing production secret directory is complete because those materials were added during acceptance work, but a clean host cannot reproduce the final stack from that production script alone.

### 3. Public Caddy and private proxy Caddy versions differ

- host Caddy: 2.6.2;
- private Caddy image: 2.10.2.

Do not assume behavior or configuration support is identical.

### 4. Host Caddy is outside Docker

Public ingress recovery depends on systemd, `/etc/caddy/Caddyfile`, `/var/lib/caddy`, `/var/log/caddy`, and the local loopback Core binding. `docker compose up` alone does not restore the public site.

### 5. Framework data is not in the scheduled backup

Only PostgreSQL has a daily automated encrypted backup. Alica/Herman data requires a separate snapshot procedure.

### 6. Passwordless sudo is broad

The `deploy` account can execute any root command without a password. This simplifies automation but is a significant trust boundary.

### 7. Framework runtime networks are not Docker-internal

Alica and Herman runtime networks allow container egress. Host publication is still absent and ingress is guarded, but `internal: true` is not set on those two networks.

### 8. Core has an otherwise unused non-internal Compose network

`unify-alica-v1_unify-proxy` currently contains only `unify-core`. Host Caddy reaches Core through `127.0.0.1:18080`, not that network.

### 9. Private proxies lack Docker health checks

The proxy containers are running but Docker reports no health status. Adapter health and full QA provide indirect verification.

### 10. One-shot setup container records remain

Migration and bootstrap exited successfully but remain visible in `docker ps -a`, making ten container records even though only eight run.

### 11. Locally built image tags are not registry-backed

Recovery depends on retained local images or the ability to reproduce them from the exact source and pinned bases. Preserve image IDs/digests and source commits before pruning.

### 12. Security headers are duplicated

Core and host Caddy both emit overlapping security headers. This is truthful current behavior, not an indication of two public proxies.

## Reproduction checklist for a separate host

To reproduce the current architecture safely, all of the following are required:

- [ ] Supported Ubuntu host with synchronized UTC time.
- [ ] Docker Engine and Compose with compatible daemon hardening.
- [ ] UFW policy and boot-persistent `DOCKER-USER` ingress guard.
- [ ] Exact pinned Hermes and PostgreSQL base digests.
- [ ] Exact UNIFY source commit and reproducible image builds.
- [ ] `/srv/alica-stack/compose.yaml` plus UNIFY Hermes API override.
- [ ] `/opt/unify/compose.yaml` and private proxy Caddyfiles.
- [ ] Fresh, complete secret generation including native API tokens and all four TLS identities.
- [ ] Independent Alica and Herman data directories.
- [ ] PostgreSQL volume initialization and migration.
- [ ] Administrator bootstrap.
- [ ] Authenticated, idempotent framework registration.
- [ ] Host Caddy package, configuration, writable state/log paths, and systemd enablement.
- [ ] Backup script, age identity, service, timer, and successful restore rehearsal.
- [ ] Public DNS/origin that can obtain a trusted certificate.
- [ ] Full QA10, restart recovery, host reboot recovery, backup restoration, and exposure tests.
- [ ] Checksummed as-built and acceptance evidence.

For a fresh deployment, do not copy the live secret directory. Generate new values and restore only explicitly authorized application data.

## Relationship to the five-container rebuild

The planned replacement is documented in:

```text
docs/rebuild/phase-14-five-container-topology-plan.md
```

That plan must preserve every applicable invariant recorded here while changing the deployment shape from:

```text
2 framework containers
2 adapter containers
2 private API proxy containers
1 Core container
1 PostgreSQL container
+ host Caddy
```

to:

```text
1 combined Alica container
1 combined Herman container
1 Core container
1 PostgreSQL container
1 public Caddy container
```

This as-built document is the rollback and parity reference for that work.
