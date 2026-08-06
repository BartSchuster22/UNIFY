# Phase 14.2 Five-Service Compose Evidence

**Status:** PASS
**Date:** 2026-08-06 UTC
**Production changed:** No

## Accepted topology

`deploy/five-service/compose.yaml` declares exactly five steady-state services:

1. `alica`
2. `herman`
3. `unify-core`
4. `unify-postgres`
5. `caddy`

Database migration and initial administrator creation are one-shot `docker compose run --rm` jobs in `compose.jobs.yaml`; they are not steady-state services or retained containers.

## Accepted local artifacts

| Artifact | Image ID | Size |
|---|---|---:|
| `unify/hermes-runtime:phase-14.1` | `sha256:ef30e149eaeca94ff67af1fea974f52682d38dbd0e3b674bb70cb8acd7940ba6` | 1,015,967,275 bytes |
| `unify-core:phase-14.2` | `sha256:7c41802b082f95dd112f2444b93b0109f576516a6afe25e07050a719796a6501` | 56,673,911 bytes |
| `unify-caddy:phase-14.2` | `sha256:85761f337a5fbc853756870de2425802eb6192bb6530b2aab364c4860c3287ee` | 38,435,950 bytes |

The two framework services use the same combined runtime image. Alica and Herman retain separate bind-mounted data trees, identities, API tokens, adapter tokens, database secret files, TLS identities, control networks, and outbound networks.

## Manifest checksums

```text
df7b3e2f522af3d69712a604916f727430facfc2e74bebe4f6ca5e8ec1b28e10  deploy/five-service/compose.yaml
5d86275f1920c1f4594a1d79402da32aa6b3143a2ff8291054f990485b48aca7  deploy/five-service/compose.jobs.yaml
cc1137a4942888c4d987f9c8f91e335236789d2268a2039f2be5b5b66d840f5e  deploy/five-service/Caddyfile
f9aa1bf48833c88290189a09d9d8ca7879acf1b586df28bb9e078989ce392a84  Dockerfile.hermes-runtime
952df716c3f7323cf272678bafea0bfa56a89e1f7ae7e9b9facfebc2d6597753  Dockerfile.caddy-proxy
```

## Network proof

Private networks are Docker-internal:

- `unify-ingress`: Caddy and Core only;
- `unify-db-private`: Alica, Herman, Core, and PostgreSQL only;
- `alica-control-private`: Core and Alica only;
- `herman-control-private`: Core and Herman only.

Outbound access is isolated into one-member non-internal networks:

- `alica-egress` permits Alica provider/platform access without admitting Herman or Core;
- `herman-egress` permits Herman provider/platform access without admitting Alica or Core;
- `caddy-egress` permits ACME traffic without placing an application service on Caddy's outbound network.

No network is coupled to another Compose project and no external network is required.

## Security proof

Every steady-state container was inspected after startup and satisfied:

- read-only root filesystem;
- `cap_drop: ALL`;
- `no-new-privileges:true`;
- finite CPU, memory, and PID limits;
- bounded `json-file` log rotation;
- a healthy Docker health status.

The combined s6 framework runtime adds only `CHOWN`, `DAC_OVERRIDE`, `FOWNER`, `SETGID`, and `SETUID`. The first three initialize mounted data and supervise trees; the final two drop the Hermes and adapter children to UID/GID 10000. Core and Caddy add no capabilities. PostgreSQL starts directly as UID/GID 70. Caddy runs as UID/GID 10000.

The hardened Caddy derivative removes the upstream `cap_net_bind_service` file capability before dropping to UID 10000. It listens on unprivileged container ports 8080/8443; Compose publishes those as host ports 80/443 by default. The Caddyfile is embedded read-only in the image.

Only Caddy had host port bindings in runtime inspection. Alica/Herman native Hermes port 8642, adapter port 28082, Core port 8080, and PostgreSQL port 5432 were not host-published.

## Secret and data proof

The main manifest uses Compose secret files for:

- PostgreSQL password;
- Core and framework database URLs;
- authentication pepper;
- separate Alica/Herman native API tokens;
- separate Alica/Herman adapter token bundles and Core tokens;
- adapter server certificates and keys;
- the framework CA certificate.

The bootstrap password exists only in the one-shot jobs overlay. No secret values are embedded in an image or manifest. The acceptance run generated isolated temporary values and deleted them during teardown. It did not mount production data.

## Static gate

```text
$ pnpm five-service:check
Five-service Compose static and security contract: PASS
```

The gate renders both manifests and rejects:

- a steady-state service count other than five;
- unauthorized host ports or network membership;
- external networks;
- missing resource limits, health checks, security controls, or log bounds;
- shared Alica/Herman data paths;
- unpinned PostgreSQL/Caddy base images;
- retained migration/bootstrap services;
- Docker socket mounts.

## Clean-fixture acceptance

```text
$ FIVE_SERVICE_SKIP_CORE_BUILD=1 FIVE_SERVICE_SKIP_CADDY_BUILD=1 pnpm five-service:verify
Five-service Compose clean-fixture acceptance: PASS project=unify-phase142-3087892-1786005944488 containers=5 ports=41737,34219
```

The runtime gate performed all of the following on generated data, secrets, certificates, networks, and volumes:

1. created and health-gated PostgreSQL;
2. ran migration and bootstrap jobs with `--rm`;
3. started the dependency-ordered stack with `docker compose up --wait`;
4. proved exactly five project containers existed and all five were running and healthy;
5. inspected actual runtime hardening, resource limits, and host port bindings;
6. connected from Core to both TLS control adapters and verified the expected framework identities;
7. reached Caddy over HTTPS and verified HTTP/2, status 200, and HSTS;
8. restarted the complete stack and proved all five containers returned healthy;
9. removed all fixture containers, networks, volumes, secrets, certificates, and data.

The acceptance test uses random high host ports because the development host already has production-like listeners. The checked production manifest defaults remain host ports 80 and 443 only.

## Scope boundary

Phase 14.2 builds and proves the five-service Compose substrate. It does not register framework endpoints in Core, perform old-stack cutover, migrate production credentials, or mutate production volumes. Those remain later Phase 14 work packages and require their own evidence and approval gates.
