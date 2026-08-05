# Source-of-Truth and Ownership Matrix

## Binding decision

UNIFY Core is authoritative for native profiles, work, conversations, messages, attachments, routing, and durable domain events. Exact registered Hermes instances remain authoritative for their advertised framework runtime capabilities. Gateway is authoritative for identity/access policy, framework registrations, operations, audit, and recipient-scoped notification projections.

Agency, DMM, Worker, and `/CHAT` have no runtime, migration-reader, parity, fallback, or rollback role. Earlier discovery and migration documents are historical evidence only.

## Matrix

| Entity or operation | Authoritative owner | Rule |
|---|---|---|
| Native profiles and agents | Core | owner-scoped PostgreSQL state and command envelopes |
| Native projects, boards, tasks, runs, and schedules | Core | Core is the only work-state writer and scheduler |
| Conversations, messages, attachments, routes, cursors, and dispatch claims | Core | Core is the only conversation ledger and dispatcher |
| Framework identity, capabilities, provider/runtime inventory, and framework events | exact Hermes instance | exact registered endpoint and supported contract required |
| Framework runtime actions | exact Hermes instance | capability, permission, idempotency, evidence, and readback required |
| Users, sessions, roles, permissions, CSRF, and application governance | Gateway | deny by default |
| Framework registrations and secret references | Gateway | credentials remain server-side and scoped |
| Operations, evidence, and audit | Gateway | immutable/durable access-plane records |
| Derived notifications and UI preferences | Gateway | never domain truth |

## Invariants

1. Current `ResourceRef.owner` is only `hermes` or `gateway`.
2. Native Core APIs enforce principal ownership and database integrity.
3. Gateway communicates only with registered Hermes framework endpoints.
4. There are no configured upstream URLs, credentials, adapters, owner clients, proxy routes, or feature flags for retired services.
5. Browser applications communicate only with same-origin UNIFY APIs.
6. One resource has one writer; dual writes and runtime fallbacks are forbidden.
7. A write requires exact target, supported capability, permission, validation, idempotency, and durable evidence.
8. Source outage never becomes authoritative empty state, fabricated success, or another owner's data.
9. Labels are not identity keys.
10. The standalone boundary is enforced by `pnpm standalone:check` and full repository QA.
