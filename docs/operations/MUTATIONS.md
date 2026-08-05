# Governed Framework Operations

`POST /api/v1/mutations` is the authenticated safety boundary for retained Hermes framework operations. It does not proxy or delegate to Agency, DMM, Worker, `/CHAT`, MemoryV4, or another owner client.

Native Core APIs, rather than this generic operation endpoint, own profile state, work state, conversations, messages, routing, and attachments. The framework operation endpoint is reserved for supported Hermes control actions that require durable governance evidence.

## Required controls

Every operation requires:

1. an authenticated named-user session;
2. a valid `X-CSRF-Token`;
3. the operation-specific permission;
4. an `Idempotency-Key` of at most 200 characters;
5. a target with `owner: hermes` and an exact framework context;
6. operation-specific payload validation;
7. `confirmed: true` for destructive execution;
8. durable operation, audit, and recursively redacted evidence records.

`validate` performs contract and policy validation. `dry-run` calls only an advertised Hermes control capability. `execute` calls the registered Hermes framework endpoint and records the result. Unsupported or unavailable capabilities fail truthfully; there is no fallback owner.

## Idempotency and evidence

The claim is scoped to actor, operation type, and idempotency key. The request hash covers the exact target, payload, mode, and confirmation value.

- same key and request: return the durable operation with `replayed: true`;
- same key and different request: `409 IDEMPOTENCY_CONFLICT`;
- missing key: `400 IDEMPOTENCY_KEY_REQUIRED`.

Evidence is recursively redacted. Credential, authorization, password, token, secret, API-key, cookie, and private-key fields are never persisted in readable form.

## Runtime configuration

Framework connection information comes only from the Gateway framework registry and its scoped secret references. Compose does not accept Agency, DMM, Worker, `/CHAT`, or MemoryV4 URLs or credentials. Missing Hermes framework configuration fails closed.

## Native conversation files

Attachments use the authenticated native Core API, canonical attachment IDs, owner-scoped authorization, immutable content, basename-only filenames, and stored SHA-256 verification. Caller-supplied filesystem paths and proxy download URLs are rejected.

## SDK and UNIUI

The TypeScript SDK exposes `executeMutation(body, idempotencyKey)` for retained Hermes framework operations. Native profiles, work, conversations, messages, attachments, routing, and events use generated Core contracts. Browser code must not construct a retired owner or service URL.
