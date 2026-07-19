# UNIFY — Feasibility, Architecture, and Step-by-Step Building Plan

**Project:** Aquiero Unified Hermes Gateway and UNIUI
**Repository:** `BartSchuster22/UNIFY` (private)
**Target UI:** Mantine (`https://ui.mantine.dev/`) with an intentionally neutral default operator-console theme
**Status:** Discovery and planning baseline
**Production rule:** No legacy production mutation during discovery or ordinary verification

---

## 1. Executive decision

The project is **doable**, but it is not a safe one-step UI merge. It is a controlled platform migration involving five products with different ownership, authentication, persistence, realtime, and maturity levels.

The recommended implementation is a **TypeScript modular monolith in one monorepo**, deployed as independently versioned Gateway and UI images. PostgreSQL stores only Gateway-owned state. Existing systems remain operational behind private adapters during a strangler migration. UNIUI communicates exclusively with the Gateway.

The shortest safe path is:

1. freeze canonical contracts and ownership;
2. build identity, RBAC, evidence, audit, idempotency, resource mapping, and adapter foundations;
3. integrate every domain read-only;
4. deploy UNIUI read-only;
5. enable mutations one domain at a time behind feature flags;
6. add focused Chat and Alerts PWAs from shared packages;
7. rehearse rollback and only then restrict legacy public mutation paths.

### Feasibility verdict by area

| Area | Verdict | Main reason |
|---|---|---|
| Unified read UI | Feasible now | All domains expose enough source/API evidence for adapters; MemoryV4 is narrower than the others. |
| Central auth/RBAC | Feasible and mandatory first | Existing auth models differ; Worker has a critical fail-open mutation path. |
| Multi-Hermes support | Feasible with early contract work | Agency already models frameworks; IDs must be namespaced from day one. |
| Unified realtime | Feasible incrementally | Agency/Worker use SSE; Chat uses WebSocket; MemoryV4 has no equivalent production stream. |
| Safe profile mutations | Feasible | Agency provides the strongest reusable safety pattern. |
| DMM credential operations | Feasible after safety wrapper | Current semantics and evidence UX need tightening; secrets must stay downstream/server-side. |
| Worker mutations | Blocked from public enablement until auth remediation | Production currently accepts at least one unauthenticated mutation when token configuration is absent. |
| Chat migration | Feasible after contract cleanup | Pagination, protected attachments, named identity, and one red route-contract smoke are prerequisites. |
| MemoryV4 full management | Not yet feasible safely | Backend lacks named principals/RBAC, pagination, lifecycle APIs, safe promotion, production hardening, and live deployment. Read-only explorer plus permitted working/evidence writes is feasible after backend expansion. |
| Big-bang replacement | Rejected | Creates ownership, dual execution, rollback, and drift risks. |

---

## 2. Verified current baseline

### 2.1 Repositories and deployed services

| Domain | Repository state observed | Deployment observed | Important qualification |
|---|---|---|---|
| AGENCY | `/srv/agency`, clean `main` at `c2a4e07…` | Healthy container built 2026-07-17 | Strongest safety/readback model; current live snapshot uses one Hermes framework. |
| DMM | `/srv/dmm`, clean `main` at `8059aeda…` | Healthy container built 2026-07-17 | Good backend security baseline; UI has mobile, accessibility, feedback, and destructive-confirmation gaps. |
| WORKER v3 | `/srv/worker-v3`, branch ahead with many pre-existing modified/untracked files | Healthy web/server/PostgreSQL containers built 2026-07-05 | Source/deployment drift and critical authentication gap. Do not treat the worktree as an immutable release. |
| CHAT | `/srv/chat`, `main` with pre-existing modified/untracked files | Healthy container built 2026-06-08 | Source/image/schema drift and one known red bridge contract smoke. |
| MemoryV4 | `/srv/memory-v4`, foundation branch | No live MemoryV4 container found | API-only SQLite foundation; running MemoryV3 is a different product and is not a substitute. |

Read-only public probes returned healthy responses for Agency, DMM, Worker, and Chat. Protected Chat session inventory rejected an anonymous request. MemoryV4 has no production endpoint on this host.

### 2.2 Current technology inventory

| Domain | Backend | UI | Persistence | Realtime |
|---|---|---|---|---|
| AGENCY | Node/Express/TypeScript | React/Vite | SQLite | Authenticated SSE bridge |
| DMM | Node/Fastify/TypeScript | React/Vite | SQLite + encrypted vault records | Primarily request/refresh based |
| WORKER | Node/TypeScript | React/Vite | PostgreSQL + Hermes native state | SSE, WebSocket and polling fallback in implementation |
| CHAT | Node/Express/TypeScript | React/Vite | SQLite | WebSocket with bounded in-memory replay, single process |
| MemoryV4 | Python/FastAPI | No product UI | SQLite | No production unified stream |

### 2.3 Current compatibility and drift risks

1. **Worker security:** browser login is not server identity; API token enforcement is optional/fail-open.
2. **Worker drift:** dirty/ahead source, source-defined route absent in production, and deployed bundle differs.
3. **Chat drift:** deployed image is older than current source; migration/control API parity differs.
4. **Chat red test:** bridge route-kind expectation conflicts with current route implementation.
5. **MemoryV4 maturity:** no live deployment, no complete QA10, and insufficient governance APIs for full writes.
6. **Mixed authentication:** shared passwords, browser-only markers, cookie sessions, and bearer keys cannot be federated by the browser safely.
7. **Mixed persistence:** copying downstream inventories to Gateway PostgreSQL would create false authority.
8. **Mixed event semantics:** browser connection must not imply upstream framework connection.
9. **Potential ID collisions:** native labels/IDs can overlap across Hermes instances.
10. **External-channel ownership:** Telegram/webhook/relay ownership must remain singular; mirrored events must never trigger duplicate assistant execution.

---

## 3. Source-of-truth matrix

| Entity/operation | Authoritative owner | Gateway responsibility | Mutation rule |
|---|---|---|---|
| Framework identity/capabilities/health | Exact Hermes instance | Register connection, normalize, timestamp, expose freshness | Adapter capability required; no guessed health. |
| Provider/model availability and configured framework roles | Hermes | Normalize collision-safe inventory and provenance | Global catalog is read-only; no fictional seed catalog. |
| DMM vault credential record, snapshots/diffs | DMM until deliberately migrated | Authz/policy wrapper, evidence correlation | Secret never returned; distinguish vault deletion from framework uninstall. |
| Profile identity/model routing/runtime/usage | Hermes through proven Agency/direct control contract | Safety orchestration and operation record | Exact target, dry-run hash, idempotency, confirmation, readback. |
| Worker project metadata, activation schedules, policy, approvals, rollback metadata | Worker | Normalize and correlate with Hermes resources | Preserve Save vs Save-and-Start semantics. |
| Kanban boards/cards/lanes/dispatcher/native cron | Hermes | Read/route only through authoritative adapter | Never create a competing writer, dispatcher, or scheduler. |
| Chat sessions/messages/attachments/mirror records/routes/outbound reconciliation | Chat | Central identity/authz, normalized contracts, operation evidence | Route capability decides writability; mirror ingest never starts a second turn. |
| Memory records/scopes/audit/retrieval | MemoryV4 | Central principal mapping and safe UI/API facade | Initially only policy-permitted working/evidence writes; no arbitrary canonical/live writes. |
| Users/roles/sessions/tokens | Gateway | Authoritative owner | Named identity, revocation, CSRF, native/external token flow. |
| Resource mappings | Gateway | Authoritative registry of inspected mappings | Ambiguous/stale mappings block writes. |
| Operations/idempotency/cross-system audit | Gateway | Authoritative owner | Every meaningful write gets an operation lifecycle and evidence. |
| Notifications/preferences/event cursors | Gateway | Authoritative owner unless explicitly delegated | Dedupe/group; deep-link to source resource. |
| Derived cache | Gateway, explicitly derived only | Store provenance, observation, expiry and stale state | Never present stale cache as current authority. |

---

## 4. Target architecture

### 4.1 Architectural style

Use a **modular monolith** for the Gateway and a **pnpm TypeScript monorepo**. Avoid Kubernetes, a service mesh, Kafka, and premature microservices for the first Aquiero installation. Keep adapter and module interfaces extractable.

Recommended stack:

- **Runtime:** Node.js LTS, pinned exactly in images and CI.
- **Gateway HTTP:** Fastify with typed route schemas and OpenAPI 3.1 generation.
- **Validation/contracts:** TypeBox or JSON-Schema-first types from one schema source; generated TypeScript SDK.
- **Database:** PostgreSQL 16; migrations through a pinned migration tool; SQL access through a lightweight typed query layer.
- **UI:** React, Vite, Mantine, React Router, TanStack Query, TanStack Virtual.
- **Testing:** Vitest, Testcontainers, Playwright, axe-core, k6 (or equivalent), adapter contract fixtures.
- **Realtime:** SSE for durable operational events; WebSocket only for chat/high-frequency bidirectional streaming.
- **Observability:** structured JSON logs, Prometheus metrics, OpenTelemetry-compatible traces.
- **Edge:** same-origin reverse proxy; Caddy or the existing approved edge, with strict `/api/*` routing before SPA fallback.
- **Optional pub/sub:** interface from day one; in-process implementation for development; Redis/NATS implementation before horizontal scaling.

### 4.2 Monorepo layout

```text
UNIFY/
  apps/
    gateway/
      src/modules/
        auth/
        frameworks/
        capabilities/
        catalog/
        profiles/
        work/
        chat/
        memory/
        operations/
        audit/
        events/
        notifications/
        search/
        settings/
        observability/
      src/adapters/
        hermes/
        agency/
        dmm/
        worker/
        chat/
        memory-v4/
    uniui/
    chat-pwa/
    alerts-pwa/
  packages/
    contracts/
    sdk-typescript/
    auth-client/
    resource-ref/
    capability-policy/
    event-client/
    design-system/
    chat-components/
    notification-components/
    test-fixtures/
  db/migrations/
  deploy/
    compose/
    caddy/
    scripts/
    secrets/
  docs/
    architecture/
    adr/
    contracts/
    threat-model/
    runbooks/
    migration/
    evidence/
  tests/
    contract/
    integration/
    e2e/
    accessibility/
    performance/
    security/
```

### 4.3 Deployment topology

```text
Internet
  -> uniui.aquiero.com edge
      -> / and assets        -> aquiero-uniui (static, non-root)
      -> /api/v1/*           -> aquiero-gateway (private)
      -> /api/v1/events      -> aquiero-gateway SSE
      -> /api/v1/realtime    -> aquiero-gateway WebSocket when needed

Private application network
  aquiero-gateway -> PostgreSQL
  aquiero-gateway -> Hermes instance(s)
  aquiero-gateway -> AGENCY / DMM / WORKER / CHAT / MemoryV4 adapters
  aquiero-gateway -> optional Redis/NATS-compatible pub/sub
```

Legacy services remain reachable by operators during migration, but service mutation APIs move behind private networking/authenticated proxy rules before final cutover.

---

## 5. Canonical identity and truth envelope

### 5.1 Resource reference

Use opaque canonical IDs, never display labels, for joins and mutations.

```ts
interface ResourceRef {
  canonicalId: string;        // e.g. urn:aquiero:profile:<frameworkId>:<encodedNativeId>
  kind: ResourceKind;
  owner: 'hermes' | 'agency' | 'dmm' | 'worker' | 'chat' | 'memory-v4' | 'gateway';
  frameworkId?: string;
  nativeId: string;
  displayLabel?: string;
  sourceVersion?: string;
  observedAt: string;
  related?: ResourceRef[];
}
```

Required compound identities:

- `profileKey = frameworkId + profileId`
- `agentKey = frameworkId + runtimeAgentId`
- `providerKey = frameworkId + providerId`
- `modelKey = frameworkId + providerId + modelId`
- `projectKey = frameworkId + nativeBoard/projectId`, optionally mapped to Worker project ID
- `taskKey = frameworkId + nativeCardId`
- `cronKey = frameworkId + nativeCronId`
- Chat `sessionId` remains Chat-owned and carries explicit route/framework/agent references
- Memory `recordId` and `scopePath` remain MemoryV4-owned

A mapping record includes state (`current`, `stale`, `ambiguous`, `missing`), observations, candidate links, source versions, and audit history. Any non-current mapping blocks mutation.

### 5.2 Standard response truth metadata

Every response includes:

- request/correlation ID;
- authoritative source;
- framework ID where relevant;
- source status;
- observed/generated timestamps;
- freshness: `current | stale | partial | empty | unavailable | unsupported | forbidden | failed`;
- warning list;
- cursor metadata when applicable.

Do not translate upstream outage into an empty inventory or zero metrics.

---

## 6. `/api/v1` contract outline

```text
/auth/login | logout | me | refresh | csrf | sessions
/users | /roles
/frameworks
/frameworks/{id}/health
/frameworks/{id}/capabilities
/providers | /models
/catalog/snapshots | /catalog/diffs
/profiles | /profiles/{frameworkId}/{profileId}
/profiles/{...}/identity | model-routing | runtime | health | usage
/agents
/work/projects | tasks | cronjobs | approvals | rollback-plans
/chat/agents | sessions | sessions/{id}/messages | uploads | files
/memory/records | search | audit | retrieval-events
/operations | /operations/{id}
/audit
/notifications
/search
/events
/realtime/status
/settings | /applications
/health/live | /health/ready
```

Collection routes use cursor pagination. Mutation routes require server authorization, CSRF for cookie sessions, an idempotency key, and where relevant a valid preflight token bound to payload hash, target, source version, actor, and expiry.

### Operation lifecycle

```text
pending -> validated -> preflighted -> awaiting_confirmation
        -> executing -> applied -> verifying -> verified
        -> failed | denied | inconclusive
        -> rolling_back -> rolled_back | rollback_failed
```

No UI toast may claim success before the operation reaches a truthfully verified state, unless the action is explicitly asynchronous and shown as pending.

---

## 7. Security model and priority fixes

### 7.1 Identity

- Named users; bootstrap administrator created by one-time secret or OIDC.
- Server-side sessions in PostgreSQL with `HttpOnly`, `Secure`, appropriate `SameSite` cookies.
- CSRF token on every cookie-authenticated mutation.
- Short-lived access tokens and rotating refresh tokens for native/external clients.
- Session/device listing and revocation.
- Login throttling, backoff, lockout policy, and audit.
- MFA-ready authenticator interface; do not block initial release on MFA if OIDC is unavailable, but do not design it out.

### 7.2 RBAC baseline

Roles: Viewer, Operator, Administrator, Auditor/Security.

Permission families:

- `frameworks.read/manage`
- `profiles.read/manage/delete`
- `models.read/manage`
- `credentials.manage`
- `work.read/manage/autonomy`
- `chat.read/use/admin`
- `memory.read/write/promote/admin`
- `audit.read`
- `users.manage`
- `settings.manage`

Enforce permissions server-side on REST, SSE, and WebSocket subscriptions. Add framework/resource scopes.

### 7.3 Highest-priority fixes before mutation rollout

1. Make Worker reject unauthenticated mutation unconditionally and fail production startup without required service auth.
2. Keep all downstream credentials out of browser bundles; remove compiled Worker fallback credentials.
3. Establish named Gateway identity and central audit attribution.
4. Add exact-target authorization to prevent confused-deputy and cross-framework mistakes.
5. Add operation idempotency/replay defense and optimistic concurrency.
6. Protect Chat attachment download and replace base64 JSON upload with authenticated multipart handling.
7. Reconcile Chat's red route-kind contract before adapter mutation support.
8. Prevent arbitrary MemoryV4 canonical/live create/promotion until backend policy is enforceable.
9. Apply CSP, HSTS, frame denial, `nosniff`, strict referrer and permissions policies at the same-origin edge.
10. Recursively redact secrets in responses, logs, operation evidence, screenshots, bundles, and test artifacts.

---

## 8. Mantine UNIUI default design

Build a neutral default design first; do not spend early cycles reproducing legacy CSS.

### 8.1 Shell

- `AppShell` with desktop navbar and mobile drawer.
- Top bar: context selector, source health, browser realtime status, global search, notifications, user menu.
- Left navigation: Overview, Frameworks, Models, Providers, Profiles, Work, Chat, Memory, Audit, Notifications, Settings.
- Route-level loading and error boundaries.
- Explicit source/freshness badge on every data surface.

### 8.2 Shared components

- `TruthState`, `SourceBadge`, `FreshnessBadge`, `CapabilityGate`
- `ResourceLink`, `ResourceRefInspector`
- `CursorTable`, `VirtualList`, bounded `KanbanViewport`
- `PreflightChecklist`, `PayloadDiff`, `ConfirmationDialog`
- `OperationPanel`, `EvidenceViewer`
- loading, authoritative-empty, stale, partial, unavailable, unsupported, forbidden, failed states
- accessible dialogs/drawers with focus trap, Escape and focus restoration
- toast/inbox notifications that link to operation evidence

### 8.3 UX constraints

- 390×844 must have reachable navigation/logout and no document-level horizontal overflow.
- Route rendering and crawling may issue only safe reads.
- Large data loads happen per route, not at shell bootstrap.
- Models, providers, tasks, audit, and chat use cursor pagination; large rendered collections use virtualization.
- Chat uses a multiline composer, durable drafts, route-specific capability banners, bounded history, and retry/reconciliation.
- Status is always text plus color; reduced motion supported.

---

## 9. QA10 definition for UNIFY

A phase is QA10 only when all ten gates are green with stored evidence:

| Gate | Required evidence |
|---|---|
| 1. Contract correctness | OpenAPI validation, generated SDK reproducibility, compatibility/contract tests. |
| 2. Source-of-truth integrity | Provenance, freshness, collision, false-empty and stale-outage tests. |
| 3. Security | Authz matrix, CSRF/CORS/rate-limit, secret scan, dependency/container scans, threat-model checks. |
| 4. Mutation safety | Validate/dry-run/hash/confirm/idempotency/concurrency/readback/rollback tests. |
| 5. Reliability | Timeout, cancellation, retry boundaries, circuit breaker, outage/recovery and graceful-shutdown tests. |
| 6. Data durability | Migration up/down, backup, restore, PostgreSQL failure and retention evidence. |
| 7. UI correctness | Route coverage, no render mutation, no direct downstream browser calls, truthful states. |
| 8. Accessibility/responsiveness | axe, keyboard workflows, focus/dialog behavior, 390×844/tablet/desktop evidence. |
| 9. Performance | Defined budgets and measured 1,000 models, 10,000 messages, 5,000 audit events, event reconnect. |
| 10. Production/rollback | Exact commit/image/schema IDs, health/readiness, live readback, edge rules, rollback rehearsal. |

No gate is green solely because code compiles or a container is running.

---

## 10. Step-by-step realization plan

Each numbered increment ends with tests, updated documentation/evidence, one focused commit, and push to `main` or an approved review branch. Never combine unrelated phases in one commit.

### Phase 0 — Discovery and frozen decisions

#### Step 0.1 — Repository bootstrap

- Install the dedicated UNIFY deploy key with repository **write** access.
- Clone to `/srv/unify` using the dedicated key.
- Protect `main`; require pull request or explicit release rule as chosen by the owner.
- Add `CODEOWNERS`, contribution rules, conventional commit policy, and secret scanning.
- Record the initial repository commit and default branch.

**Gate:** authenticated fetch/push round trip with a documentation-only commit; no unrelated credential can access UNIFY.

#### Step 0.2 — Freeze verified baseline

- Import this report and sanitized inventories.
- Capture repository HEADs, dirty-state warnings, deployed image IDs/timestamps, endpoint status, database types, auth and realtime modes.
- Never copy secrets, user conversation content, identity-file content, memory content, or live business records.

**Gate:** a second reviewer/tool can reproduce the read-only inventory.

#### Step 0.3 — Contract and ownership documents

- Publish source-of-truth matrix, resource IDs, capability vocabulary, truth/freshness envelope, error model, operation lifecycle and event envelope.
- Add ADRs for modular monolith, TypeScript/Fastify, PostgreSQL, Mantine, SSE-first, no dual-write, and strangler migration.

**Gate:** no unresolved ownership ambiguity for an entity planned in Phase 2.

#### Step 0.4 — Threat model and migration inventory

- Document attack paths and trust boundaries.
- Inventory every legacy API route, auth mechanism, service credential, event bridge, mutation, timeout and retry behavior.
- Classify each route: wrap, direct Hermes replacement, retain domain owner, defer, or retire.

**Gate:** critical risks have a named mitigation and blocking phase.

### Phase 1 — Gateway foundation

#### Step 1.1 — Monorepo and reproducible toolchain

- Create pnpm workspace, TypeScript configs, lint/format/test commands and lockfile.
- Add pinned Node image and CI cache rules.
- Create empty deployable apps and shared packages with dependency-boundary linting.

**Tests:** clean install, lint, typecheck, unit smoke, production builds.

#### Step 1.2 — Contracts and SDK

- Implement API envelope, error, resource reference, cursor, capability, event and operation schemas.
- Generate OpenAPI 3.1 and TypeScript client from the same source.
- Add schema snapshots and backward-compatibility checks.

**Tests:** schema validation, generated-client compile, breaking-change detector.

#### Step 1.3 — PostgreSQL schema

Create only Gateway-owned tables:

- users, roles, permissions, grants;
- sessions, refresh tokens, revocations;
- framework registrations and secret references;
- resource mappings;
- operations and idempotency records;
- audit events and evidence references;
- event cursors and notifications;
- app registrations and preferences;
- derived caches with source/observed/expiry fields.

**Tests:** migration up/down, constraints, concurrency/idempotency, clean database bootstrap.

#### Step 1.4 — Named identity, RBAC and sessions

- Implement bootstrap admin/OIDC seam, password hashing, cookie sessions, CSRF, token rotation/revocation and login throttling.
- Add framework/resource scopes and authorization middleware.

**Tests:** full permission matrix, CSRF, session fixation, revocation, lockout/backoff, event subscription auth.

#### Step 1.5 — Audit, operation and policy engine

- Persist immutable operation transitions.
- Implement payload canonicalization/hash, preflight token, expiry, confirmation and optimistic concurrency.
- Add semantic-key/value redaction and correlation IDs.

**Tests:** changed payload invalidates preflight; replay is idempotent; stale etag blocks; redaction catches nested secrets; failed verification remains inconclusive.

#### Step 1.6 — Adapter SDK and resilience

Define `health`, `capabilities`, `list`, `get`, `validate`, `dryRun`, `execute`, `verify`, `subscribe` plus normalized errors/provenance. Add timeout, cancellation, circuit breaker and retry policy.

**Tests:** hermetic contract suite including malformed response, timeout, auth failure, unsupported capability, collision and non-idempotent no-retry.

#### Step 1.7 — Containers and local compose

- Non-root multi-stage Gateway/UI images, read-only filesystem, dropped capabilities, health checks.
- PostgreSQL and optional development-only in-process event hub.
- Secret files, not browser/server image environment literals where avoidable.

**Tests:** container build, health/live, health/ready, graceful shutdown, filesystem/capability checks, SBOM and vulnerability scan.

### Phase 2 — Read-only adapters and shadow comparison

#### Step 2.1 — Framework registry and Hermes/Agency reads

- Framework list, health, capabilities, profiles, runtime, usage and model selection inventory.
- Multi-framework fixture with overlapping IDs.

**Gate:** source, freshness and unsupported/unavailable distinctions verified.

#### Step 2.2 — DMM reads

- Providers/models, framework bindings, auth methods, credential presence (never secret), snapshots, diffs and audit references.

**Gate:** Gateway output shadow-compares with DMM and Hermes without inventing catalog entries.

#### Step 2.3 — Worker reads

- Projects, project mappings, Kanban, tasks, cron, approvals, policy and rollback metadata.
- Add false-empty protection and canonical Hermes IDs.

**Gate:** dirty/deployed route mismatches documented; no Worker mutation exposed.

#### Step 2.4 — Chat reads

- Agents, sessions, cursor-paginated messages, route capabilities, attachments metadata and realtime bridge.
- Implement Gateway pagination adapter even if legacy Chat requires bounded transitional reads; do not fetch unlimited history per browser request.

**Gate:** 10,000-message fixture stays bounded in API and DOM; external-route ownership remains singular.

#### Step 2.5 — MemoryV4 read backend prerequisites

- Add named principal integration, cursor pagination, filters, consistent list/get/search visibility, audit/retrieval read APIs, body limits and OpenAPI bearer scheme in MemoryV4.
- Keep MemoryV4 cutover explicitly unapproved.

**Gate:** sibling-scope leakage tests and read-only explorer contract pass.

#### Step 2.6 — Unified events, notifications and search

- Normalize source events into one envelope.
- Add SSE resume, heartbeat, gap signal and REST reconciliation.
- Implement permission-aware federated search and notification dedupe/grouping.

**Gate:** connection state distinguishes browser, Gateway hub and each upstream bridge.

### Phase 3 — Mantine UNIUI read surfaces

#### Step 3.1 — Authenticated shell and design system

- Default Mantine theme, AppShell, mobile drawer, user/session menu, context picker, health and notification controls.
- Build truthful state and operation/evidence components first.

**Gate:** one login reaches all module routes; direct downstream browser requests fail the automated network test.

#### Step 3.2 — Frameworks/models/providers/profiles

- Paginated/virtualized inventories, provider details, profile workbench and cross-domain resource links.

#### Step 3.3 — Work

- Overview, project/task/cron read views, bounded Kanban surface, approvals and rollback views.
- Fix mobile overflow and dead-route exposure in the unified experience.

#### Step 3.4 — Chat

- Deep-link sessions, search/filter/archive, virtual history, structured blocks, route banners, multiline composer shell disabled until mutation phase.

#### Step 3.5 — Memory

- Scope tree, paginated records/search/detail/provenance/audit/retrieval views.
- No unsafe canonical/live write controls.

#### Step 3.6 — Audit, operations, notifications, settings and global search

- Cursor-paginated evidence views and permission-aware links.

**Phase gate:** desktop/tablet/390×844 E2E, route-crawl no-mutation, keyboard/axe, no page overflow, truthful outage states.

### Phase 4 — Safety-gated mutations, one domain at a time

#### Step 4.0 — Worker emergency auth remediation

Before any public Worker integration, make legacy mutation auth fail closed, remove browser credentials, add two-stage project deletion, required-field button gating, edge headers and upload limits.

**Gate:** anonymous mutation is `401/403` in source, container and public-edge tests.

#### Step 4.1 — Profile identity/model/runtime

Reuse Agency's exact-payload dry-run/readback model. Then enable profile creation and disposable deletion. Protected profile rejection remains server-side.

#### Step 4.2 — DMM credential/catalog operations

Add confirmation for rotation/deletion, explicit vault-vs-framework semantics, operation evidence, safe feedback and adapter readback.

#### Step 4.3 — Worker project/task/cron operations

Preserve Save versus Save-and-Start; route Hermes-native writes only to Hermes. No competing scheduler/dispatcher.

#### Step 4.4 — Chat send/upload/download

Resolve the red route contract first. Add outbound idempotency, dedupe, multipart uploads, authorized downloads, durable drafts and reconnect reconciliation.

#### Step 4.5 — Memory permitted writes

Only working/evidence create and legal lifecycle operations after MemoryV4 enforces permissions, idempotency, provenance and transitions. Promotion requires its own later approval gate.

**Per-domain gate:** feature flag, contract/security tests, disposable-resource E2E where explicitly authorized, authoritative readback, rollback evidence, and no legacy regression.

### Phase 5 — Focused applications

#### Step 5.1 — Chat PWA

Reuse SDK, auth, events, design-system and chat components. Conversation-first responsive shell; no duplicated business logic.

#### Step 5.2 — Alerts PWA

Inbox, filters, acknowledgement, grouping and UNIUI deep links from shared notification components.

#### Step 5.3 — Native readiness

Document Capacitor/thin-shell token storage and deep links. Do not create APK/iOS shells until PWA auth and responsive behavior are stable.

### Phase 6 — Hardening and cutover

#### Step 6.1 — Performance and resilience

Run measured large-fixture and concurrent-load tests; remediate budgets. Test upstream outages, database failure/read-only/full behavior, replay gaps and shutdown draining.

#### Step 6.2 — Security closure

SAST, dependency/container scans, SBOM, secret scans, authorization matrix, malicious uploads, SSE/WS scope tests, rate limits and audit tamper review.

#### Step 6.3 — Backup/restore and rollback rehearsal

Back up Gateway PostgreSQL and configuration; restore into a clean environment; verify image/commit/schema manifest; rehearse feature-flag and reverse-proxy rollback.

#### Step 6.4 — Read-only production deployment

Deploy `uniui.aquiero.com` with central auth and all read views. Keep legacy apps available. Compare outputs and observe event lag/error rates.

#### Step 6.5 — Per-domain mutation cutover

Enable one domain at a time after written acceptance. Restrict that legacy public mutation boundary only after parity and rollback evidence.

#### Step 6.6 — Legacy deprecation

Publish deprecation notices, route retirement plan and final gap/risk register. Do not delete domain data or services merely for aesthetic consolidation.

---

## 11. Commit and push discipline

For every completed increment:

1. update code and tests;
2. run the increment's local QA commands;
3. update architecture/API/runbook documentation;
4. store sanitized evidence manifest with exact command, result, commit and image/schema IDs where applicable;
5. run secret scan and `git diff --check`;
6. make one focused conventional commit;
7. push immediately;
8. verify remote branch HEAD;
9. do not mark the step complete if push or verification fails.

Suggested commit progression:

```text
docs(discovery): record verified baseline and architecture decisions
chore(repo): bootstrap typed monorepo and QA commands
feat(contracts): add v1 envelopes resource refs and generated sdk
feat(db): add gateway-owned postgres migrations
feat(auth): add named sessions csrf and rbac
feat(operations): add idempotent safety lifecycle and audit
feat(adapters): add adapter sdk and hermetic contracts
feat(frameworks): add read-only hermes and agency adapters
...
```

Never commit secrets, live payloads, private chats, identity files, memory contents, or production database extracts.

---

## 12. Immediate next increment

The first concrete repository increment should contain only:

- this feasibility/build plan;
- `docs/architecture/SOURCE-OF-TRUTH.md`;
- `docs/architecture/RESOURCE-IDENTITY.md`;
- `docs/threat-model/INITIAL-THREAT-MODEL.md`;
- ADR 0001 modular monolith/monorepo;
- ADR 0002 Gateway-only browser boundary;
- ADR 0003 PostgreSQL only for Gateway-owned state;
- an evidence manifest for read-only discovery;
- no production mutation and no adapter code yet.

After that documentation commit is pushed, bootstrap the monorepo as Step 1.1.

---

## 13. Current blockers and decisions needed

### External blocker

The private GitHub repository cannot yet be fetched from this host. A dedicated ED25519 deploy key has been generated locally. Its public key must be added to `BartSchuster22/UNIFY` with **Allow write access** before cloning, committing and pushing can be verified.

### Decisions that can safely use defaults

Unless explicitly changed, use:

- monorepo in `/srv/unify`;
- pnpm workspaces;
- Fastify TypeScript Gateway;
- React/Vite/Mantine UI;
- PostgreSQL 16;
- same-origin API under `/api/v1`;
- SSE-first realtime and WebSocket only for chat;
- in-process event hub only for local development, Redis-compatible implementation before horizontal scale;
- read-only production rollout before any mutation flag;
- no MemoryV3-to-V4 cutover without separate approval.

---

## 14. Acceptance interpretation

UI Project 1 is not accepted until one named-user login reaches every domain through the Gateway, all browser traffic is Gateway-only, truth/freshness and multi-framework identity are visible, meaningful writes are safety-gated and readback-verified, Worker's auth flaw is closed, Chat is paginated/virtualized and attachment-safe, MemoryV4 exposes only governed functionality, Mantine UNIUI passes mobile/accessibility checks, reproducible non-root images are deployed, and backup/restore/rollback evidence is complete while legacy apps remain available.
