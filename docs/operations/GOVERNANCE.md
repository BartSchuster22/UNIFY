# Operations, Idempotency, Audit, and Evidence

## Operation lifecycle

All framework mutations are represented by a durable operation. The canonical states are:

`pending → validated → preflighted → awaiting_confirmation? → executing → applied → verifying → verified`

Explicit terminal/error paths are `denied`, `failed`, `inconclusive`, `rolled_back`, and `rollback_failed`. The Gateway rejects illegal transitions and uses compare-and-set updates to reject concurrent transition races.

## Idempotency

Every non-exempt mutation must carry `Idempotency-Key` (maximum 200 characters). The Gateway computes SHA-256 over canonical JSON with recursively sorted object keys.

Within the actor and operation class:

- same key and same payload hash returns the original operation;
- same key and a different hash returns `409 IDEMPOTENCY_CONFLICT`;
- absent key returns `400 IDEMPOTENCY_KEY_REQUIRED`.

Records expire after 24 hours by default, while operations and evidence remain durable.

## Audit

Security-sensitive and framework-mutating actions append audit events. Events form a hash chain using `previous_event_hash` and `event_hash`. PostgreSQL triggers reject updates and deletes of audit events, operation transitions, and evidence references.

Audit metadata is recursively redacted before insertion. The append operation uses a PostgreSQL advisory lock so concurrent events cannot fork the hash chain.

## Evidence

Evidence payloads are recursively redacted before hashing or persistence. Keys matching credentials, cookies, authorization, passwords, tokens, secrets, API keys, or private keys are replaced with `[REDACTED]` at every nesting level. Evidence records contain:

- operation reference;
- evidence type;
- storage URI;
- SHA-256 content hash;
- redaction version;
- safe summary;
- redacted payload.

Raw secrets are not accepted as evidence and must not appear in logs, audit metadata, or API errors.
