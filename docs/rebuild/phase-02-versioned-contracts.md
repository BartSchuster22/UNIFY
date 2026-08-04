# Phase 2 — Versioned Native Contracts

## Status

Complete. The contract source of truth is the TypeBox schema catalog and API manifest under `apps/core/src/contracts/v1`. The generated OpenAPI 3.1 artifact is committed at `apps/core/contracts/v1/openapi.json` and is checked for drift in tests.

## Contract surface

| Native domain | Operations |
|---|---:|
| Identity and authentication | 12 |
| Frameworks | 8 |
| Profiles | 8 |
| Models and providers | 6 |
| Work | 18 |
| Conversations | 12 |
| Notifications | 3 |
| Operations | 3 |
| Audit | 3 |
| **Total** | **73** |

The 73 operations occupy 56 versioned paths under `/core/v1`. The generated document publishes 134 schemas, 32 command-envelope schemas and 26 canonical ID kinds.

## Implemented decisions

### Versioning

- OpenAPI `3.1.0` with JSON Schema 2020-12 semantics.
- API base path `/core/v1`.
- Envelope discriminator `core.v1`.
- Command/event type names end in `.v1`.
- Breaking changes require a new major contract namespace.

### Strict schemas

- TypeBox is the sole runtime/type schema source for Core v1.
- Every object with declared properties has `additionalProperties: false`.
- Formats, lengths, enums, ranges, uniqueness and identifier patterns are explicit.
- Every published schema is compiled during tests.
- OpenAPI references are checked for resolution.
- Generated OpenAPI is compared byte-for-byte with source generation to prevent drift.

### Canonical IDs

- IDs use a resource prefix plus an uppercase Crockford ULID.
- Canonical IDs are immutable and independent of labels or framework-native references.
- ID kinds cover identity, framework, profile, model, work, conversation, notification, operation, audit and event resources.
- Framework-native references remain scoped attributes and never become global IDs.

### Commands and concurrency

- Non-authentication control mutations use command-specific envelopes.
- Each envelope carries contract version, canonical command ID, command type, idempotency key, issue time, target, optional expected resource version and strict payload.
- Accepted asynchronous commands return one canonical operation ID and replay status.
- Existing-resource mutations can require optimistic concurrency through `expectedResourceVersion`.
- Identity requests containing passwords, MFA codes or newly issued service credentials are synchronous strict schemas so secret material is not persisted in operation payloads.

### Error model

One redacted error format covers authentication, authorization, CSRF, rate limits, validation, not-found, concurrency, idempotency, unsupported capabilities, unavailable frameworks, failed preconditions, timeouts and internal failures. It includes stable code, status, safe message, request/correlation IDs, retryability, optional retry delay, field violations and operation ID.

### Hermes capability negotiation

The contract defines:

- protocol identity and protocol version;
- framework identity/version and capability-document version;
- issue/expiry timestamps and schema digest;
- capability names, semantic versions, operations, transports and constraints;
- distinct `supported` and `temporarily-unavailable` states;
- Core requirements with required/optional classification;
- effective capability intersection and explicit rejection reasons;
- accepted, degraded or rejected negotiation result.

The executable negotiation function never invents support: absent, stale, unavailable, version-incompatible or operation-incomplete capabilities are excluded.

### Authentication surface

Identity contracts cover login, logout, current principal, session listing/revocation, password change, MFA enrollment/confirmation/removal and service credential listing/one-time issuance/revocation. Cookie+CSRF and scoped bearer security schemes are explicit.

### Terminology isolation

Production contract tests reject historical application names and compatibility concepts from routes, operation IDs, schemas and descriptions. Public concepts are only the nine native Core domains.

## Files

```text
apps/core/
├── contracts/v1/openapi.json
├── scripts/generate-openapi.mjs
├── scripts/check-openapi.mjs
└── src/contracts/v1/
    ├── index.ts
    ├── primitives.ts
    ├── envelopes.ts
    ├── schemas.ts
    ├── capabilities.ts
    ├── api.ts
    └── contracts.test.ts
```

## Verification gates

- [x] All nine native domains have versioned APIs.
- [x] Authentication includes sessions, password, MFA and service credentials.
- [x] Canonical IDs are typed and validated.
- [x] Mutation command envelopes are command-specific and strict.
- [x] One redacted error format is used.
- [x] Hermes capability advertisement, requirements, negotiation and result schemas compile.
- [x] Executable negotiation excludes unsupported capabilities.
- [x] Every published schema compiles.
- [x] Every property-bearing object is closed.
- [x] OpenAPI references resolve.
- [x] Generated OpenAPI is current.
- [x] Historical application terminology is absent from production contracts.
