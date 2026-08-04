# Phase 3 — Database Foundation

## Status

Complete. A fresh PostgreSQL 16 schema, migration runner, integrity functions, and live database integration suite now exist under `apps/core`. Nothing reads from or writes to a legacy application database.

## Migration sequence

| Version | File | Scope |
|---:|---|---|
| 1 | `001_core_foundation.sql` | Schema ledger, canonical-ID helpers, resource-version controls, immutability helper, baseline privilege hardening |
| 2 | `002_identity_authorization.sql` | Identities, sessions, MFA, service principals/credentials, roles, permissions, scoped bindings |
| 3 | `003_frameworks_models.sql` | Framework registry, capability snapshots/negotiations, providers, models, routing policies |
| 4 | `004_operations_events.sql` | Commands/operations, attempts, ordered events, publication state, durable consumers, inbound deduplication |
| 5 | `005_notifications_audit.sql` | Notification inbox/delivery and tamper-evident audit chain/checkpoints |

The applied schema currently contains 29 Core tables. Migrations are forward-only and transactionally applied in contiguous order.

## Foundation guarantees

### Migration integrity

- Session-level PostgreSQL advisory lock prevents concurrent migrators.
- Every applied migration stores its version, name, SHA-256 checksum, and application time.
- Unknown versions, renamed migrations, checksum changes, gaps, and malformed filenames fail closed.
- Re-running the complete migration set is idempotent.
- Each migration runs in its own transaction and rolls back on failure.

### Canonical identity and referential integrity

- Public resource identifiers use a three-letter kind prefix plus uppercase Crockford ULID.
- Every domain table has kind-specific ID checks.
- Identity and service principal deletion is blocked; lifecycle is represented by status.
- Authorization bindings validate that principal and grantor records exist.
- Foreign keys use explicit `CASCADE`, `RESTRICT`, or `SET NULL` behavior.
- Framework-native identifiers stay scoped attributes rather than global IDs.

### Authorization

- Roles, permissions, role-permission mappings, and scoped principal bindings are normalized.
- Scope is explicit: global, framework, profile, or project.
- Principal and grantor kinds are restricted to user or service identities.
- Built-in admin, operator, and viewer roles are seeded idempotently.

### Idempotency and operations

- Commands have globally unique command IDs.
- Actor plus idempotency key is unique.
- Canonical payload digest is persisted for replay/conflict comparison.
- Operation targets, expected resource versions, attempts, terminal shape, safe errors, and timestamps are constrained.
- Accepted operations have a partial dispatch index.

### Optimistic concurrency

- Mutable resources carry positive integer versions.
- Database triggers reject client-written versions, increment versions, and set update timestamps.
- `core.assert_resource_version` provides a database precondition primitive.
- Durable event consumers also reject cursor regression and version manipulation.

### Events and durable cursors

- Events have a global durable position and database-assigned aggregate sequence.
- Event payload records are immutable.
- Publication lifecycle is stored separately so dispatch metadata can change without mutating events.
- Consumer cursor movement is monotonic and cannot advance beyond the durable event head.
- Lease state and consumer version are persisted.
- Inbound framework receipts provide durable deduplication with payload digests.

### Notifications

- Recipient existence, severity, state/time consistency, safe action URLs, expiry, and metadata shapes are constrained.
- Optional deduplication keys are unique per recipient.
- Inbox and delivery queue indexes are partial and bounded to active work.
- Delivery state has independent concurrency control.

### Audit integrity

- Audit records are append-only; updates and deletes fail at the database boundary.
- Inserts serialize on an advisory transaction lock.
- The database sets the previous hash and SHA-256 record hash.
- Hash input includes identity, action, target, request/correlation IDs, outcome, timestamp, operation, and canonical JSON details.
- `core.verify_audit_chain()` detects link or record-hash mismatches.
- Signed checkpoints must reference an exact audit position/hash pair and are immutable.

### Privilege baseline

- `PUBLIC` receives no Core schema privileges.
- Function execution is revoked from `PUBLIC`, including future functions through default privileges.
- Production runtime grants and role creation remain deployment-specific; the runtime account must not own the schema or migration ledger.
- TLS certificate validation is enabled by default in the migration client.

## Validation

The automated integration suite creates a new PostgreSQL 16.6 database and proves:

- all five migrations apply from zero and verify;
- a second migration run applies nothing;
- checksum tampering is rejected;
- malformed canonical IDs fail constraints;
- principal existence is enforced;
- resource versions increment and direct version writes fail;
- duplicate idempotency keys fail;
- aggregate event sequences are database-assigned;
- direct sequence injection fails;
- durable cursors cannot regress or pass the event head;
- audit records link correctly;
- audit chain verification returns zero violations;
- audit mutation is rejected.

The final live schema verification reported 29 tables, 36 triggers, and zero audit-chain violations.
