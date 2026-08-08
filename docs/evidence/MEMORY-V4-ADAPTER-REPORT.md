# MemoryV4 Adapter Acceptance Evidence

Date: 2026-08-08

## Boundary

UNIFY Gateway now has one dedicated MemoryV4 adapter. The retired generic integration,
resource federation, migration reader, fallback, shadow comparison, and owner-client
runtime remain absent. MemoryV4 is external memory truth and is not a UNIFY
`ResourceRef.owner`.

## Automated acceptance

`pnpm qa` passed after the adapter implementation and generated-contract refresh. It
included:

- ESLint, workspace boundaries, standalone-runtime guard, and image/Compose static
  security checks;
- TypeScript type checking for all workspaces;
- all repository tests, including 76 Gateway tests across 13 files;
- production builds for Core, Gateway, Hermes adapter, UNIUI, Chat, and Alerts;
- reproducible OpenAPI/TypeScript contracts;
- standalone, backup-retention, identity-capacity, canary, and formatting checks; and
- `docker compose config -q` plus `git diff --check`.

MemoryV4 independently passed Ruff, 52 Pytest cases, `make qa`, Compose validation,
and `git diff --check`. Its QA10 score remains truthfully partial because Gate 4 and
later non-adapter capabilities are outside this phase.

## Live container acceptance

The compiled UNIFY Gateway adapter was exercised against a fresh
`memoryv4-core:phase6` container using a temporary delegated service grant and a
fresh SQLite volume. The test used loopback transport only and removed the temporary
credential and runtime artifacts afterward.

Observed result:

```json
{
  "status": "ok",
  "contract": "1.0.0",
  "created_status": 201,
  "delegated_actor": "unify:user-smoke",
  "scope": "org:a/project:unify",
  "replayed": "true",
  "readback": true,
  "search_hits": 1,
  "retrieval_evidence": 1,
  "audit_evidence": 1,
  "sibling_scope_denied": true,
  "arbitrary_path_denied": true
}
```

This proves contract negotiation, configured-scope injection, delegated named-user
attribution, idempotent replay, authoritative readback, retrieval, retrieval evidence,
memory audit evidence, local scope-escalation denial, and arbitrary-path denial.

## Production admission

Production remains opt-in. Configure an HTTPS MemoryV4 origin, a non-global maximum
scope, and a file-mounted least-privilege token with actor delegation enabled. A
successful authenticated `GET /api/v1/memory/status` is required before exposing
memory functionality to operators. This phase does not deploy the adapter, mutate
MemoryV3, or perform a memory cutover.
