# UNIFY Hermes-Source-of-Truth Rebuild and Implementation Plan

**Status:** Binding rebuild plan  
**Decision:** Hermes is the domain source of truth. UNIFY is the gateway and access plane. UNIFY UI is the user control interface.  
**Supersedes:** Any UNIFY document or implementation that assigns source-of-truth ownership to Agency, DMM, Worker, or CHAT.  
**Legacy systems in scope:** Agency, DMM, Worker, CHAT  
**Completion condition:** UNIFY passes all ten QA gates on direct Hermes contracts and the four legacy applications can be retired without loss of state, control, communication, or rollback capability.

---

## 1. Non-negotiable architecture

### 1.1 Three layers

| Layer | Owns | Must not own |
|---|---|---|
| **Hermes agent framework** | Profiles/agents, provider and model runtime configuration, credentials through Hermes-supported secret/auth mechanisms, projects, Kanban, tasks, schedules/cron, sessions, messages, runs, approvals, platform routes, delivery state, tools, capabilities, usage and framework events | UNIFY users, UNIFY RBAC, browser sessions, UI preferences |
| **UNIFY Gateway** | User identity, access policy, RBAC, framework registration, credential references, API normalization, command validation, idempotency, operation/audit records, event cursors, safe derived caches, notification projections and same-origin public API | A second copy of framework domain state; agent execution; provider/model truth; project/task truth; chat history; external transport ownership |
| **UNIFY UI** | Operator interaction, truthful presentation, accessible controls, workflow guidance, confirmation, progress and errors | Direct framework credentials; direct legacy access; domain persistence; inferred success |

### 1.2 Binding invariants

1. Every domain resource has `owner: hermes` and an exact `frameworkId`, except UNIFY-owned access/audit/UI records.
2. Agency, DMM, Worker and CHAT are never returned as authoritative owners.
3. The browser talks only to UNIFY Gateway.
4. UNIFY Gateway talks to a versioned UNIFY-owned Hermes adapter contract; the adapter approaches existing Hermes interfaces without changing Hermes.
5. Legacy applications may be read during migration for comparison or import only; they are not a write path.
6. There is one writer for each framework record at all times: Hermes.
7. UNIFY PostgreSQL stores access-plane state and derived projections only, never a competing domain ledger.
8. HTTP success is not sufficient for mutation success; UNIFY verifies with Hermes readback or a terminal Hermes event.
9. Framework outage is reported as unavailable/stale, never as an authoritative empty state.
10. External-channel ingestion and delivery remain singular inside Hermes Gateway; UNIFY never runs a second Telegram/Discord/etc. consumer.
11. Legacy retirement is complete only when removing the legacy service, database and credentials has no effect on UNIFY behavior.
12. A compatibility bridge is explicitly labeled `migration-only`, feature-flagged, observable and time-bounded.
13. Hermes Agent is an immutable external framework. UNIFY-specific APIs, adapters, schemas, authentication, events and compatibility logic must never be added to the Hermes codebase.

### 1.3 Target request and event paths

```text
Browser / mobile client
  -> UNIFY UI
  -> /api/v1/* on UNIFY Gateway
       -> authentication + RBAC + policy
       -> canonical UNIFY-owned Hermes adapter
       -> existing interfaces of the exact registered Hermes framework
            -> profiles / runtime / providers / models
            -> projects / Kanban / cron
            -> sessions / messages / runs / approvals
            -> messaging gateway routes and delivery
            -> durable framework events
       -> verified readback / operation audit

UNIFY adapter event/reconciliation stream derived from Hermes truth
  -> UNIFY event ingestor and cursor
  -> permission-filtered UNIFY SSE
  -> UNIFY UI reconciliation
```

The following path is forbidden as the final architecture:

```text
UNIFY -> Agency | DMM | Worker | CHAT -> Hermes
```

---

## 2. Verified current-state assessment

The rebuild is required. The current repository is a strangler prototype, not the target architecture.

| Area | Current implementation | Violation / risk | Required replacement |
|---|---|---|---|
| Resource ownership | Contracts allow `agency`, `dmm`, `worker`, and `chat` owners | Legacy applications can be presented as authoritative | Restrict domain ownership to `hermes`; retain `gateway` only for access-plane records |
| Profiles | UNIFY reads and mutates through Agency | Extra control plane and authentication dependency | UNIFY adapter over existing Hermes profile interfaces |
| Providers/models | UNIFY reads inventory and credentials through DMM | DMM is treated as model/credential owner | Hermes provider registry, runtime resolver and secret/auth control contract |
| Work | UNIFY reads and mutates Worker project/task/cron APIs | Worker metadata becomes a competing ledger | Hermes Projects + Kanban + cron APIs |
| CHAT reads | UNIFY reads CHAT SQLite-backed sessions/messages | CHAT becomes the conversation ledger | Hermes SessionDB and Hermes Gateway session metadata |
| CHAT writes | `chat.session.create` and `chat.message.send` execute through CHAT | Wrong writer and wrong operation owner | Hermes session/run/delivery endpoints |
| Realtime | UNIFY bridges CHAT WebSocket | Realtime depends on a retiring application | Hermes durable control/event stream plus run streams |
| Deployment | Gateway requires Agency/DMM/Worker/CHAT URLs and secrets | Legacy services are runtime dependencies | One or more registered Hermes endpoints and scoped service credentials |
| Cutover policy | Domains are named `profiles`, `dmm`, `worker`, `chat` | Policy encodes product names rather than framework capabilities | Capability families: `profiles`, `models`, `work`, `conversations`, `memory` |
| Documentation | Several binding documents assign records to legacy systems | Future phases can reproduce the wrong architecture | Replace ownership matrix and mark old findings historical |
| Retirement | Legacy routes require lengthy retention but no direct-Hermes completion gate | A canary can be declared complete while legacy remains essential | Retirement proof based on zero runtime calls and shutdown rehearsal |

### 2.1 Hermes capabilities already available

The installed Hermes line and current official documentation provide substantial native foundations:

- Profile registry and profile lifecycle CLI.
- Shared provider runtime resolver and provider plugin registry.
- Hermes-owned configuration and fallback chains.
- SQLite/WAL/FTS5 `SessionDB` containing sessions and full messages.
- API-server session list/create/get/update/delete, message history, session fork and persisted session chat.
- OpenAI-compatible chat/responses interfaces.
- Asynchronous runs with run status, approval, stop and per-run SSE events.
- API capabilities and agent discovery.
- Hermes Gateway platform routing, authorization, delivery and session-key construction.
- Hermes cron job list/create/update/delete/pause/resume/run HTTP endpoints.
- Durable Hermes Kanban boards/tasks/comments/links/runs in Hermes-owned SQLite.
- A local Hermes control contract for profile reads, profile mutations, model selection and profile events.

### 2.2 UNIFY adapter gaps that must be completed

These are UNIFY integration requirements. They must be implemented on the UNIFY side against existing Hermes interfaces. If Hermes does not expose a safe existing interface, the capability remains unsupported; Hermes must not be changed for UNIFY:

1. A supported, versioned UNIFY adapter API covering all profile operations safely reachable through existing Hermes interfaces.
2. Provider inventory, credential status, credential validate/save/delete and model selection without exposing secrets.
3. Projects and Kanban boards/tasks/comments/dependencies/runs through authenticated HTTP or JSON-RPC suitable for UNIFY.
4. A canonical global conversation view combining SessionDB records with Hermes Gateway route metadata.
5. A send endpoint that can answer an existing external Hermes conversation and route delivery through the original platform/thread exactly once.
6. Durable, replayable global framework events. The current profile control event ring is in-memory and too narrow for QA10.
7. Cursor pagination and source versions for large profile, task, session and message collections.
8. Scoped service authentication, request correlation, idempotency and optimistic concurrency for control calls.
9. Stable capability declarations for every read, validate, dry-run, execute, verify and subscribe operation.
10. Attachment/file handling owned by Hermes or an explicitly configured Hermes storage provider.

### 2.3 Version risk

The active installation reports Hermes `0.18.0 (2026.7.1)` with a local carried commit and substantial upstream distance. Before extending contracts:

- identify the exact deployed commit for every Hermes profile;
- inventory local control-plane changes;
- compare them with current upstream APIs;
- keep all required control adaptation in UNIFY;
- pin a tested Hermes release/commit in UNIFY framework registration;
- reject unsupported framework versions instead of guessing compatibility.

---

## 3. Target UNIFY-owned Hermes adapter contract

The contract is implemented and shipped only by UNIFY. It identifies and approaches an immutable Hermes framework through existing, independently supported Hermes interfaces. Hermes does not import, implement, or know about this contract. Adapter projections and derived events must preserve Hermes as the sole domain authority and must never create a competing domain ledger.

### 3.1 Contract metadata

Every Hermes response must include:

```json
{
  "contractVersion": "hermes-control/v1",
  "frameworkId": "opaque-stable-id",
  "frameworkVersion": "pinned-version",
  "sourceVersion": "monotonic-or-content-version",
  "observedAt": "ISO-8601",
  "data": {}
}
```

Every command must support, where applicable:

- `validate`;
- `dryRun`;
- `execute`;
- idempotency key;
- expected source version;
- request/correlation ID;
- actor/service identity forwarded for audit;
- verified readback;
- safe rollback evidence.

### 3.2 Framework and capabilities

```text
GET /control/v1/identity
GET /control/v1/health
GET /control/v1/capabilities
GET /control/v1/version
GET /control/v1/events?cursor=...
```

Capabilities are per exact framework and operation. Missing, unavailable and forbidden remain distinct.

### 3.3 Profiles and agents — Agency replacement

```text
GET    /control/v1/profiles
POST   /control/v1/profiles
GET    /control/v1/profiles/{profileId}
PATCH  /control/v1/profiles/{profileId}/identity
PATCH  /control/v1/profiles/{profileId}/model-routing
POST   /control/v1/profiles/{profileId}/runtime/{start|stop|restart}
GET    /control/v1/profiles/{profileId}/health
GET    /control/v1/profiles/{profileId}/usage
DELETE /control/v1/profiles/{profileId}
```

Rules:

- Hermes profile registry is the only profile inventory.
- Identity-file edits are atomic, path-allowlisted, size-limited and secret-scanned.
- Model references must be selectable in the same Hermes instance.
- Delete policy is explicit and defaults to deny for protected/default profiles.
- Every write returns source version and authoritative readback.

### 3.4 Providers, credentials and models — DMM replacement

```text
GET    /control/v1/providers
GET    /control/v1/providers/{providerId}
GET    /control/v1/providers/{providerId}/requirements
GET    /control/v1/providers/{providerId}/credential-status
PUT    /control/v1/providers/{providerId}/credential
POST   /control/v1/providers/{providerId}/credential/validate
DELETE /control/v1/providers/{providerId}/credential
GET    /control/v1/models?provider=...
GET    /control/v1/models/selectable?profile=...
GET    /control/v1/model-routing
```

Rules:

- Provider definitions come from Hermes provider/plugin registry.
- Saved provider/model choice in Hermes config remains authoritative.
- Raw credentials never return to UNIFY.
- UNIFY submits a credential only over the private authenticated control channel; Hermes stores it through its supported auth/secret mechanism.
- Credential status is metadata only: configured, source, validation state, expiry, last validation and safe error code.
- Deleting a credential does not uninstall a provider plugin.
- DMM catalog snapshots may be imported as historical audit evidence, never as current inventory.

### 3.5 Projects, Kanban and cron — Worker replacement

```text
GET    /control/v1/projects
POST   /control/v1/projects
GET    /control/v1/projects/{projectId}
PATCH  /control/v1/projects/{projectId}
POST   /control/v1/projects/{projectId}/activate
POST   /control/v1/projects/{projectId}/pause
DELETE /control/v1/projects/{projectId}

GET    /control/v1/boards
GET    /control/v1/boards/{boardId}/tasks
POST   /control/v1/boards/{boardId}/tasks
GET    /control/v1/tasks/{taskId}
PATCH  /control/v1/tasks/{taskId}
POST   /control/v1/tasks/{taskId}/{claim|start|block|unblock|complete|archive}
POST   /control/v1/tasks/{taskId}/comments
POST   /control/v1/tasks/{taskId}/links
GET    /control/v1/tasks/{taskId}/runs

GET    /control/v1/cron/jobs
POST   /control/v1/cron/jobs
PATCH  /control/v1/cron/jobs/{jobId}
POST   /control/v1/cron/jobs/{jobId}/{run|pause|resume}
DELETE /control/v1/cron/jobs/{jobId}
```

Rules:

- Projects map to Hermes project definitions and one or more Hermes Kanban boards; Worker PostgreSQL is not retained as a current ledger.
- Preserve UNIFY product semantics: Save needs a name; Save and Start needs name, goal and agents and activates immediately or on schedule.
- Hermes Kanban remains the single writer for tasks, lanes/status, claims, comments, dependencies and attempts.
- Hermes cron remains the single scheduler.
- Dispatcher policy is enforced in Hermes, not only described in UNIFY prompts or UI.
- UNIFY adds authorization and operation evidence but does not implement a second state machine.

### 3.6 Conversations and realtime — CHAT replacement

```text
GET    /control/v1/conversations?profile=...&source=...&cursor=...
POST   /control/v1/conversations
GET    /control/v1/conversations/{sessionId}
PATCH  /control/v1/conversations/{sessionId}
GET    /control/v1/conversations/{sessionId}/messages?cursor=...
POST   /control/v1/conversations/{sessionId}/messages
POST   /control/v1/conversations/{sessionId}/stop
POST   /control/v1/conversations/{sessionId}/fork
GET    /control/v1/conversations/{sessionId}/route
GET    /control/v1/runs/{runId}
GET    /control/v1/runs/{runId}/events
POST   /control/v1/runs/{runId}/approval
```

Rules:

- Conversation and message records come from Hermes `SessionDB`.
- External route metadata comes from Hermes Gateway session/origin metadata.
- Session keys are built only with Hermes `build_session_key()` or its public equivalent.
- Sending to a native session starts one Hermes run.
- Sending to an existing external session invokes Hermes Gateway delivery on the original platform/chat/thread and records exactly one user turn and one outbound result.
- Mirror ingest never starts a duplicate turn.
- A browser disconnect never interrupts a Hermes run unless an authorized stop command is issued.
- Global events carry `sessionId`, `profileId`, `runId`, message identifier, lifecycle state, source route and durable sequence.
- Token deltas may be ephemeral; session/message creation, completion, failure, delivery and approval events are durable.
- Message history uses opaque cursor pagination, not bounded whole-history JSON followed by slicing.

### 3.7 Durable event contract

Hermes must maintain a persistent event journal or an equivalent replay mechanism with:

- monotonic sequence within a framework;
- durable event ID;
- source version;
- event classification (`durable` or `ephemeral`);
- bounded retention with an explicit replay-gap response;
- reconnect using cursor/`Last-Event-ID`;
- backpressure and bounded subscriber queues;
- permission-safe payloads;
- correlation to UNIFY operation ID and Hermes run ID;
- events for profile, model/provider, work, cron, conversation, run, approval, delivery and health changes.

When replay is impossible, Hermes returns `replay_gap`; UNIFY performs authoritative reconciliation before advancing its cursor.

---

## 4. UNIFY Gateway rebuild

### 4.1 Module boundaries

```text
apps/gateway/src/
  frameworks/       registration, version negotiation, health
  hermes-client/    typed transport, auth, retries, circuit breaker
  capabilities/     capability and policy evaluation
  profiles/         normalized profile API
  catalog/          provider/model projections
  work/             project/Kanban/cron facade
  conversations/    sessions/messages/runs/delivery facade
  operations/       idempotency, preflight, state, verification
  events/           Hermes ingest, durable cursor, browser SSE
  auth/             users, sessions, RBAC, CSRF, service tokens
  audit/            immutable access and operation audit
  notifications/    derived notification projection
  settings/         UI and framework registration preferences
```

Delete the generic `MutationOwnerClient` model. Replace it with:

```text
HermesControlClient
HermesProfileAdapter
HermesProviderAdapter
HermesWorkAdapter
HermesConversationAdapter
HermesEventAdapter
```

All adapters target `frameworkId`, never a product owner.

### 4.2 Gateway-owned database records

Allowed:

- users, roles, permissions and sessions;
- framework registrations and non-secret endpoint references;
- encrypted/scoped service credential references if required;
- canonical mapping/alias records;
- operation, idempotency and preflight records;
- audit and evidence metadata;
- event cursors and dedupe keys;
- derived notification/search/cache projections with provenance and expiry;
- UI preferences.

Forbidden:

- canonical profile configuration;
- provider credential value or competing provider inventory;
- project/task/cron canonical state;
- canonical session/message history;
- platform route ownership;
- agent execution state inferred independently of Hermes.

### 4.3 Canonical identity

```text
urn:aquiero:hermes:{frameworkId}:profile:{nativeId}
urn:aquiero:hermes:{frameworkId}:provider:{nativeId}
urn:aquiero:hermes:{frameworkId}:model:{providerId}:{modelId}
urn:aquiero:hermes:{frameworkId}:project:{nativeId}
urn:aquiero:hermes:{frameworkId}:board:{nativeId}
urn:aquiero:hermes:{frameworkId}:task:{nativeId}
urn:aquiero:hermes:{frameworkId}:cron:{nativeId}
urn:aquiero:hermes:{frameworkId}:session:{nativeId}
urn:aquiero:hermes:{frameworkId}:message:{nativeId}
urn:aquiero:hermes:{frameworkId}:run:{nativeId}
```

Legacy IDs become aliases with migration provenance. They are never canonical IDs after cutover.

### 4.4 Public API

Keep domain-oriented UNIFY URLs so the UI is independent of Hermes wire details:

```text
/api/v1/frameworks/*
/api/v1/profiles/*
/api/v1/providers/*
/api/v1/models/*
/api/v1/work/*
/api/v1/chat/*
/api/v1/operations/*
/api/v1/events
```

The word `chat` may remain a user-facing domain name. It must not mean the retired CHAT application or appear as the source owner.

### 4.5 Security

- Browser receives only UNIFY cookies/tokens.
- UNIFY adapter endpoint and any existing Hermes credentials remain server-side.
- Use separate least-privilege service-auth references per registered framework adapter.
- Separate read, execute, secrets, delivery and approval scopes.
- Require CSRF on cookie-authenticated writes.
- Require idempotency keys and source versions on writes.
- Rate-limit by actor, framework and operation family.
- Recursively redact credentials, cookies, tokens, identity files and tool outputs.
- Audit denied and failed operations as well as successful ones.
- Do not log conversation bodies by default.
- Adapter TLS/private-network identity must be verified; no public unauthenticated UNIFY control-adapter endpoint.

---

## 5. UNIFY UI rebuild

### 5.1 UI role

UNIFY UI is the only operator control interface after cutover. It does not know legacy URLs or Hermes credentials. It renders Gateway contracts and permission/capability decisions.

### 5.2 Truthful UX rules

- Show `Hermes · <framework>` as source, never Agency/DMM/Worker/CHAT.
- Display current/stale/partial/unavailable/forbidden/unsupported explicitly.
- Disable controls based on both RBAC and exact framework capability.
- Never show success before verified readback or a terminal asynchronous state.
- Preserve operation progress across reloads.
- Show external conversation source/route and writability without exposing raw routing secrets.
- New incoming messages update in realtime without stealing scroll position.
- Reconnect status is visible; polling fallback is disclosed if active.
- Large collections use cursor loading and virtualization.
- Mobile, keyboard, screen-reader and reduced-motion behavior are release gates.

### 5.3 Final control surfaces

| Surface | Framework-backed controls |
|---|---|
| Profiles/Agents | Create, inspect, edit identity, route models, start/stop/restart, health, usage, protected delete |
| Models/Providers | Actual registry, credential status, validate/save/delete credential, selectable models, fallback routing |
| Work | Projects, agents, activation/schedule, boards, tasks, dependencies, comments, runs, cron, approvals |
| Chat | Agents, existing native/external sessions, paginated messages, new session, send, attachments, approvals, stop, realtime lifecycle |
| Operations | Validation, preflight, confirmation, execution, verification, rollback and evidence |
| Settings | Framework registrations, health/capabilities, access policy and UI preferences |

---

## 6. Data migration strategy

### 6.1 General rule

Migration is read/import into Hermes followed by Hermes readback. There is no dual-write period.

```text
legacy snapshot -> transform -> validate -> import to Hermes -> verify -> alias map
                                                     |
                                              only writer after import
```

### 6.2 Agency

Agency primarily wraps Hermes profile state. Do not migrate Agency copies as canonical records.

1. Compare Agency inventory with direct Hermes profile inventory.
2. Resolve profile ID aliases and framework registration IDs.
3. Import only Agency-exclusive audit annotations if valuable, as historical UNIFY evidence.
4. Switch UNIFY reads/writes to Hermes.
5. Run Agency read-only parity, then disconnect it.

### 6.3 DMM

1. Inventory DMM provider credential records without exporting secret values to artifacts.
2. Map every DMM provider ID to Hermes provider registry ID.
3. For credentials not already present in Hermes, perform an operator-approved server-to-server secret transfer directly into Hermes auth/secret storage.
4. Validate credentials through Hermes runtime resolution.
5. Import DMM catalog snapshots/diffs only as historical evidence.
6. Verify model selection and fallback behavior in real Hermes runs.
7. Remove DMM credentials and runtime dependency only after backup and approval.

### 6.4 Worker

1. Map Worker projects to Hermes projects and Kanban boards.
2. Map tasks, statuses, assignees, comments, dependencies, schedules, policy ceilings, approvals and rollback notes.
3. Reject mappings that would create duplicate active tasks or schedulers.
4. Import into Hermes with deterministic idempotency keys.
5. Compare board/task counts and semantic fields, not labels alone.
6. Move cron schedules to Hermes cron and prove only one scheduler fires.
7. Freeze Worker writes, run Hermes-only execution, then disconnect Worker.

### 6.5 CHAT

1. Inventory CHAT sessions and map them to Hermes sessions using explicit source/platform/chat/thread/profile identifiers—not titles.
2. Detect conversations already represented in Hermes SessionDB; do not duplicate them.
3. Import genuinely CHAT-only native sessions/messages into Hermes with original timestamps and migration provenance.
4. Reconstruct external route aliases from Hermes Gateway metadata; never copy raw secrets into UNIFY.
5. Reconcile message order, sender roles, attachments, lifecycle and delivery state.
6. Verify Telegram/thread identity and one-writer webhook ownership.
7. Exercise incoming external message -> Hermes persistence -> UNIFY realtime -> UNIFY reply -> Hermes external delivery.
8. Freeze CHAT writes, run Hermes-only communication, then disconnect CHAT.

### 6.6 Migration evidence

For each domain record:

- source legacy ID;
- target framework ID/native ID;
- transformation version;
- import operation ID/idempotency key;
- source and target hashes excluding secrets;
- verification result;
- conflict disposition;
- timestamp and actor;
- rollback or quarantine reference.

---

## 7. Phased implementation sequence

No phase is complete because code exists. Each phase must satisfy its exit gate with retained evidence.

### Phase 0 — Correct declarations and contain wrong writes

**Work**

- Mark current legacy adapters as migration-only.
- Remove all claims that legacy-backed CHAT is final QA10.
- Return production mutation mode to read-only unless an operation targets a verified Hermes adapter.
- Replace source-of-truth documentation.
- Add CI checks preventing new authoritative legacy owners and direct legacy URLs outside migration code.

**Exit gate**

- No production write is described as framework-authoritative while it targets a legacy app.
- CI fails on new `owner: agency|dmm|worker|chat` domain records.

### Phase 1 — Freeze contracts and framework registration

**Work**

- Define `hermes-control/v1` OpenAPI/JSON schemas.
- Define framework identity, versions, capability manifest, errors, pagination and event envelope.
- Add UNIFY framework registry and scoped service-auth configuration.
- Decide supported Hermes baseline after upstream/local reconciliation.

**Exit gate**

- Contract tests run against a real pinned Hermes fixture.
- Unsupported versions fail closed.

### Phase 2 — Complete UNIFY-side Hermes adapter foundations

**Work**

- Implement profile adaptation over existing Hermes interfaces.
- Implement provider credential/status adaptation where existing Hermes interfaces safely permit it.
- Implement Projects/Kanban adaptation over existing Hermes interfaces.
- Implement conversation/delivery adaptation over existing Hermes interfaces without running a second channel consumer.
- Add a UNIFY-owned derived event journal and reconciliation without treating it as domain truth.
- Add UNIFY-side idempotency, source-version derivation and correlation.

**Exit gate**

- UNIFY adapter integration suite proves every supported capability against an unchanged pinned Hermes checkout without Agency/DMM/Worker/CHAT running.
- Git verification proves the Hermes checkout was not modified; unavailable interfaces remain explicitly unsupported.

### Phase 3 — Rebuild UNIFY Gateway around Hermes

**Work**

- Implement typed `HermesControlClient` against the UNIFY-owned adapter contract and domain adapters.
- Replace owner mutation definitions with capability commands targeting `frameworkId`.
- Implement operation verification and event ingestion.
- Introduce cursor endpoints and framework provenance.
- Keep legacy readers isolated under `migration/legacy/*` and disabled by default.

**Exit gate**

- Runtime Compose needs no legacy URL/secret for a Hermes-only test deployment.
- Full Gateway contract/security/reliability suite passes.

### Phase 4 — Profiles and Models cutover

**Work**

- Move Profiles UI/API from Agency to Hermes.
- Move Models/Providers UI/API from DMM to Hermes.
- Perform shadow comparisons.
- Migrate credentials safely where required.

**Exit gate**

- Profile and provider/model QA10 pass with Agency and DMM stopped in rehearsal.

### Phase 5 — Work cutover

**Work**

- Implement project mappings and Hermes project operations.
- Replace Worker board/task/cron operations with Hermes calls.
- Migrate current project/work state.
- Verify Save versus Save-and-Start semantics and dispatcher policy.

**Exit gate**

- Work QA10 passes with Worker stopped; no duplicate dispatch or schedule execution.

### Phase 6 — Conversations cutover

**Work**

- Replace CHAT reads, mutations and WebSocket bridge with Hermes sessions/runs/events/delivery.
- Migrate/reconcile session and route aliases.
- Implement cursor history and attachments.
- Verify native and external conversations end-to-end.

**Exit gate**

- Chat QA10 passes with CHAT stopped; incoming and outgoing external messages continue through Hermes.

### Phase 7 — Unified UI and operational hardening

**Work**

- Remove legacy source language and product dependencies from UI.
- Finish responsive, accessible, virtualized domain surfaces.
- Add framework health, capability, reconnect, operation and evidence views.
- Add production metrics, alerts, backup and disaster recovery.

**Exit gate**

- Full browser/device/accessibility/performance/security suites pass.

### Phase 8 — Production canary and stable window

**Work**

- Activate one Hermes capability family at a time.
- Monitor error, latency, replay gaps, drift and delivery duplication.
- Run rollback rehearsal before and during canary.
- Maintain legacy apps read-only only for parity/reference.

**Exit gate**

- At least 14 stable days per domain or a separately approved stricter policy.
- Zero production UNIFY calls to legacy APIs for the accepted domain.

### Phase 9 — Legacy retirement

**Work**

- Revoke legacy service credentials and edge routes.
- Stop legacy containers for a full rehearsal window.
- Take verified final backups and document retention.
- Remove legacy adapters, secrets, Compose variables and code.
- Archive repositories/databases according to policy.

**Exit gate**

- Agency, DMM, Worker and CHAT are stopped and removable.
- UNIFY remains healthy and all QA10 smoke tests pass.
- No legacy endpoint appears in runtime network traces, configuration or secret inventory.

---

## 8. QA10 release gates

A domain is not production-ready until all ten gates pass.

### QA1 — Source-of-truth conformance

- Every domain response identifies Hermes and exact framework ID.
- No domain read/write/realtime path depends on a legacy app.
- No canonical domain table exists in UNIFY PostgreSQL.
- Framework readback matches the UI result.

### QA2 — Functional completeness

- Profiles, models/providers, work and conversations cover all accepted legacy workflows.
- Existing and new resources work.
- Unsupported capabilities are visibly disabled, not silently approximated.

### QA3 — Mutation safety

- Permission, capability, exact target, validation, dry-run/preflight, confirmation, idempotency, concurrency, execution and verified readback are tested.
- Destructive operations require stronger confirmation and rollback evidence.
- Duplicate/replayed requests do not duplicate framework state or external delivery.

### QA4 — Realtime correctness

- Durable events reconnect by cursor.
- Replay gaps cause authoritative reconciliation.
- Incoming messages/tasks/runtime changes appear without polling under normal operation.
- Ephemeral deltas cannot overwrite durable truth.
- Browser disconnect does not terminate framework work.

### QA5 — Security and access

- Named UNIFY identity and scoped RBAC protect every route/event.
- Browser has no framework or legacy credentials.
- Hermes service identity is least privilege and rotatable.
- CSRF, rate limits, origin policy, secret redaction and audit pass adversarial tests.

### QA6 — Reliability and failure truth

- Framework timeout/outage/restart, UNIFY restart, database restart and network interruption are tested.
- No outage becomes empty/success.
- Circuit breakers, retry limits and cancellation behave correctly.
- Operations end verified, failed or inconclusive—never guessed.

### QA7 — Data integrity and migration

- Counts, hashes, identity mappings, ordering, dependencies, schedules and external routes reconcile.
- Conflicts are resolved explicitly.
- Backups restore successfully.
- There is no dual writer or duplicate scheduler/webhook consumer.

### QA8 — UI, accessibility and responsive behavior

- Desktop and mobile workflows are complete.
- Keyboard, screen reader, focus, contrast, reduced motion and error announcements pass.
- Large inventories/history are virtualized and paginated.
- Truth, source, writability, pending and failure states are visible.

### QA9 — Performance and scale

- Define and pass SLOs for list/detail/mutation/event latency.
- Test realistic maximum profiles, models, tasks, sessions and messages.
- Event fan-out has bounded memory and backpressure.
- No unbounded whole-history payload or N+1 owner scan remains.

### QA10 — Production operations and retirement

- Health/readiness, metrics, logs, alerts, backup/restore and runbooks pass.
- Canary and rollback rehearsals have retained evidence.
- Domain remains operational with its legacy app stopped.
- Stable-window thresholds pass.
- Legacy credentials/routes are revoked and retirement is approved.

---

## 9. Required automated test suites

| Suite | Required proof |
|---|---|
| UNIFY Hermes-adapter contract | Schema/version/capability, pagination, source versions, errors, idempotency, readback |
| Gateway unit | RBAC, policy, mappings, redaction, operation transitions, cursor handling |
| Adapter integration | Real pinned Hermes instance for every read/write/event family |
| Migration | Repeatable import, dedupe, conflicts, hashes, rollback/quarantine |
| Event | Disconnect/reconnect, replay, replay gap, ordering, duplicate event, backpressure |
| Chat delivery | Existing Telegram/thread receive and answer, exactly-once external send, failed delivery truth |
| Work execution | Claims, dependencies, block/unblock, attempts, schedule, no duplicate dispatcher |
| Provider security | Credential never returned/logged; validate/save/delete semantics; provider isolation |
| E2E | Named-user workflows through public UNIFY only |
| Accessibility | axe plus keyboard/screen-reader assertions |
| Performance | Large histories/boards/models, event fan-out, mutation latency |
| Chaos/recovery | Hermes/UNIFY/Postgres restart, owner timeout, cursor loss, credential rotation |
| Retirement | Legacy services stopped and network calls denied while all accepted workflows pass |

Production tests must use dedicated QA profiles/projects/sessions and clean them up. UI-only tests must never create real production projects.

---

## 10. Cutover and rollback model

### 10.1 Capability-family flags

Replace legacy product flags with:

```text
profiles.read / profiles.execute
models.read / models.credentials.execute / models.routing.execute
work.read / work.execute / work.schedule.execute
conversations.read / conversations.execute / conversations.delivery.execute
```

Each flag binds to:

- exact `frameworkId`;
- Hermes contract and framework version;
- acceptance evidence reference;
- activation timestamp/approver;
- abort thresholds;
- rollback procedure.

### 10.2 Cutover sequence per domain

1. UNIFY adapter read contract against the unchanged Hermes framework passes.
2. Legacy-vs-Hermes shadow comparison passes.
3. Import/reconciliation completes.
4. Legacy write path is disabled.
5. Hermes is confirmed as the sole writer.
6. UNIFY read path switches to Hermes.
7. UNIFY execute path canaries on Hermes.
8. Framework readback and event evidence pass.
9. Legacy app is stopped in rehearsal.
10. Stable window passes.
11. Legacy service is retired.

### 10.3 Rollback

Rollback never makes a legacy app the source of truth again after Hermes import.

- Disable the affected UNIFY execute capability.
- Keep UNIFY reads on Hermes or show unavailable/stale truth.
- Repair/restore Hermes from its verified backup when Hermes itself is unhealthy, or revert the UNIFY control-adapter version.
- Replay or reconcile framework events.
- Legacy UI may be used only as a read-only diagnostic if it reads Hermes directly; its old database is not reactivated as writer.

---

## 11. Legacy-retirement checklist

For each of Agency, DMM, Worker and CHAT:

- [ ] Every workflow has an accepted Hermes-backed UNIFY equivalent.
- [ ] Historical data is migrated, archived or explicitly discarded with approval.
- [ ] Legacy database is not receiving writes.
- [ ] Legacy API receives zero UNIFY runtime traffic.
- [ ] Legacy browser route is removed or read-only with sunset notice.
- [ ] Service credentials are revoked.
- [ ] Edge/DNS routes are removed.
- [ ] Container stop rehearsal passes.
- [ ] Backup restore has been tested.
- [ ] Repository is archived with final version and migration manifest.
- [ ] Monitoring shows no consumers during the stable window.
- [ ] Final shutdown approval and QA10 evidence are recorded.

Final repository checks:

```text
No AGENCY_URL / DMM_URL / WORKER_URL / CHAT_URL in production Compose
No legacy password/token secrets in UNIFY
No production adapter imports from migration/legacy
No resource owner agency/dmm/worker/chat
No UI label claiming a legacy source is authoritative
No network connection from UNIFY containers to legacy ports
```

---

## 12. Implementation epics and deliverables

| Epic | Deliverable | Dependency |
|---|---|---|
| E0 Architecture correction | Binding ADR, corrected SoT matrix, CI architecture guard | None |
| E1 Hermes baseline | Pinned, verified Hermes release and local patch inventory; no Hermes modification | E0 |
| E2 UNIFY Hermes-adapter schemas | OpenAPI/JSON schemas, SDK fixtures, capabilities | E1 |
| E3 UNIFY adapter security | Scoped service auth, idempotency, versions, audit correlation | E2 |
| E4 Profile adaptation | Profile CRUD/runtime/health/usage through existing Hermes interfaces | E3 |
| E5 Provider/model adaptation | Registry, credentials, validation, routing through existing Hermes interfaces | E3 |
| E6 Work adaptation | Projects, Kanban, cron and event support through existing Hermes interfaces | E3 |
| E7 Conversation adaptation | Sessions/messages/runs/routes/delivery/attachments through existing Hermes interfaces | E3 |
| E8 Derived durable events | UNIFY journal, cursor, replay gap, subscriptions; Hermes remains domain SoT | E3-E7 |
| E9 Gateway framework layer | Registry, typed client, capabilities, operations, events | E2-E8 |
| E10 UNIFY Profiles/Models | Hermes-backed APIs/UI and migrations | E4-E5,E9 |
| E11 UNIFY Work | Hermes-backed APIs/UI and Worker migration | E6,E8-E9 |
| E12 UNIFY Chat | Hermes-backed APIs/UI and CHAT migration | E7-E9 |
| E13 Hardening | Security, performance, accessibility, chaos, DR | E10-E12 |
| E14 Cutover/retirement | Canary, stable window, shutdown and archive | E13 |

Parallelization is allowed only after E3: profile, provider, work and conversation UNIFY adapters may proceed in parallel, but all must use the same identity, capability, command and event envelope and must not modify Hermes.

---

## 13. Definition of done

UNIFY is fully production-ready only when all statements below are true:

1. Hermes is demonstrably the sole source and writer for every accepted domain resource.
2. UNIFY Gateway is the only public access boundary and contains no competing domain state machine.
3. UNIFY UI is the complete, truthful and accessible operator interface.
4. Existing chats/sessions receive realtime messages and can answer through Hermes-native routing.
5. New sessions, agents, provider/model changes, projects, tasks and schedules execute directly in Hermes.
6. All ten QA gates pass with retained evidence.
7. Agency, DMM, Worker and CHAT can be—and are—retired without functional regression.
8. Hermes Agent contains no UNIFY-specific code, contract, dependency or compatibility change.

Until then, any working legacy-backed integration is a migration bridge, not final production readiness.
