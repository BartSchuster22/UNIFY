# Governed Mutations

Phase 5 adds a single safety boundary for owner-authoritative writes:

```text
POST /api/v1/mutations
GET  /api/v1/chat/download?path=/uploads/<safe-name>
```

The Gateway does not duplicate owner state. It validates policy and delegates to Agency/Hermes, DMM, Worker, Chat, or MemoryV4.

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
| Worker | project create/update/start/stop/delete | `work.manage`; delete also requires confirmation |
| Worker | task create/comment/start/move/block/unblock/complete | `work.manage` |
| Worker | cron create/run/pause/resume/delete | `work.manage`; delete also requires confirmation |
| Chat | message send and upload | `chat.use` |
| MemoryV4 | restricted record write | `memory.write` |

Agency remains authoritative for profile capabilities, protected-profile policy, inactive/stopped runtime requirements, and post-delete verification. Worker remains the only Kanban/scheduler writer.

## Memory allowlist

The Gateway permits only:

| Role | Lifecycle |
|---|---|
| `active` | `working` |
| `evidence` | `working` |
| `evidence` | `live` |

Canonical, exhaust, superseded, archived, expired, and unrelated `active/live` writes fail with `403 MEMORY_WRITE_DENIED` before contacting MemoryV4.

## Chat file controls

Uploads are base64 payloads with valid encoding and a decoded maximum of 10 MiB. The mutation endpoint has a route-specific 15 MiB request limit to accommodate base64 expansion.

Downloads:

- require an authenticated session and `chat.read`;
- accept only `/uploads/[a-zA-Z0-9._-]+`;
- proxy through the authenticated Gateway;
- reject content over 10 MiB using both header and actual-body checks;
- return `Cache-Control: private, no-store` and a safe attachment filename.

## Owner configuration

Mutation execution fails closed unless all owner settings are present. Compose supplies secret values through mounted files and the Gateway's existing secret-loading adapter.

| Setting | Purpose |
|---|---|
| `AGENCY_URL`, `AGENCY_USERNAME`, `AGENCY_PASSWORD` | Agency session and Hermes-control delegation |
| `DMM_URL`, `DMM_USERNAME`, `DMM_PASSWORD` | DMM session and CSRF-protected credentials API |
| `WORKER_URL`, `WORKER_TOKEN` | Worker bearer-authenticated writes |
| `CHAT_URL`, `CHAT_PASSWORD` | Chat session, messages, uploads, and downloads |
| `MEMORY_V4_URL`, `MEMORY_V4_TOKEN` | restricted Memory record writes |

Never place these values in browser configuration, retained evidence, documentation, or logs.

## SDK and UNIUI

The TypeScript SDK exposes `executeMutation(body, idempotencyKey)` and `downloadChatUpload(path)`. UNIUI exposes permission-filtered **Safety actions** presets with validate, dry-run, and execute modes, JSON payload editing, destructive confirmation, Chat file selection, operation state, and result rendering.
