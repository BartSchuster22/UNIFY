# UNIUI Memory & Knowledge Governed Surface

## Status

UNIUI exposes a permission-gated **Memory & knowledge** screen backed only by the governed Gateway
adapter at `/api/v1/memory/*`. MemoryV4 remains authoritative; UNIUI does not store, normalize or
silently substitute memory data.

The screen is visible only to named UNIFY users with `memory.read`. Editing actions are independently
gated by `memory.write`, `memory.promote` and `memory.admin`; Evidence requires `audit.read`.

## User surface

The surface provides:

- adapter readiness and pinned contract version;
- a descendant-scope selector, with Gateway rejecting sibling, ancestor and global escalation;
- visible-scope records, entities, relations and artifacts;
- governed record reading, full-text search and entity context;
- role, lifecycle, policy, version, scope, author, confidence, supersession and provenance evidence;
- record and entity creation/editing, plus relation and artifact creation under `memory.write`;
- promotion and canonical-role creation only under `memory.promote`;
- supersession and lifecycle transition only under `memory.admin`;
- authorized audit and retrieval evidence;
- responsive layouts, keyboard-operable controls and accessible success/error states.

Artifact URIs and source references are displayed as inert data. Record content is rendered as text,
never trusted HTML. Delete and finding-resolution controls are not exposed.

## Mutation governance

The browser never receives the MemoryV4 service token and never calls MemoryV4 directly. Each
mutation:

1. traverses an explicit allowlisted Gateway route;
2. carries the named-user session and CSRF proof;
3. receives a unique browser-generated idempotency key;
4. is confined by Gateway to the configured root or a descendant scope;
5. is delegated upstream with the named UNIFY actor;
6. uses `If-Match` for record/entity edits and record governance actions;
7. requires a durable reason for promotion, supersession and lifecycle transition;
8. produces Gateway audit evidence and MemoryV4 durable evidence.

The UI requires an explicit target/scope/effect confirmation immediately before submission. A `412`
version conflict is shown as a conflict and never retried as a blind overwrite.

## Truth and failure behavior

- Successful empty pages are labelled as authoritative empty results.
- Adapter, authorization, network, validation and contract failures remain visible; they are never
  converted into empty or successful states.
- Counts are labelled as the loaded visible-scope sample, not global usage totals.
- Capability and contract metadata come from MemoryV4 through Gateway.
- Unsupported permissions remove their controls rather than simulating a write.

## Routes used

The read surface uses the governed `GET /api/v1/memory/*` routes for status, capabilities, records,
entities, context, relations, artifacts, search, audit and retrieval evidence. The editor uses only:

```text
POST  /api/v1/memory/records
PATCH /api/v1/memory/records/{id}
POST  /api/v1/memory/records/{id}/promote
POST  /api/v1/memory/records/{id}/supersede
POST  /api/v1/memory/records/{id}/transition
POST  /api/v1/memory/entities
PATCH /api/v1/memory/entities/{entity_type}/{entity_id}
POST  /api/v1/memory/relations
POST  /api/v1/memory/artifacts
```

There is no generic proxy path.

## Source

```text
apps/uniui/src/MemoryView.tsx
apps/uniui/src/MemoryEditor.tsx
apps/uniui/src/MemoryView.test.tsx
apps/uniui/src/api.ts
apps/uniui/src/api.test.ts
apps/uniui/src/types.ts
apps/uniui/src/App.tsx
```

## Verification

```bash
pnpm --filter @aquiero/uniui test
pnpm --filter @aquiero/uniui typecheck
pnpm --filter @aquiero/uniui build
pnpm qa
```

Coverage includes permission gating, CSRF/idempotency/version/reason headers, record editing,
promotion gating, conflict handling, connected source status, scope propagation, reading/search,
entity context, evidence RBAC, source failure, truthful empty states and accessibility scanning.
