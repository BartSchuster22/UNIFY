# Governed Mutations

Phase 5 adds a single safety boundary for owner-authoritative writes:

```text
POST /api/v1/mutations
```

The Gateway does not duplicate owner state. It validates policy and delegates retained migration operations to their declared owner. Native work and conversation APIs supersede the old Worker and Chat mutation surfaces.

## Required controls

Every mutation requires:

1. an authenticated named-user session;
2. a valid `X-CSRF-Token` matching the session cookie;
3. the operation-specific permission;
4. an `Idempotency-Key` of at most 200 characters;
5. an operation type whose owner and resource kind match the target;
6. operation-specific payload validation;
7. `confirmed: true` for destructive execution;
8. durable operation, audit, and recursively redacted evidence records.

`validate` performs local contract and policy validation. `dry-run` delegates only where the owner has an authoritative dry-run API; otherwise it returns a truthful local preflight result and does not call the owner. `execute` performs the authoritative owner request.

Confirmation is required only for `execute`; destructive validation and dry-run remain available without pretending that execution was approved.

## Idempotency

The operation claim is scoped to actor, operation type, and idempotency key. The request hash covers the canonical target, payload, mode, and confirmation value.

- same key and same request: returns the existing operation with `replayed: true`;
- same key and different request: `409 IDEMPOTENCY_CONFLICT`;
- missing key: `400 IDEMPOTENCY_KEY_REQUIRED`.

Owner responses are retained only after recursive secret redaction. Keys such as credential, authorization, password, token, secret, API key, cookie, and private key are replaced with `[REDACTED]`.

## Operation catalog

| Owner | Operations | Permission |
|---|---|---|
| Hermes via Agency | profile create, identity update, model update, runtime start/stop/restart | `profiles.manage` or `models.manage` |
| Hermes via Agency | protected profile delete | `profiles.delete` + confirmation |
| DMM | credential save, validate, delete | `credentials.manage`; delete also requires confirmation |
| Hermes execution adapter | retained work execution commands | `work.manage` |
| MemoryV4 | restricted record write | `memory.write` |

The native Core services are authoritative for profiles, work state, and conversation state. Framework adapters execute selected runtime actions without becoming a second state writer.

## Memory allowlist

The Gateway permits only:

| Role | Lifecycle |
|---|---|
| `active` | `working` |
| `evidence` | `working` |
| `evidence` | `live` |

Canonical, exhaust, superseded, archived, expired, and unrelated `active/live` writes fail with `403 MEMORY_WRITE_DENIED` before contacting MemoryV4.

## Native conversation files

The legacy Chat upload/download proxy is retired. Attachments use the authenticated native Core attachment API, canonical attachment IDs, stored SHA-256 verification, owner-scoped authorization, and basename-only filenames. Caller-supplied filesystem paths are not accepted.

## Owner configuration

Mutation execution fails closed unless all owner settings are present. Compose supplies secret values through mounted files and the Gateway's existing secret-loading adapter.

| Setting | Purpose |
|---|---|
| `AGENCY_URL`, `AGENCY_USERNAME`, `AGENCY_PASSWORD` | Agency session and Hermes-control delegation |
| `DMM_URL`, `DMM_USERNAME`, `DMM_PASSWORD` | DMM session and CSRF-protected credentials API |
| `MEMORY_V4_URL`, `MEMORY_V4_TOKEN` | restricted Memory record writes |

Never place these values in browser configuration, retained evidence, documentation, or logs.

## SDK and UNIUI

The TypeScript SDK exposes `executeMutation(body, idempotencyKey)` for retained governed mutations. Conversation sessions, messages, attachments, channels, and events use the generated native Core SDK. UNIUI must not call a legacy Chat download or mutation route.
