# Governed MemoryV4 Adapter

## Status

The Gateway has one dedicated, optional MemoryV4 adapter. It is the only supported
UNIFY connection to governed external memory. It does **not** restore the retired
generic federation layer, `ResourceRef.owner = memory-v4`, migration readers, dual
writes, or fallback behavior.

MemoryV4 remains authoritative for memory entities, records, relations, artifacts,
review findings, retrieval evidence, and memory audit. UNIFY remains authoritative
for named-user authentication, RBAC, CSRF, Gateway audit, and whether a request may
cross the adapter boundary.

The pinned upstream contract is `1.0.0`.

## Public Gateway surface

The adapter is mounted at `/api/v1/memory/*`. The suffix maps exactly to the
allowlisted MemoryV4 endpoint; arbitrary proxy paths and `DELETE` are rejected.

| Gateway path/method | UNIFY permission | Upstream operation |
|---|---|---|
| `GET /status` | `memory.read` | authenticated capability/contract probe |
| `GET /capabilities`, `/schema` | `memory.read` | contract discovery |
| `GET /entities[/{type}/{id}]` | `memory.read` | entity read |
| `GET /records[/{id}]` | `memory.read` | record read |
| `GET /relations`, `/artifacts`, `/context/{type}/{id}` | `memory.read` | governed context read |
| `GET /search` | `memory.read` | retrieval with MemoryV4 retrieval evidence |
| `POST /entities`, `/records`, `/relations`, `/artifacts` | `memory.write` | idempotent create |
| `PATCH /entities/{type}/{id}`, `/records/{id}` | `memory.write` | versioned idempotent edit |
| `POST /records/{id}/promote` | `memory.promote` | governed promotion |
| `POST /records/{id}/supersede`, `/transition` | `memory.admin` | lifecycle administration |
| `GET /review/findings`, `POST /review/findings/{id}/resolve` | `memory.admin` | review administration |
| `GET /audit/events`, `/retrieval-events` | `audit.read` | memory evidence read |
| `GET /usage` | `memory.admin` | scoped usage |

Mutation requests require the normal UNIFY session cookie, matching CSRF header and
cookie, the exact RBAC permission, and `Idempotency-Key`. `If-Match` and
`X-MemoryV4-Reason` are preserved where the upstream operation requires them.

## Identity and scope

The Gateway never forwards browser credentials to MemoryV4. It uses one server-side
service credential with MemoryV4 actor delegation enabled and sends the stable actor
`unify:{UNIFY user UUID}`. The service token is read from a file and is never returned,
logged, or included in Gateway audit metadata.

`MEMORY_V4_SCOPE_PATH` is the maximum authority of this UNIFY deployment. The adapter:

1. injects this scope when a scoped read or create omits `scope_path`;
2. permits only the configured scope or its descendants;
3. rejects ancestor, sibling, malformed, and caller-selected global scopes before any
   network request; and
4. relies on the MemoryV4 grant as a second independent scope check.

Use a non-global deployment scope in multi-tenant environments.

## Contract and failure policy

- Every upstream response must be bounded JSON and carry
  `X-MemoryV4-Contract-Version: 1.0.0`.
- Redirects, invalid JSON, missing/wrong contract headers, and malformed error
  envelopes fail closed.
- Network failures and upstream 5xx responses become redacted, retryable 503 errors.
- Reads and idempotent writes may be retried with bounded exponential delay; ambiguous
  non-idempotent writes are never retried.
- Repeated retryable failures open a bounded circuit breaker.
- Upstream 4xx contract codes are preserved without exposing URLs, tokens, stack
  traces, or internal storage details.
- Source unavailability is never represented as an empty successful result.

## Configuration

The adapter is disabled unless both URL and scope are configured:

```text
MEMORY_V4_URL=https://memoryv4.internal.example
MEMORY_V4_SCOPE_PATH=tenant:example
MEMORY_V4_TOKEN_FILE=/run/secrets/memory_v4_token
MEMORY_V4_ALLOW_PRIVATE_HTTP=false
MEMORY_V4_TIMEOUT_MS=8000
MEMORY_V4_MAX_RESPONSE_BYTES=16777216
MEMORY_V4_RETRIES=1
```

The URL must be a bare HTTP(S) origin with no embedded credentials, path, query, or
fragment. Production should use private networking and TLS. The default rejects non-loopback HTTP;
`MEMORY_V4_ALLOW_PRIVATE_HTTP=true` is permitted only when both services share a Docker network
marked `internal: true`. The MemoryV4 grant must have `allow_actor_delegation=true`, the same or
narrower scope, and only the permissions required by the enabled UNIFY roles.

## Verification

```bash
pnpm --filter @aquiero/gateway test
pnpm --filter @aquiero/gateway typecheck
pnpm standalone:check
pnpm qa
```

Contract, scope, delegated identity, credential isolation, permission, CSRF,
idempotency, retry, error, and arbitrary-path denial are automated in
`apps/gateway/src/memory-v4/*.test.ts`.
