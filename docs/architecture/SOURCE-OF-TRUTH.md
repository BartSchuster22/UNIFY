# Source-of-Truth and Ownership Matrix

## Binding decision

Hermes agent framework instances are the source of truth for agent-domain state. UNIFY is the gateway/access plane. UNIFY UI is the user control interface. Agency, DMM, Worker and CHAT are migration inputs and parity references only; they are never authoritative owners and will be retired after Hermes-backed UNIFY passes full production QA10.

The comprehensive migration and implementation sequence is defined in [`../plans/HERMES-SOT-REBUILD-AND-IMPLEMENTATION-PLAN.md`](../plans/HERMES-SOT-REBUILD-AND-IMPLEMENTATION-PLAN.md). This decision supersedes conflicting ownership statements in earlier discovery/evidence documents, which remain historical records only.

## Matrix

| Entity or operation | Authoritative owner | UNIFY Gateway role | Write rule |
|---|---|---|---|
| Framework identity, capabilities, health and events | Exact Hermes instance | Register, authenticate, normalize, authorize and expose provenance | Exact framework and supported contract version required |
| Profiles/agents, identity, model routing, runtime and usage | Exact Hermes instance | Access policy, operation orchestration and verified readback | Direct Hermes control contract only |
| Providers, credentials, available models and fallback routing | Exact Hermes instance and its configured secret/auth provider | Secret-safe access, policy and evidence | Raw secrets never return; direct Hermes credential/runtime contract only |
| Projects and project activation metadata | Exact Hermes instance | Normalize and authorize | Direct Hermes Projects contract only |
| Kanban boards, tasks, comments, dependencies, attempts and dispatcher | Exact Hermes instance | Access policy and operation evidence | Hermes is the only board writer and dispatcher |
| Cron jobs and schedules | Exact Hermes instance | Access policy and operation evidence | Hermes is the only scheduler |
| Sessions, messages, runs, approvals and usage | Exact Hermes instance | Paginated access, authorization and operation tracking | Hermes SessionDB/run APIs only |
| External conversation routes, ingest and outbound delivery | Exact Hermes Gateway instance | Permission filtering and safe route presentation | Hermes owns the sole platform consumer and delivery path |
| Framework tools, skills and plugin capabilities | Exact Hermes instance | Capability discovery and access policy | Never infer or seed capabilities in UNIFY |
| Configured external memory content | The memory provider selected by Hermes, according to its approved scope | Safe facade and principal mapping | UNIFY does not create a competing memory ledger |
| Users, roles, permissions, browser sessions and external-client tokens | UNIFY Gateway | Authoritative access-plane owner | Named identity, revocation, CSRF and scoped authorization |
| Framework registrations and non-secret endpoint references | UNIFY Gateway | Authoritative access-plane owner | Framework secrets remain server-side and scoped |
| Canonical aliases/migration mappings | UNIFY Gateway | Authoritative mapping record | Ambiguous, stale or missing mappings block writes |
| Operations, idempotency, preflight and cross-framework audit | UNIFY Gateway | Authoritative access-plane evidence | Every meaningful write has verified Hermes evidence |
| Event cursors, derived notifications and UI preferences | UNIFY Gateway, explicitly derived where applicable | Durable access projection | Provenance and expiry required; never domain truth |
| Derived cache/search projection | UNIFY Gateway, explicitly derived | Availability/performance optimization | Read-only while stale; source outage never becomes empty truth |
| Agency, DMM, Worker and CHAT databases/APIs | No authoritative role | Migration import and temporary shadow comparison only | No final production write path; remove after QA10 |

## Ownership invariants

1. Every framework-domain resource uses `owner: hermes` and an exact `frameworkId`.
2. `agency`, `dmm`, `worker` and `chat` may appear only as legacy migration provenance, never as current owner.
3. The browser communicates only with UNIFY Gateway.
4. UNIFY Gateway communicates directly with versioned Hermes control contracts for domain reads, writes and events.
5. One framework record has one writer: Hermes. Dual writes are forbidden.
6. UNIFY PostgreSQL stores access-plane state and derived projections, not competing domain records.
7. Labels are never join keys; canonical IDs include framework context.
8. Source outage never becomes an authoritative empty result, fabricated zero or inferred success.
9. A write requires exact target, capability, permission, validation, idempotency and Hermes readback/event verification.
10. Existing external-channel webhook, ingest and delivery ownership remains singular inside Hermes Gateway.
11. Legacy rollback never restores a legacy database as writer after Hermes cutover.
12. A domain is not QA10 until its legacy application can be stopped without functional loss.

## Ownership-change procedure

Any exception requires an approved ADR, schema and semantic comparison, backup, reversible migration, shadow reads, consistency evidence, feature-flagged cutover, authoritative readback, rollback rehearsal and explicit retirement impact. UI convenience is never sufficient reason to move source-of-truth ownership out of Hermes.
