# UNIUI Memory & Knowledge Read-Only Surface

## Status

UNIUI exposes a permission-gated, read-only **Memory & knowledge** screen backed only by
the governed Gateway adapter at `/api/v1/memory/*`. MemoryV4 remains authoritative.
UNIUI does not store, normalize, edit, promote, archive, delete, or silently substitute
memory data.

The screen is visible only to named UNIFY users with `memory.read`. The Evidence section
is separately visible only with `audit.read`.

## User surface

The surface provides:

- adapter readiness and pinned contract version;
- a descendant-scope selector that defaults to the configured adapter root while the
  Gateway rejects sibling, ancestor and global escalation;
- visible-scope sample counts for records, entities, relations and artifacts;
- governed record cards and a detailed record reader;
- role, lifecycle, write-policy, version, scope, author, confidence, entity,
  supersession, provenance and source-reference evidence;
- MemoryV4 full-text search with role and lifecycle filters;
- entity listing and contextual records, relations and artifacts;
- typed relation and artifact views;
- authorized MemoryV4 audit and retrieval evidence;
- responsive layouts, keyboard-operable controls and accessible status/error states;
- explicit refresh and cursor-based record pagination.

Artifact URIs and source references are displayed as inert data. They are not opened or
rendered as trusted HTML. Record content is rendered as text, never injected HTML.

## Truth and failure behavior

- A successful empty page is labelled as an authoritative empty result.
- Adapter, authorization, network and contract failures are shown as unavailable or
  forbidden; they are never converted into an empty result.
- Displayed counts are explicitly labelled as the currently loaded, visible-scope
  sample rather than global usage totals.
- Capability and contract metadata come from MemoryV4 through the Gateway.
- No direct MemoryV4 URL or credential reaches the browser.

## Read-only boundary

The implementation invokes only these Gateway GET routes:

```text
GET /api/v1/memory/status
GET /api/v1/memory/capabilities
GET /api/v1/memory/records
GET /api/v1/memory/entities
GET /api/v1/memory/context/{entity_type}/{entity_id}
GET /api/v1/memory/relations
GET /api/v1/memory/artifacts
GET /api/v1/memory/search
GET /api/v1/memory/audit/events       # audit.read only
GET /api/v1/memory/retrieval-events   # audit.read only
```

There are no UI mutation controls and no generic proxy path. Mutations remain outside
this read-only phase.

## Source

```text
apps/uniui/src/MemoryView.tsx
apps/uniui/src/MemoryView.test.tsx
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

Automated coverage includes permission gating, read-only transport, connected source
status, descendant-scope propagation, record reading, filtered search, entity context,
evidence RBAC, source failure, truthful empty states and accessibility scanning.
