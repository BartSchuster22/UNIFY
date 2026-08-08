# UNIUI Memory & Knowledge Acceptance Evidence

**Date:** 2026-08-08

**Repository:** `UNIFY`

**Branch:** `rebuild/standalone-core-v1`

## Accepted boundary

The Phase 8 UNIUI surface is read-only and uses only the governed Gateway adapter at
`/api/v1/memory/*`. MemoryV4 remains the authoritative data owner. The browser receives
neither a MemoryV4 service token nor a direct MemoryV4 URL.

The screen is hidden without `memory.read`; MemoryV4 evidence is additionally hidden
without `audit.read`. A descendant-scope selector propagates `scope_path` on governed
collection, search and evidence reads. Scope escalation remains rejected by the Gateway
adapter.

## Automated verification

The repository-wide acceptance command completed successfully:

```text
pnpm qa
exit: 0
```

This includes lint, workspace type checking, all workspace tests, production builds,
contract reproducibility, standalone-boundary checks, backup-retention self-test,
identity-capacity self-test, production-canary self-test and repository formatting.

The focused UNIUI suite completed with:

```text
Test Files  7 passed (7)
Tests       30 passed (30)
```

The eight MemoryView tests cover:

- connected source and pinned contract presentation;
- GET-only browser transport and absence of write controls;
- record reader and inert source/provenance evidence;
- search and governed filters;
- entity context;
- descendant-scope propagation;
- evidence RBAC;
- distinct loading, authoritative empty and unavailable-source states;
- an axe-core accessibility scan.

## Live integration smoke

An isolated stack was built from the working tree and exercised against a real MemoryV4
container, migrated PostgreSQL, Gateway, named administrator session and production
UNIUI image. It did not use or create a real UNIFY project.

The headless Chromium flow performed:

1. named-user login through UNIUI;
2. permission-gated navigation to **Memory & knowledge**;
3. descendant scope selection (`org:a/project:unify`);
4. rendering of a real governed record;
5. record-reader navigation;
6. real MemoryV4 full-text search;
7. authorized audit-evidence rendering;
8. capture and inspection of all browser MemoryV4 requests.

Observed result:

```json
{
  "result": "pass",
  "title": "UNIFY Operator Console",
  "memoryRequests": 15,
  "scopedRequests": 7,
  "memoryWriteRequests": 0
}
```

The production UNIUI container and MemoryV4 smoke container were also inspected:

```text
UNIUI user: 65532:65532
UNIUI read-only root filesystem: true
UNIUI dropped capabilities: ALL
UNIUI no-new-privileges: true

MemoryV4 read-only root filesystem: true
MemoryV4 dropped capabilities: ALL
MemoryV4 no-new-privileges: true
```

## Result

**PASS.** The UNIUI surface is permission-gated, scope-governed, truth-preserving,
read-only, covered by automated tests, production-buildable and verified through a real
browser-to-Gateway-to-MemoryV4 path.
