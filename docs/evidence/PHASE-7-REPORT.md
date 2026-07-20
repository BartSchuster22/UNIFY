# Phase 7 — Production Hardening and Governed Cutover Evidence

**Completion date:** 2026-07-20

**Repository:** `BartSchuster22/UNIFY`

**Release posture:** production read-only; no mutation domains enabled; legacy owner services retained

## Verdict

**Phase 7 is complete.** UNIFY has a hardened public edge and runtime, bounded performance and resilience controls, encrypted and rehearsed Gateway backup/restore, a fail-closed read-only production deployment, independently gated per-domain mutation activation and rollback, and machine-checked legacy-route retention controls.

No legacy service or route was deleted. The production Gateway was returned to `read-only` after the Chat canary exercise.

## Acceptance summary

| Work item | Result | Principal evidence |
|---|---|---|
| p7-2 Performance, resilience, security | PASS | Rate limiting, security headers, sensitive-path rejection, attachment validation, 10,000-resource pagination, performance smoke, dependency audit, SBOM, audit-chain verification, and clean runtime image scans |
| p7-3 Backup and restore | PASS | Encrypted PostgreSQL backup and isolated restore rehearsal with checksum, migration, table, and audit-chain verification |
| p7-4 Read-only production rollout | PASS | Healthy production stack, HTTPS edge, authenticated cutover status, no enabled domains, and fail-closed mutation rejection |
| p7-5 Per-domain activation and rollback | PASS | Plan evidence for all five domains and a real Chat-only activation followed by successful rollback |
| p7-6 Legacy-route controls | PASS | Five-domain machine-readable inventory; deletion prohibited; deprecation gates enforced |
| p7-7 Final QA and production verification | PASS | Canonical repository QA, production health, public HTTPS checks, and runtime hardening checks |

## p7-2 — Performance, resilience, and security

Implemented controls:

- fail-closed, fixed-window Gateway rate limiting with `429` and `Retry-After`;
- HSTS, CSP, frame denial, `nosniff`, strict referrer policy, restrictive permissions policy, and no-store API behavior;
- edge rejection for dotfiles and sensitive backup, archive, key, log, environment, and database paths;
- traversal-safe Chat attachment filenames, explicit MIME allowlist, active HTML/SVG rejection, Base64 validation, and size enforcement;
- deterministic 10,000-resource pagination test at the API boundary;
- configurable concurrency/performance smoke test with p50, p95, p99, throughput, failures, and enforced p95 budget;
- production dependency audit, CycloneDX SBOM generation, and audit-chain verification CLI;
- single-worker Gateway tests for predictable execution on the production VPS;
- upgraded Alpine runtime packages and removal of bundled runtime npm tooling where unnecessary.

Executed performance evidence:

```text
requests=1000
concurrency=50
failures=0
p50=72.24 ms
p95=123.18 ms
p99=188.97 ms
throughput=614.52 requests/sec
p95 budget=250 ms
```

Executed security evidence:

```text
pnpm audit --prod --audit-level high: no known vulnerabilities
unify-gateway:local: HIGH 0, CRITICAL 0
unify-uniui:local:  HIGH 0, CRITICAL 0
Audit chain verified: 72 events
```

## p7-3 — Encrypted backup and isolated restore

The Gateway backup contains a PostgreSQL custom-format dump and sanitized release metadata: Git revision, runtime image IDs, migration checksums, deployment mode, and resolved Compose configuration. It is encrypted with salted AES-256-CBC and PBKDF2 at 200,000 iterations. Encrypted artifacts and checksums use mode `0600`; temporary plaintext is removed on exit.

A real encrypted rehearsal backup was created outside source control and its SHA-256 checksum verified. The isolated restore rehearsal then:

- validated the encrypted artifact checksum;
- validated migration-source checksums;
- restored into a disposable PostgreSQL 16.6 container and volume;
- restored 22 tables and found 3 applied migrations;
- verified the 72-event audit chain;
- removed the disposable container, volume, and plaintext temporary material.

The live PostgreSQL container and volume were not attached or modified by the rehearsal. Operator instructions are in `docs/runbooks/BACKUP-RESTORE.md`.

## p7-4 — Read-only production rollout

The production overlay in `compose.production.yaml` enforces:

- `DEPLOYMENT_MODE=read-only` by default;
- no enabled mutation domains by default;
- loopback-only host exposure;
- Gateway as the browser API boundary;
- non-root containers, read-only root filesystems, all capabilities dropped, and `no-new-privileges`;
- healthy PostgreSQL, Gateway, UNIUI, Chat PWA, and Alerts PWA services;
- Caddy HTTPS routing with active upstream checks and sensitive-path rejection.

Authenticated runtime verification after rollback reported:

```json
{
  "mode": "read-only",
  "secureSessionCookie": true,
  "authenticatedUser": "admin",
  "enabledDomains": [],
  "disabledDomainExecute": {
    "status": 403,
    "error": "DEPLOYMENT_READ_ONLY"
  }
}
```

Public verification returned HTTPS `200` for UNIUI, `401` for anonymous cutover status, and `404` for `/.env`, with a valid public certificate and the required security headers.

## p7-5 — Per-domain activation and rollback

The `CutoverPolicy` and `scripts/cutover-domain.mjs` independently control:

- `profiles`;
- `dmm`;
- `worker`;
- `chat`;
- `memory-v4`.

Execution requires all of: `mutation-canary` mode, explicit domain enablement, and a syntactically valid written acceptance reference. Unknown domains, invalid modes, absent acceptance, and read-only execution fail closed.

Plan-only activation and rollback were exercised for all five domains. A real Chat-only canary was then activated with written rehearsal acceptance. Runtime status showed only `chat` enabled, while an execute request for another domain returned `403 MUTATION_DOMAIN_DISABLED`.

The real rollback removed Chat, returned the deployment to read-only mode, recreated and health-checked only the Gateway, and retained all legacy services and data. Sanitized cutover evidence is stored in ignored `artifacts/cutover/` files and is not committed.

## p7-6 — Legacy-route retention

`deploy/legacy-routes.json` inventories all five domains and keeps their legacy services and routes active. `pnpm legacy:check` fails if an expected domain/route is missing, service deletion becomes permitted, or deprecation controls are incomplete.

Deprecation requires written acceptance, shadow parity, canary and rollback evidence, consumer inventory, at least 14 stable days, and at least 90 days' removal notice. Deprecation is not service or data deletion. The automated check passed for five retained domains with deletion prohibited.

Operator instructions are in `docs/runbooks/PRODUCTION-CUTOVER.md`.

## p7-7 — Canonical QA and production state

The canonical QA gate covers:

```text
ESLint and workspace boundaries
TypeScript across all workspaces
Workspace tests
Production builds
Contract reproducibility
Legacy-route policy validation
Prettier formatting
```

The completed suite contained 73 passing tests at the final Phase 7 verification point:

| Workspace | Tests |
|---|---:|
| Auth client | 3 |
| Contracts | 3 |
| TypeScript SDK | 3 |
| Adapter SDK | 7 |
| Alerts PWA | 1 |
| Chat PWA | 1 |
| Gateway | 55 |
| UNIUI | 5 |

Production services were healthy after the real canary rollback: PostgreSQL, Gateway, UNIUI, Chat PWA, and Alerts PWA. Caddy was active and `https://uniui.aquiero.com/` returned `200`.

## Operational boundaries and remaining approvals

Phase 7 establishes the technical controls for gradual cutover; it does **not** approve mutation activation for any tenant domain or authorize deletion of a legacy service. Each future domain activation still requires its own current written acceptance, canary monitoring, and rollback authority. Legacy retirement remains a separate, explicitly approved procedure.

## Source-controlled artifacts

- `compose.production.yaml`
- `deploy/caddy/uniui-aquiero.caddy`
- `deploy/legacy-routes.json`
- `docs/runbooks/BACKUP-RESTORE.md`
- `docs/runbooks/PRODUCTION-CUTOVER.md`
- `scripts/backup-gateway.sh`
- `scripts/rehearse-restore.sh`
- `scripts/cutover-domain.mjs`
- `scripts/check-legacy-routes.mjs`
- `scripts/performance-smoke.mjs`
- `scripts/generate-sbom.mjs`
- Gateway cutover, rate-limit, audit verification, and attachment-hardening implementation and tests

Generated backups, SBOMs, and cutover evidence are deliberately ignored and remain outside the commit.
