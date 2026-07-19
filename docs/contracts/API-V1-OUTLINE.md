# Unified Gateway `/api/v1` Contract Outline

## Contract rules

- OpenAPI 3.1 is generated from the same schema source as runtime validation.
- All timestamps are ISO 8601 UTC.
- Potentially large collections use opaque cursor pagination.
- Requests have bounded timeouts and support cancellation.
- Errors use stable machine-readable codes and safe public messages.
- Every response carries provenance and truth metadata.
- Every meaningful write creates or advances a Gateway operation record.

## Resource surface

```text
/api/v1/auth/login
/api/v1/auth/logout
/api/v1/auth/me
/api/v1/auth/csrf
/api/v1/auth/refresh
/api/v1/auth/sessions
/api/v1/users
/api/v1/roles

/api/v1/frameworks
/api/v1/frameworks/{frameworkId}/health
/api/v1/frameworks/{frameworkId}/capabilities

/api/v1/providers
/api/v1/providers/{providerKey}
/api/v1/models
/api/v1/models/{modelKey}
/api/v1/catalog/snapshots
/api/v1/catalog/diffs

/api/v1/profiles
/api/v1/profiles/{frameworkId}/{profileId}
/api/v1/profiles/{frameworkId}/{profileId}/identity
/api/v1/profiles/{frameworkId}/{profileId}/model-routing
/api/v1/profiles/{frameworkId}/{profileId}/runtime
/api/v1/profiles/{frameworkId}/{profileId}/health
/api/v1/profiles/{frameworkId}/{profileId}/usage
/api/v1/agents

/api/v1/work/projects
/api/v1/work/projects/{projectKey}
/api/v1/work/tasks
/api/v1/work/tasks/{taskKey}
/api/v1/work/cronjobs
/api/v1/work/cronjobs/{cronKey}
/api/v1/work/approvals
/api/v1/work/rollback-plans

/api/v1/chat/agents
/api/v1/chat/sessions
/api/v1/chat/sessions/{sessionId}
/api/v1/chat/sessions/{sessionId}/messages
/api/v1/chat/uploads
/api/v1/chat/files/{fileId}

/api/v1/memory/records
/api/v1/memory/records/{recordId}
/api/v1/memory/search
/api/v1/memory/audit
/api/v1/memory/retrieval-events

/api/v1/operations
/api/v1/operations/{operationId}
/api/v1/mutations
/api/v1/chat/download?path=/uploads/{safeName}
/api/v1/audit
/api/v1/notifications
/api/v1/search
/api/v1/events
/api/v1/realtime/status
/api/v1/settings
/api/v1/applications

/api/v1/health/live
/api/v1/health/ready
```

## Success shape

```json
{
  "data": {},
  "meta": {
    "requestId": "opaque",
    "correlationId": "opaque",
    "source": { "owner": "hermes", "frameworkId": "framework-opaque", "adapterId": "hermes-control" },
    "sourceStatus": "reachable",
    "freshness": "current",
    "observedAt": "2026-01-01T00:00:00Z",
    "generatedAt": "2026-01-01T00:00:00Z",
    "warnings": []
  }
}
```

## Error shape

```json
{
  "error": {
    "code": "stable_machine_code",
    "message": "Safe public message",
    "requestId": "opaque",
    "retryable": false,
    "target": { "canonicalId": "opaque" },
    "fields": [],
    "policyReasons": [],
    "evidenceId": "opaque"
  }
}
```

Stack traces, credentials, bearer tokens, raw secret-bearing payloads and unredacted downstream responses are never public.

## Operation record minimum

An operation includes ID, type, actor, exact target, canonical payload hash, mode, idempotency key, source version, policy decision, timestamps, state, downstream evidence references, safe before/after metadata and readback result.

States:

```text
pending -> validated -> preflighted -> awaiting_confirmation
        -> executing -> applied -> verifying -> verified
        -> denied | failed | inconclusive
        -> rolling_back -> rolled_back | rollback_failed
```

No realtime command channel is provided. Commands use authenticated HTTP operations; SSE/WS transports carry authorized events and stream data only.
