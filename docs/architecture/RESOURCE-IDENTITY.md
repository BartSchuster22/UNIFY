# Canonical Resource Identity and Mapping

> **HERMES-SOURCE-OF-TRUTH QUALIFICATION:** `agency`, `dmm`, `worker`, `chat`, and `memory-v4` values below are permitted only as legacy migration provenance. Current framework-domain resources use `owner: hermes` plus an exact `frameworkId`; Gateway access-plane records use `owner: gateway`.

## Goals

- Prevent collisions across Hermes instances and domain services.
- Never join by display label.
- Make mappings inspectable, versioned and auditable.
- Block writes when identity is stale, missing or ambiguous.

## Canonical identifier

The external `canonicalId` is an opaque, stable URN generated from structured components:

```text
urn:aquiero:<kind>:<owner>:<framework-segment>:<native-id-segment>
```

Segments are percent-encoded canonical UTF-8. Clients must not parse semantics from the URN; they use the structured `ResourceRef` fields. Canonical IDs are case-sensitive unless the owner's native contract explicitly declares otherwise.

## Resource reference

```ts
interface ResourceRef {
  canonicalId: string;
  kind: ResourceKind;
  owner: 'hermes' | 'agency' | 'dmm' | 'worker' | 'chat' | 'memory-v4' | 'gateway';
  frameworkId?: string;
  nativeId: string;
  displayLabel?: string;
  sourceVersion?: string;
  observedAt: string; // ISO 8601 UTC
  links?: Array<{ relation: string; canonicalId: string }>;
}
```

`displayLabel` is optional presentation data and never participates in equality, authorization or routing.

## Required compound identities

| Resource | Required identity |
|---|---|
| Framework | Gateway `frameworkId` mapped to the exact framework connection |
| Profile | `frameworkId + profileId` |
| Runtime agent | `frameworkId + runtimeAgentId` |
| Provider | `frameworkId + providerId` |
| Model | `frameworkId + providerId + modelId` |
| Project/board | `frameworkId + native board/project ID`, optionally mapped to Worker project ID |
| Task/card | `frameworkId + native card ID` |
| Native cron | `frameworkId + native cron ID` |
| Chat session | Chat-owned `sessionId` plus explicit framework/agent/surface-route references |
| Memory record | MemoryV4-owned `recordId` and `scopePath` |
| Gateway operation/audit/notification | Gateway-generated opaque ID |

## Mapping record

```ts
interface ResourceMapping {
  mappingId: string;
  source: ResourceRef;
  target: ResourceRef;
  relation: 'same_resource' | 'managed_by' | 'runtime_of' | 'project_board' | 'chat_for' | 'memory_scope_for';
  state: 'current' | 'stale' | 'ambiguous' | 'missing' | 'revoked';
  sourceVersion?: string;
  targetVersion?: string;
  observedAt: string;
  expiresAt?: string;
  evidenceIds: string[];
}
```

## Mapping rules

1. Exact native identifiers and declared framework context are required.
2. A display-name match may be shown as an unconfirmed candidate but never stored as `current` without authoritative evidence.
3. Conflicting current mappings become `ambiguous` and block mutation.
4. Expired or source-version-mismatched mappings become `stale` and read-only.
5. Mapping changes create audit records with before/after metadata and evidence references.
6. Delete verification checks the exact canonical resource and authoritative collection readback.
7. Multi-framework collision fixtures must include identical native profile, agent, model, project, task and cron IDs under different framework IDs.

## API behavior

- Responses return the structured resource reference.
- Paths containing framework-native resources include framework context.
- Authorization evaluates canonical kind, owner, framework scope and native target.
- Idempotency scope includes actor, operation type, owner, canonical target and payload hash.
- The UI displays human-friendly labels alongside copyable canonical IDs and source metadata.
