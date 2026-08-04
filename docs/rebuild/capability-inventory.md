# Legacy Capability Inventory and Disposition

This inventory defines behavioral parity for the clean rebuild. It is not permission to copy code or preserve legacy API shapes.

## Evidence snapshot

| Reference implementation | Inspected commit | Primary evidence |
|---|---:|---|
| Worker | `b10678be35767dc0b9ff396e84cc9ec376bfd9b2` | `server/src/app.ts`, `server/src/routes/*`, domain/services/adapters |
| `/CHAT` | `42d4a8887c466de06db8cbbf7f9fc663391d3b85` | `server/src/rest.ts`, realtime/store/surface/Telegram modules |
| Agency | `c2a4e07d197391de60183177948a20ec54197b2e` | `src/server/routes/*`, inventory/reconciliation/apply services |
| DMM | `8059aeda66b57652fb0607717d892c0e3f82714e` | `server/src/api.ts`, catalog/credential/adapter stores |

The external repositories were inspected read-only. Their commits are evidence references, not Core dependencies.

## Dispositions

- **NATIVE** — implement and persist natively in UNIFY Core.
- **FRAMEWORK** — Core owns policy/command/operation/audit; a registered framework owns and reports the runtime effect.
- **INTEGRATION** — retain as a direct optional integration with the actual external system, never through a retired application.
- **DROP** — intentionally do not reproduce because it is a compatibility proxy, duplicate shell, unsafe ownership, or implementation detail. The underlying user outcome is covered elsewhere.

---

## 1. Worker capability inventory

### 1.1 Framework and normalized inventory

- **NATIVE/FRAMEWORK:** list registered harnesses/frameworks; health, capabilities and normalized snapshots.
- **NATIVE:** synchronize observed framework state; expose truthful freshness, source version, errors and partial/degraded status.
- **NATIVE:** migration/inventory reporting for projects and mappings; import preview and evidence.
- **DROP:** Worker adapter abstractions and compatibility response fields as public contracts.

### 1.2 Projects and boards

- **NATIVE:** list/get/create/update projects; resolve by ID or slug; validate unique identity.
- **NATIVE:** save inactive project with name only; save-and-start requires name, goal and agents; immediate or scheduled activation.
- **NATIVE:** project goal/description, workspace reference, links/files, agent team and project-manager role.
- **NATIVE:** project lifecycle states and transitions: saved/created, active/start/resume, paused/stop, finished, reflected, archived and restored.
- **NATIVE:** archive/delete semantics that preserve truthful active/history visibility and prohibit silent destructive loss.
- **NATIVE:** project event history and board mapping; one authoritative project-to-board mapping with version checks.
- **NATIVE:** schedule policy (none/manual, one-shot, recurring/every, cron, timezone, next activation) and activation scheduler tick.
- **NATIVE:** notification, cleanup, retention, reflection, autonomy and execution-routing policies per project.
- **NATIVE:** list/get board state, lane counts, activity and desired/observed classification.
- **NATIVE:** board source-of-truth report, invariants and database-health evidence.
- **NATIVE:** quarantine an inconsistent board and operator-approved restore from a verified backup.
- **NATIVE:** dispatcher status, one-board decision and global dispatcher tick with leases/idempotency.
- **NATIVE:** project assist/capability routing to eligible agents using advertised capabilities and role constraints.

### 1.3 Tasks/cards and comments

- **NATIVE:** list/get/create tasks with project/board, lane, priority, description, assignee/profile, capability contract and evidence references.
- **NATIVE:** start, move, block, unblock, complete and archive task transitions with canonical transition validation.
- **NATIVE:** comments/operator notes, author and immutable timestamps; redact secrets and summarize oversized evidence by reference.
- **NATIVE:** assignment and routing visibility; no hidden execution outside the visible card/operation trail.
- **NATIVE:** optimistic concurrency/source version and idempotency on all task mutations.
- **NATIVE:** task/project events and realtime fanout only after the durable mutation succeeds.
- **INTEGRATION:** submit/reconcile an Orchester intent when configured, including route report, idempotency key, return channel, terminal status, blockers and evidence. Core must also function without Orchester.

### 1.4 Autonomy, approvals and recovery

- **NATIVE:** canonical lifecycle definitions and allowed transitions.
- **NATIVE:** evaluate execution contracts, mandatory review loops, watchdog findings, staged activation and final autonomy certification.
- **NATIVE:** dry-run/evaluate separately from apply; every apply requires explicit policy-compliant confirmation and approval evidence.
- **NATIVE:** autonomous-mode arm/evaluate/run controls; production-level switch remains fail-closed and auditable.
- **NATIVE:** persistent approvals with expiry/scope and revocation.
- **NATIVE:** autonomous action audit entries and idempotency keys.
- **NATIVE:** rollback plans, execution status and result evidence.
- **NATIVE:** stalled/missing heartbeat detection and truthful degraded/blocking state.

### 1.5 Cron, runs and scheduling

- **NATIVE/FRAMEWORK:** list/get/create/run-now/pause/resume/remove scheduled jobs when the target framework advertises support.
- **NATIVE:** job prompt, model/profile, work directory reference, script mode, linked files, target project/card template, assigned agent and delivery policy.
- **NATIVE:** one-time and recurring schedule normalization, timezone and enabled state.
- **NATIVE:** run inventory, status, timestamps, target, outcome and evidence; deduplicate run commands.
- **NATIVE:** record and publish durable job/run change events.

### 1.6 Notifications

- **NATIVE:** notification channel inventory, channel-to-agent choices and metadata-driven target choices.
- **NATIVE:** provider inventory needed by notification delivery without exposing raw target noise.
- **NATIVE:** test delivery with explicit target and redacted result.
- **NATIVE:** inbox filtering, unread/read state and mark-read.
- **NATIVE:** delivery audit by project/task/channel/severity/outcome.
- **NATIVE:** events for task completion/failure, blockers, runner stall, approvals and project lifecycle.

### 1.7 Settings, files, memory and operations

- **NATIVE:** typed/versioned settings read/update with actor and update event; no unvalidated global key/value escape hatch.
- **NATIVE:** safe work-file upload metadata, limits, MIME validation and attachment references.
- **INTEGRATION:** memory-library status/list/create/update/delete/restore/upload outcomes may call the canonical Memory V3 API directly under an explicit contract.
- **DROP:** Worker’s Memory V3 proxy routes and any direct write to the retired `/srv/shared-memory` tree.
- **NATIVE:** health/readiness, sync freshness, metrics, operational diagnostics and resumable realtime stream.

---

## 2. `/CHAT` capability inventory

### 2.1 Identity and service operations

- **NATIVE:** authenticated current-user, login and logout outcomes are absorbed into central Core identity; login throttling and secure session behavior are retained.
- **NATIVE:** liveness, readiness, store health, uptime, realtime status, scale-boundary status and runtime-route diagnostics.
- **NATIVE:** separate browser authorization and scoped machine/service authorization.
- **DROP:** duplicate `/CHAT` operator-password store and cookies after central authentication cutover.

### 2.2 Agent and framework settings

- **NATIVE/FRAMEWORK:** list active agents available for conversation routing and their framework/runtime identities.
- **NATIVE:** normalized framework, agent and channel settings views from Core inventory.
- **FRAMEWORK:** verify framework reachability/capability and run an agent diagnostic prompt with bounded output/time.
- **NATIVE:** control-plane upsert of conversation-facing agent metadata/status.
- **NATIVE:** report agent status, bindings and diagnostics.

### 2.3 Sessions and ownership

- **NATIVE:** list active sessions, optionally by agent; create a native dashboard session.
- **NATIVE:** stable session key, agent ownership, source, external identity, title, channel label, status, sequence and timestamps.
- **NATIVE:** rename/update a session.
- **NATIVE:** delete user-owned native sessions; archive/hide externally owned mirrored sessions without claiming the external thread was deleted.
- **NATIVE:** reactivate an archived external projection on new external activity.
- **NATIVE:** one idempotent project/agent/purpose-to-session mapping for work notifications; reactivate and reuse an existing mapped session.

### 2.4 Messages and attachments

- **NATIVE:** list ordered message history for an authorized session.
- **NATIVE:** send text or validated structured blocks to a native session and stream the assistant response.
- **NATIVE:** durable user/system/agent message lifecycle, monotonic sequence, timestamps and complete/error status.
- **NATIVE:** idempotent machine-posted system messages.
- **NATIVE:** validated bounded uploads and file/image attachment references; reject empty or invalid blocks.
- **NATIVE:** persist and publish before asynchronous fanout; expose truthful downstream send failure without losing the accepted user message.

### 2.5 Realtime

- **NATIVE:** authorized WebSocket and/or SSE event delivery for session/message created, updated, deleted and streamed deltas.
- **NATIVE:** durable cursor/sequence resume, reconnect, heartbeat and backpressure behavior.
- **NATIVE:** filter events by user/service scope, agent and session ownership.
- **NATIVE:** preserve message ordering across restart and prevent duplicate replay effects.

### 2.6 Channels and external-thread projection

- **NATIVE:** channel binding metadata for Telegram and future supported channels: agent, framework/runtime identity, bot/user identity, secret references, status and session policy.
- **NATIVE:** binding diagnostics, activation state and dedicated-bot ownership rules.
- **NATIVE:** ingest external messages into an ownership-preserving session projection and route two-way visible replies to the same external conversation.
- **NATIVE/FRAMEWORK:** route sends through an advertised surface segment; validate writable/text/attachment/delivery capabilities before sending.
- **NATIVE:** distinguish runtime-only response from external-channel delivery and avoid duplicate assistant messages.
- **NATIVE:** per-external-chat or per-channel session policy and stable external conversation mapping.
- **DROP:** machine endpoints named for Agency or Worker; their outcomes become native Core commands.

---

## 3. Agency capability inventory

### 3.1 Framework discovery and inventory

- **NATIVE:** register/list/get frameworks; health, capabilities, version/identity and discovery status.
- **NATIVE:** manual/background discovery, inventory sync runs, latest run, reconciliation/drift report and events/status.
- **NATIVE:** list/get harnesses and normalized snapshots; model providers, provider models, selectable models and identity schema.
- **NATIVE:** dashboard summary, health/readiness and metrics based on Core-owned data.

### 3.2 Agent/profile lifecycle

- **NATIVE:** list/get/create/update/archive/delete agent records with truthful lifecycle and framework association.
- **NATIVE:** automatic setup only as an explicit reviewed workflow, not hidden side effects.
- **FRAMEWORK:** list/get/create/delete runtime profiles where supported.
- **FRAMEWORK:** read/write profile identity files with schema/path allow-list, protected-profile policy and source-version checks.
- **FRAMEWORK:** read/write profile model configuration.
- **FRAMEWORK:** runtime status/action, profile health and profile usage.
- **NATIVE:** Core agent-to-runtime-profile assignment, remove assignment and reconcile desired versus observed identity.
- **NATIVE:** protected profiles cannot be deleted or destructively rewritten without policy-authorized procedure.

### 3.3 Create-agent workflow

- **NATIVE:** create/list/get/update/delete drafts; draft is inactive until explicit activation/create action.
- **NATIVE:** channel schemas and validated channel intents.
- **NATIVE:** identity-file and model-assignment draft sections.
- **NATIVE:** generate secret material only through a secret manager workflow; store references, never return/re-persist raw values beyond one-time handling policy.
- **NATIVE:** set/rotate channel secret references; Telegram verify/save/sync and diagnostics.
- **NATIVE:** conversation secret provisioning/sync and diagnostics.
- **NATIVE:** per-channel verify-and-save and explicit activation.
- **NATIVE:** review check, evidence bundle and final-readiness evaluation.
- **NATIVE/FRAMEWORK:** final create-agent operation applies reviewed profile, identity, model and channel desired state with compensating/reconcile evidence.

### 3.4 Edit-agent workflow

- **NATIVE:** create/get/update edit draft from current observed state.
- **NATIVE:** assess each editable section independently before apply.
- **NATIVE:** edit model and allow-listed identity sections.
- **NATIVE:** review check and explicit apply with source-version conflict detection, operation evidence and reconciliation.

### 3.5 Models and usage

- **NATIVE:** model catalog and selectable inventory normalized from frameworks/providers.
- **NATIVE:** list/create/update/delete role/priority model assignments per agent.
- **NATIVE:** aggregate usage summary, per-agent/profile usage and telemetry status with source/freshness.
- **NATIVE:** immutable audit events and durable inventory/reconciliation event stream.

---

## 4. DMM capability inventory

### 4.1 Identity and audit

- **NATIVE:** current user, authenticated status, login/logout outcomes become central Core identity.
- **NATIVE:** DMM audit outcomes merge into immutable Core audit.
- **DROP:** duplicate DMM users, sessions, CSRF implementation and service-specific section shell after cutover.

### 4.2 Framework and catalog lifecycle

- **NATIVE/FRAMEWORK:** configured framework inventory and independent refresh.
- **NATIVE:** full or per-framework provider/model catalog refresh.
- **NATIVE:** update-driven lifecycle refresh without inventing models absent from framework/provider evidence.
- **NATIVE:** immutable catalog snapshots, normalized diffs and lifecycle history with source/version/freshness.
- **NATIVE:** normalized provider and model state, aliases, capabilities, context/output limits, availability and selectable status.

### 4.3 Provider credentials and validation

- **NATIVE:** provider credential requirements and authentication-method metadata.
- **NATIVE:** credential metadata/status inventory without returning secret values.
- **NATIVE:** create/replace and delete a provider credential through a secret-reference/secret-manager boundary.
- **NATIVE/FRAMEWORK:** validate configured provider credential against an actually available provider/framework path; record bounded redacted result.
- **NATIVE:** credential rotation timestamps, actor and audit; invalidate/reconcile dependent routes safely.

### 4.4 Model policy and routing

- **NATIVE:** provider/model enablement and availability policy.
- **NATIVE:** role/profile defaults, priority ordering and fallback chains.
- **NATIVE:** route resolution uses real inventory and required capabilities; explain selected route and rejection reasons.
- **NATIVE:** fail closed when credentials/capabilities are missing; never silently display or route to fictional inventory.

---

## 5. Cross-cutting capabilities deduplicated into Core

The following appeared in more than one application and must be implemented once:

- Central authentication, secure sessions, CSRF, MFA/RBAC/service credentials and security audit.
- Framework registry, health, capabilities, inventory refresh and desired/observed reconciliation.
- Agent/profile identity and model assignments.
- Provider/model inventory and usage.
- Durable operations, idempotency, optimistic concurrency, retries and redacted evidence.
- Notifications and resumable realtime events.
- Health/readiness/metrics and truthful degraded state.

## Inventory completion rule

A later design may split or rename a capability, but it may not silently remove one. Any disposition change requires an architecture decision record that identifies this inventory item, user-visible impact, replacement behavior and approval.
