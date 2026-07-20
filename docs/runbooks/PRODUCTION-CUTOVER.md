# Production Rollout and Domain Cutover

## Safety model

UNIFY starts **read-only**. The Gateway is the only public API boundary and legacy owner services remain deployed. A domain can execute only when all three controls agree:

1. `DEPLOYMENT_MODE=mutation-canary`;
2. the domain is present in `MUTATION_DOMAINS`;
3. `MUTATION_ACCEPTANCE_REFS` contains a syntactically valid written acceptance reference for that domain.

Supported independent domains are `profiles`, `dmm`, `worker`, `chat`, and `memory-v4`. Validation and dry-run remain available when execution is disabled. Unknown modes/domains, enabled domains without acceptance, and execute requests in read-only mode fail closed.

## Read-only production deployment

```bash
pnpm compose:secrets
docker compose -f compose.yaml -f compose.production.yaml config --quiet
docker compose build gateway uniui chat-pwa alerts-pwa
docker compose -f compose.yaml -f compose.production.yaml \
  up -d --wait postgres gateway uniui chat-pwa alerts-pwa
```

Install and validate the tracked edge rule before reload:

```bash
sudo install -o root -g root -m 0644 deploy/caddy/uniui-aquiero.caddy \
  /etc/caddy/Caddyfile.d/uniui.caddy
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Verify HTTPS, security headers, sensitive-path rejection, anonymous API rejection, container health, and authenticated `GET /api/v1/cutover/status`. The expected initial state is `read-only`, no enabled domains, `legacyServicesRetained: true`, and a representative execute request rejected with `DEPLOYMENT_READ_ONLY`.

## Written acceptance checklist

A domain acceptance reference must resolve to evidence that records:

- named approver and timestamp;
- read/shadow parity and known differences;
- owner authentication and exact-target authorization;
- validate, dry-run, confirmation, idempotency, concurrency, readback, and audit results;
- owner outage and recovery behavior;
- successful rollback rehearsal;
- legacy consumers and public routes that remain active;
- monitoring owner and abort thresholds.

A generic milestone, ticket number without evidence, or verbal approval is not sufficient.

## Plan, activate, and inspect

Plan-only commands produce sanitized evidence without changing production:

```bash
node scripts/cutover-domain.mjs activate chat evidence/acceptance/chat-YYYY-MM-DD
node scripts/cutover-domain.mjs rollback chat
```

Activation is explicit:

```bash
node scripts/cutover-domain.mjs activate chat evidence/acceptance/chat-YYYY-MM-DD --apply
```

The script writes mode/domain/reference state under mode-`0600` `.secrets/`, recreates only Gateway with the production overlay, waits for health, and writes ignored evidence under `artifacts/cutover/`. It does not delete or stop a legacy service. Inspect authenticated cutover status and perform only the accepted canary/readback workflow.

## Rollback

At the first abort signal, remove only the affected domain:

```bash
node scripts/cutover-domain.mjs rollback chat --apply
```

Rollback recreates Gateway, waits for health, records before/after state, and preserves all owner services and data. If no domains remain, mode returns to `read-only`. Verify a representative execute returns `DEPLOYMENT_READ_ONLY`, reads still work, and the owner remains independently reachable.

## Legacy deprecation

`deploy/legacy-routes.json` is the machine-readable inventory. `pnpm legacy:check` fails if a domain or route is absent, service deletion becomes permitted, or deprecation lacks dates. Deprecation requires the checklist in that file, at least 14 stable days, and at least 90 days' removal notice. Deprecation is not deletion; data and services require a separate approved retirement procedure.
