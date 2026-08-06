# UNIFY Web deployment

This is the separately managed UNIFY Web workload for ALICA-v1. The application source is `apps/uniui`; `Dockerfile.uniui` builds the production image.

## Security boundary

- one container and one external/internal network attachment;
- no published host ports;
- no database or Hermes framework network;
- no secrets, persistent data, or Docker socket;
- non-root, read-only, capabilities dropped, no-new-privileges, bounded resources;
- browser API calls remain same-origin and are proxied to UNIFY Core.

## Validate

```bash
node scripts/verify-unify-web-compose.mjs
```

## Render

```bash
cp deploy/unify-web/unify-web.env.example /secure/path/unify-web.env
# Replace the example image with the accepted digest.
docker compose \
  --env-file /secure/path/unify-web.env \
  -f deploy/unify-web/compose.yaml \
  config
```

## Start

Only after the existing `unify_unify-ingress` network and digest-pinned image have been verified:

```bash
docker compose \
  --env-file /secure/path/unify-web.env \
  -f deploy/unify-web/compose.yaml \
  -p unify-web up -d --wait
```

The container is intentionally not directly reachable from the host. The accepted containerized Caddy deployment must route the selected UI hostname to `unify-web:3000`.
