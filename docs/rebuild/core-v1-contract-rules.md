# UNIFY Core v1 Contract Rules

## Versioning

- HTTP base path: `/core/v1`.
- Envelope discriminator: `contractVersion: "core.v1"`.
- Event and command names end in `.v1`.
- Additive optional fields may be introduced within v1. Removing, renaming, changing meaning, narrowing accepted values, or changing an ID prefix requires v2.
- Unknown object properties are rejected at every API boundary.
- Unknown query parameters are rejected. List operations use bounded cursor pagination through `cursor` and `limit`.
- Every path parameter is validated against the canonical ID pattern for its exact resource kind.

## Canonical IDs

Canonical IDs are `<prefix>_<ULID>` using uppercase Crockford ULIDs. They are immutable and never derived from display names or framework-native identifiers. Native identifiers reported by a framework are stored only as scoped external references.

## Commands

Every state-changing control-plane request except authentication uses a strict command envelope containing a command ID, command type, idempotency key, issue time, target, optional expected resource version, and a command-specific payload. Accepted commands return an operation ID. Retries with the same idempotency key and identical canonical payload return the original operation; a different payload is an idempotency conflict.

## Errors

Errors use one format with a stable machine code, HTTP status, safe message, canonical request/correlation IDs, retryability, optional retry delay, field violations, and optional operation ID. Secret values, upstream bodies, stack traces and raw credentials are forbidden.

## Concurrency

Mutable resources carry an integer version. Update/delete commands require `expectedResourceVersion` when operating on an existing resource. Mismatch returns `resource_conflict` and does not apply a partial effect.

## Capability negotiation

Core accepts only a signed/authenticated Hermes capability document conforming to `hermes-control` protocol `1.0.0`. Unsupported and temporarily unavailable are distinct. Core intersects advertised operations with its allow-list and required versions, persists the negotiated result and expiry, and refuses commands when the effective capability is absent or stale.

## Terminology

The public contract is organized by native domains: identity, frameworks, profiles, models, work, conversations, notifications, operations and audit. Historical application names and compatibility-owner concepts are excluded from production schemas, operation IDs and routes.
