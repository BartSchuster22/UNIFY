# Local Compose Runbook

This stack is a development and integration foundation. It binds Gateway, UNIUI, Chat, and Alerts only to loopback and does not mutate any legacy production service.

## Prerequisites

- Docker Engine with Compose v2
- Node.js and pnpm versions pinned by the repository
- Linux `setfacl` (`acl` package) for least-privilege bind-mounted secrets
- free loopback ports (defaults: Gateway `28081`, UNIUI `3000`, Chat `3101`, Alerts `3102`)

## Prepare secrets

```bash
pnpm compose:secrets
```

The command creates `.secrets/` with cryptographically random values and never prints them. Files remain owner-readable (`0600`); POSIX ACLs grant only container UID 70 access to the PostgreSQL password and container UID 10001 access to Gateway/bootstrap secrets. Use `--force` only when intentionally rotating a disposable local stack:

```bash
node scripts/prepare-compose-secrets.mjs --force
```

After rotation, remove the local database volume or rotate the database credential consistently. Never commit `.secrets/`.

The generated local secrets are limited to PostgreSQL, Gateway session/CSRF material, the bootstrap administrator, Hermes control, and the optional MemoryV4 adapter. The stack does not generate or mount credentials for retired upstream services.

## Optional MemoryV4 adapter

The adapter is disabled by default. To connect one governed MemoryV4 deployment,
replace `.secrets/memory_v4_token` with a delegated MemoryV4 service grant and start
Gateway with an explicit URL and maximum scope:

```bash
MEMORY_V4_URL=https://memoryv4.internal.example \
MEMORY_V4_SCOPE_PATH=tenant:example \
docker compose up -d --build gateway
```

Authenticate to Gateway as a named user with `memory.read`, then request
`GET /api/v1/memory/status`. A ready response proves authenticated reachability and
the pinned `1.0.0` contract. Do not use a public URL or a global grant for
a tenant deployment. Gateway startup fails closed if URL and scope are only partially
configured; upstream failures remain isolated to memory routes.

## Start and verify

```bash
pnpm compose:build
pnpm compose:up
curl --fail http://127.0.0.1:${GATEWAY_PORT:-28081}/api/v1/health/ready
curl --fail http://127.0.0.1:${UNIUI_PORT:-3000}/healthz
curl --fail http://127.0.0.1:${UNIUI_PORT:-3000}/api/v1/health/ready
curl --fail http://127.0.0.1:${CHAT_PWA_PORT:-3101}/healthz
curl --fail http://127.0.0.1:${ALERTS_PWA_PORT:-3102}/healthz
```

Override occupied ports without changing committed configuration:

```bash
GATEWAY_PORT=28080 UNIUI_PORT=28082 CHAT_PWA_PORT=28101 ALERTS_PWA_PORT=28102 \
  docker compose up -d --wait postgres gateway uniui chat-pwa alerts-pwa
```

The one-shot `migrate` service must exit successfully before Gateway starts. `docker compose ps -a` should report PostgreSQL, Gateway, UNIUI, Chat, and Alerts healthy and migration exit code 0.

## Bootstrap the first administrator

Run exactly once against a new database:

```bash
docker compose --profile bootstrap run --rm bootstrap-admin
```

It creates named user `admin` and fails closed if any user already exists. Obtain the generated local password directly from `.secrets/bootstrap_admin_password`; do not copy it to logs or shell history. Replace this bootstrap flow with the approved production secret manager and credential handoff procedure outside local development.

## Hardening assertions

- PostgreSQL runs as UID/GID 70; Gateway, UNIUI, Chat, and Alerts run as UID/GID 10001.
- Root filesystems are read-only; only declared volumes/tmpfs paths are writable.
- Every service drops all Linux capabilities and sets `no-new-privileges`.
- Database, Gateway, Hermes, and MemoryV4 secrets are mounted as files, not embedded in images or browser assets.
- Gateway and every web shell listen only on `127.0.0.1`; PostgreSQL is loopback-only in the local acceptance stack.
- Health checks cover PostgreSQL, Gateway readiness, UNIUI, Chat, and Alerts.
- Gateway and every web shell handle `SIGTERM`/`SIGINT` for graceful shutdown.

Inspect the active settings:

```bash
for service in postgres gateway uniui chat-pwa alerts-pwa; do
  id=$(docker compose ps -q "$service")
  docker inspect "$id" --format '{{.Name}} user={{json .Config.User}} readOnly={{.HostConfig.ReadonlyRootfs}} capDrop={{json .HostConfig.CapDrop}} security={{json .HostConfig.SecurityOpt}} health={{.State.Health.Status}}'
done
```

## Stop and reset

```bash
docker compose down --remove-orphans
docker compose down --volumes --remove-orphans # destructive local reset
```

Do not use `--volumes` against data that must be retained.
