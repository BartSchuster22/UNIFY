# Phase 15 — UNIFY Web ALICA-v1 Deployment Evidence

## Result

**PASS — accepted in production on 2026-08-06 UTC.**

The existing React/Mantine UNIFY operator experience is now deployed on ALICA-v1 as a separately managed, hardened `unify-web` container. `uniui.aquiero.com` resolves to ALICA-v1, is served by the accepted containerized Caddy ingress, and reaches UNIFY Core only through the Web server's same-origin `/api/v1/*` proxy.

The prior UI route and container on `188.245.221.1` were retired only after public DNS, TLS, UI, authenticated API, framework inventory, restart, and QA10 acceptance passed. Its definitions and image/container inspections were archived rather than destroyed.

No secret values, private keys, passwords, connection strings, cookies, or bearer tokens are recorded here.

## Release identity

| Attribute | Accepted value |
|---|---|
| Source commit | `56e451bb836efb3feb6ba9d5e0c8bf089692a426` |
| Platform release | `phase-15.0-56e451bb836e` |
| Public UI | `https://uniui.aquiero.com` |
| ALICA-v1 address | `167.233.135.142` |
| Compose project | `unify-web` |
| Container | `unify-web-unify-web-1` |
| UI image | `localhost:5000/unify/web@sha256:099c5ed58b91e1b4633176fba9f5ed1bd46e7b2ea7c14a55b20b1c3df85799d1` |
| Caddy image | `localhost:5000/unify/caddy@sha256:c3f0e3c01e057a2a1c50a4791e13bc80d3e2a0159162269596e5cfa013c40a2f` |
| Production source | `/opt/unify-phase15-source/56e451bb836efb3feb6ba9d5e0c8bf089692a426` |
| Web deployment | `/opt/unify-web/releases/phase-15.0-56e451bb836e` |
| Evidence | `/opt/unify/evidence/phase15-unify-web-20260806T160021Z` |

## Architecture accepted

```text
Browser
  -> HTTPS uniui.aquiero.com
  -> unify-caddy-1
  -> unify-web-unify-web-1:3000
       -> same-origin /api/v1/* proxy
       -> unify-unify-core-1:8080
       -> governed registered Hermes frameworks
```

UNIFY Web:

- is a separate one-service Compose project;
- joins only `unify_unify-ingress`;
- publishes no host port;
- mounts no secret, framework data, database, or Docker socket;
- runs as `65532:65532`;
- uses a read-only root filesystem;
- drops all Linux capabilities and enables `no-new-privileges`;
- proxies only `/api/v1/*` to Core;
- has no direct route to Alica, Herman, or PostgreSQL.

The accepted five-service Core topology remains independently managed by the `unify` project. Total application steady state is now six containers: five Core/platform containers plus one separately managed Web container.

## Pre-deployment protection

Before mutation:

- production Core readiness passed;
- all five existing platform services were healthy;
- the existing ingress network and release definitions were inventoried;
- QA10 passed;
- a fresh encrypted backup was created and checksum-verified:
  - `/opt/unify/backups/gateway-20260806T160021Z.tar.enc`;
- current definitions and inspections were archived at:
  - `/opt/unify/rollback/phase15-web-precutover-20260806T160021Z`.

The initial installer invocation from a Git archive stopped before activation because the immutable commit had not been supplied to the archive-based installer process. Production remained on Phase 14.6. The supported `UNIFY_GIT_COMMIT=56e451bb836efb3feb6ba9d5e0c8bf089692a426` input was then supplied. The installer completed normally and accepted the new release. No overlapping installer was started.

## Build and repository verification

The following passed:

- UNIFY Web Compose and image security contract;
- five-service Compose static/security contract with the Web origin and Caddy route;
- UniUI type check, tests, and production Vite build;
- production container execution against a controlled Core fixture;
- SPA shell and asset delivery;
- same-origin API proxy and `Set-Cookie` forwarding;
- security headers and graceful SIGTERM shutdown;
- repository `pnpm qa` with exit code `0`;
- exact Git remote equality after commit `56e451bb836efb3feb6ba9d5e0c8bf089692a426`.

Production image verification also passed with exit code `0`: it built the pinned production images, enforced image-size/non-root/health contracts, generated CycloneDX SBOMs, and found no fixed HIGH/CRITICAL vulnerabilities.

The Vite output reported a non-blocking optimization warning for a JavaScript chunk larger than 500 kB; the build itself passed.

## Private production acceptance

Before DNS changed, the production Web container passed:

```text
spa=PASS
assetBytes=567951
coreProxy=PASS
authentication=PASS
frameworks=PASS
release=phase-15.0-56e451bb836e
```

The hardening inspection reported:

```text
user=65532:65532
readonly=true
caps=["ALL"]
ports={}
health=healthy
networks=unify_unify-ingress
```

The platform installer returned:

```json
{"schemaVersion":"unify-installer-result/v1","mode":"verify","releaseId":"phase-15.0-56e451bb836e","changed":false,"project":"unify","status":"PASS"}
```

Core/Hermes QA10 also passed after the platform upgrade.

## Public DNS and TLS acceptance

The accepted DNS state is:

```text
uniui.aquiero.com.  A  167.233.135.142
```

No `AAAA` record was introduced.

The public certificate reported:

- subject/SAN: `uniui.aquiero.com`;
- issuer: Let's Encrypt `YE1`;
- validity: 2026-08-06 through 2026-11-04;
- SHA-256 fingerprint: `65:51:8B:B1:BE:CB:E8:6F:F7:8E:41:42:D2:DF:41:61:5E:A1:1F:6E:6D:F2:40:80:0F:38:0C:A5:CF:58:AF:A4`.

Public checks passed for:

- HTTP/2 `200` UI response;
- `/healthz` and `/api/v1/health/ready`;
- production asset `/assets/index-DVU3QwPi.js`;
- valid certificate identity;
- HSTS;
- CSP;
- `X-Content-Type-Options: nosniff`;
- `X-Frame-Options: DENY`;
- no-store HTML response;
- login as the production administrator;
- session-cookie and CSRF issuance;
- authenticated identity;
- exact framework inventory `hermes-alica` and `hermes-herman`;
- full public QA10.

## Restart and convergence acceptance

After public activation:

1. `unify-web-unify-web-1` was independently restarted.
2. Its health returned to `healthy`.
3. Public UI and Core readiness passed.
4. `unify-caddy-1` was independently restarted.
5. Its health returned to `healthy` with retained certificate state.
6. Public UI passed again.
7. Full QA10 through `https://uniui.aquiero.com` passed again.

The temporary release-registry container was then removed. Registry storage, immutable images, release inputs, backups, and rollback evidence were retained.

## Prior UI retirement

Retirement occurred only after all public acceptance and restart gates passed.

On the prior host `188.245.221.1`:

- `/etc/caddy/Caddyfile.d/uniui.caddy` was checksummed and removed from the active Caddy import path;
- the remaining host Caddy configuration validated and reloaded successfully;
- `unify-uniui-1` was stopped;
- the old UI listener on `127.0.0.1:3000` was absent;
- unrelated Caddy sites and services remained active;
- the new public UI was rechecked after retirement.

Retained rollback/archive assets:

```text
/opt/unify-retired/phase15-old-uniui-20260806T194309Z
```

The archive contains the old Compose definition, Caddy site, container inspection, image inspection, and SHA-256 checksums. The old container record and image are retained for rollback; they were not destructively pruned.

## Production evidence integrity

ALICA-v1 evidence is stored at:

```text
/opt/unify/evidence/phase15-unify-web-20260806T160021Z
```

The directory is root-owned mode `0700`. Its `SHA256SUMS` manifest covers ten evidence files and passed `sha256sum -c`.

## Rollback

If rollback is authorized:

1. restore the DNS `A` record to `188.245.221.1`;
2. restore the archived old `uniui.caddy` file to `/etc/caddy/Caddyfile.d/uniui.caddy` and validate/reload Caddy;
3. start the retained `unify-uniui-1` container;
4. stop the ALICA-v1 `unify-web` project;
5. if necessary, use the accepted five-service installer rollback to the retained Phase 14.6 release;
6. verify public UI, Core readiness, and QA10.

No database migration or framework-data mutation was introduced by Phase 15.
