# Phase 1 Report — Repository and Contract Bootstrap

## 1. Scope and method

This phase inspected the supplied as-built descriptions, source repositories, Git state, running containers, Compose topology and read-only public endpoints. It performed no production profile, project, task, cron, chat, credential or memory mutation.

Evidence is a point-in-time baseline, not a permanent guarantee. Production behavior, committed source and dirty working source are distinguished where they differ. Sensitive endpoint configuration, credentials, private conversation content, identity-file content and memory records are excluded.

## 2. Verified architecture and deployment map

| Domain | Repository | Source state at discovery | Deployment | Persistence | Realtime |
|---|---|---|---|---|---|
| AGENCY | `/srv/agency` | Clean `main`, `c2a4e07d197391de60183177948a20ec54197b2e` | Healthy container, created 2026-07-17 | SQLite | Authenticated SSE bridge to Hermes |
| DMM | `/srv/dmm` | Clean `main`, `8059aeda66b57652fb0607717d892c0e3f82714e` | Healthy container, created 2026-07-17 | SQLite and encrypted vault records | Request/refresh oriented |
| WORKER v3 | `/srv/worker-v3` | Branch `worker-v3-control-plane`, ahead with pre-existing modified/untracked files; HEAD `b10678be35767dc0b9ff396e84cc9ec376bfd9b2` | Healthy web/server/PostgreSQL containers, created 2026-07-05 | PostgreSQL plus Hermes-native state | SSE, WebSocket and fallback paths in implementation |
| CHAT | `/srv/chat` | `main` with pre-existing modified/untracked files; HEAD `39531fe6d2a7a9e0473d88b6b76d7cec35c752b8` | Healthy container, created 2026-06-08 | SQLite | WebSocket, bounded in-memory replay, single process |
| MemoryV4 | `/srv/memory-v4` | Foundation branch, HEAD `24967c5943908616c20419d56a37296fe5c6ffee` | No live MemoryV4 deployment found | SQLite foundation | No production unified event stream |

The running MemoryV3 service is a different product and was not treated as MemoryV4 evidence or a cutover target.

Read-only public probes found healthy responses for Agency, DMM, Worker and Chat. A protected anonymous Chat session request was rejected. MemoryV4 had no live endpoint on this host.

## 3. Source-of-truth matrix

The binding matrix is maintained in [`../architecture/SOURCE-OF-TRUTH.md`](../architecture/SOURCE-OF-TRUTH.md). In summary:

- Hermes owns framework-native profiles, provider/model availability, runtime, usage, Kanban, dispatcher and native cron state.
- DMM owns its vault records, catalog history and DMM audit until an approved migration.
- Worker owns project metadata, activation schedules, policy, approvals and rollback metadata.
- Chat owns sessions, messages, attachments, mirror records, surface routes and outbound reconciliation.
- MemoryV4 owns governed memory records/scopes and memory audit/retrieval events.
- Gateway owns central identity, sessions, resource mappings, operation/idempotency records, cross-system correlation audit, event cursors, notifications and UI preferences.

## 4. Current API, authentication and realtime inventory

### AGENCY

- Authenticated server-side application API.
- Framework/profile control routes support capability inspection, dry-run and readback-oriented operation evidence.
- Authenticated SSE to browser, separately exposing upstream bridge state.
- Best existing reference for profile mutation safety.

### DMM

- Authenticated server API with signed session cookies, CSRF, login rate limiting and backend secret redaction.
- Provider/model/catalog and credential-vault operations.
- Framework-derived current inventory; no fictional local catalog.
- UI gaps include mobile navigation, action feedback, confirmation and scalable lists.

### WORKER

- Browser login currently stores a client marker rather than establishing server identity.
- Mutation bearer enforcement is optional and fail-open when configuration is absent.
- Production accepted a tested unauthenticated mutation request during the supplied audit.
- Hermes is canonical for Kanban/native cron; Worker owns project/policy metadata.
- SSE was observed; implementation also contains WebSocket and fallback support.

### CHAT

- Server-side shared-password session; protected APIs and WebSocket use the session identity.
- Sessions/messages/routes/mirror handling are Chat-owned.
- WebSocket replay is bounded and single-process.
- History is not paginated/virtualized, attachment downloads need reauthorization, and one bridge route-kind smoke is red.

### MemoryV4

- FastAPI bearer-key foundation with create/list/get/search and generated OpenAPI documentation.
- No named user identity/RBAC, complete pagination, management lifecycle API, safe canonical promotion, live deployment or complete QA10.
- No product UI.

## 5. Proposed repository and Gateway layout

UNIFY is a pnpm TypeScript monorepo with independently deployable Gateway, UNIUI, Chat PWA and Alerts PWA applications. Shared packages hold contracts, generated SDK, auth/event clients, resource references, capabilities, Mantine components and domain components.

The Gateway is a Fastify modular monolith with modules for identity, frameworks, capabilities, catalog, profiles, work, chat, memory, operations, audit, events, notifications, search, settings and observability. Adapter interfaces keep modules independently testable and later extractable.

Full layout and sequence: [`../plans/BUILDING-PLAN.md`](../plans/BUILDING-PLAN.md).

## 6. Canonical resource identity

The design is maintained in [`../architecture/RESOURCE-IDENTITY.md`](../architecture/RESOURCE-IDENTITY.md). Every Hermes-native identifier includes framework context. Chat and MemoryV4 retain owner-native IDs with explicit cross-resource references. Labels never serve as joins. Mapping states are inspectable, and stale/ambiguous mappings block writes.

## 7. `/api/v1` outline

The contract outline is maintained in [`../contracts/API-V1-OUTLINE.md`](../contracts/API-V1-OUTLINE.md). It covers auth/users/roles, frameworks/capabilities/health, provider/model/catalog, profiles/agents, work, chat, memory, operations, audit, notifications, search, events/realtime, settings and health/readiness.

## 8. Threat model and priority security fixes

The full model is maintained in [`../threat-model/INITIAL-THREAT-MODEL.md`](../threat-model/INITIAL-THREAT-MODEL.md). Highest priorities are:

1. make Worker mutation authentication fail closed;
2. establish named Gateway identity, server sessions, CSRF and scoped RBAC;
3. prevent direct browser/downstream access and browser-bundled credentials;
4. bind operations to exact target, actor, payload, source version and expiry;
5. protect Chat uploads/downloads and reconcile the route contract;
6. block unsafe MemoryV4 canonical/live writes;
7. authorize SSE/WS subscriptions and separate browser from upstream connection truth;
8. recursively redact secrets from APIs, logs and evidence.

## 9. Source/deployment drift and compatibility risks

- Worker and Chat worktrees are not immutable deployed-release snapshots.
- Worker has source-defined behavior absent from production and a critical auth gap.
- Chat source/migration/control behavior is ahead of the deployed image and has one known red smoke.
- MemoryV4 is a foundation, not a production MemoryV3 replacement.
- Current authentication, persistence and realtime contracts vary significantly.
- Native IDs may collide across frameworks.
- External-channel ownership must not be duplicated.

These are migration inputs and blocking gates, not findings to hide with UI fallbacks.

## 10. Phased implementation and gates

1. Repository and contract bootstrap.
2. Gateway foundation.
3. Read-only adapters and shadow comparisons.
4. Mantine UNIUI read surfaces.
5. Safety-gated domain mutations.
6. Focused Chat and Alerts applications.
7. Hardening, production rollout and per-domain cutover.

Each phase must satisfy the ten QA gates defined in the building plan: contracts, source-of-truth, security, mutation safety, reliability, durability, UI, accessibility/responsiveness, performance, and production/rollback evidence.

## 11. First concrete increment and evidence

This increment is intentionally documentation-only. It establishes the verified baseline, ownership, identity, capability/truth contract, API outline, threat model, ADRs and complete realization plan before implementation changes.

Verification required before commit:

- all expected documents exist;
- Markdown links resolve locally;
- JSON evidence manifest parses;
- no private key or common credential pattern is present;
- `git diff --check` passes;
- repository push succeeds through the dedicated UNIFY deploy key;
- remote `main` resolves to the pushed commit.

No production mutation is part of this increment.
