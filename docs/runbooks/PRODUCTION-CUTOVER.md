# Production Deployment and Rollback

## Release gates

Do not publish or deploy an image until these commands pass from a clean checkout:

```bash
pnpm install --frozen-lockfile
pnpm qa
pnpm image:verify
```

`image:verify` builds every production image, enforces size and metadata limits, starts the operator UI under the production security restrictions, proves health and graceful shutdown, creates CycloneDX SBOMs, and rejects fixable HIGH or CRITICAL vulnerabilities.

Archive `artifacts/sbom/*.cdx.json` with the release evidence.

## Build and identify immutable artifacts

```bash
pnpm compose:secrets
docker compose -f compose.yaml -f compose.production.yaml config --quiet
docker compose -f compose.yaml -f compose.production.yaml build \
  gateway uniui chat-pwa alerts-pwa

docker image inspect --format '{{.Id}}' unify-gateway:local
```

Registry publication must use immutable content digests. Never deploy a floating tag. Record the Git commit, image digest, SBOM, scan result, and approver in the release manifest.

## Deploy

```bash
docker compose -f compose.yaml -f compose.production.yaml up -d --wait \
  postgres migrate gateway uniui chat-pwa alerts-pwa

docker compose -f compose.yaml -f compose.production.yaml ps
```

The tracked Compose configuration enforces:

- non-root UID/GID `65532:65532` for application containers;
- read-only root filesystems;
- all Linux capabilities dropped;
- `no-new-privileges`;
- bounded CPU, memory, and PID use;
- health-dependent startup;
- graceful `SIGTERM` shutdown deadlines.

Validate the edge configuration before any Caddy reload:

```bash
sudo install -o root -g root -m 0644 deploy/caddy/uniui-aquiero.caddy \
  /etc/caddy/Caddyfile.d/uniui.caddy
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

## Post-deployment checks

Verify:

1. every long-running service reports healthy;
2. readiness exposes the expected release ID;
3. named-user login, CSRF, and authorization work;
4. Core conversation and work reads succeed;
5. registered Hermes framework reads retain exact framework provenance;
6. no retired service credential or route exists;
7. container restart counts and resource use remain within policy.

## Rollback

Rollback means deploying the previous approved immutable image digest and its matching Compose/release manifest:

1. preserve current logs and database backup evidence;
2. replace image references with the previous approved digests;
3. run `docker compose config --quiet`;
4. recreate application containers without deleting PostgreSQL volumes;
5. wait for health checks;
6. verify release ID, authentication, native reads, and governed operations.

Rollback never restores Agency, DMM, Worker, `/CHAT`, MemoryV4, a legacy adapter, or a second writer/consumer.
