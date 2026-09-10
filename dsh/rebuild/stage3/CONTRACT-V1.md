# Stage 3 application contract v1 — implementation scope

Status: contract frozen for implementation; Stage 3 NOT qualified. Stage 2 remains the separately published engineering acceptance. This document is not live acceptance evidence.

## Ownership
- Application owns customer accounts, authentication, business data, conversations and delivery-effect deduplication.
- Core owns immutable application grants, bounded admission/idempotency receipts, native correlations and callback outbox. Receipt status is not editable native work state.
- Hermes owns native project/task/session execution and provider/model authentication. Source text and customers cannot grant tools or configure models.
- MemoryV4 owns candidates, governed knowledge, provenance, correction lineage and owner-side privacy scrubbing. Core may not modify MemoryV4 storage directly.

## Public interface
Version `alica-application/v1`. Strict JSON schemas live in `apps/gateway/src/applications/contract.ts`; undeclared fields are rejected before Fastify can strip them.

| Endpoint | Authority / meaning |
| --- | --- |
| POST /api/v1/applications | Owner session, users.manage, CSRF; validate real native project, source/callback policy, capture native endpoint/authority binding; one-time app credential and callback signing secret |
| POST /api/v1/applications/:id/credentials | Owner-only replacement app credential |
| DELETE /api/v1/applications/:id/credentials/:credentialId | Owner-only credential revocation |
| DELETE /api/v1/applications/:id | Revoke admission/grants, request in-flight cancellation; not a promise of instantaneous external effect reversal |
| POST /api/v1/application/requests | Backend-only `Bearer dsha1_...`, required Idempotency-Key; browser Origin/Cookie rejected |
| GET /api/v1/application/requests/:id | Exact authenticated application receipt only |
| POST /api/v1/application/requests/:id/cancel | Distinct cancellation request and native settlement |
| GET /api/v1/application/requests/:id/export | App-scoped projection, delivery metadata and native linkage; business export remains app-owned |
| DELETE /api/v1/application/requests/:id | Deletion-pending until native and memory owners confirm cleanup; then Core payload/result/outbox body scrub |

Grant fields: fixed framework/project, explicit delegated subject allowlist, operation allowlist, four or fewer approved HTTPS source URLs, optional fixed callback URL, bounded retention and fixed promotion policy. Customers cannot supply project/instance/model/profile/tool/callback overrides. Operations: answer, research, refresh, correction. Corrections name a prior same-app/same-subject receipt and require governed fact-level source validation.

Native endpoint/version/authority binding is captured server-side, never supplied by the app. Binding drift fails closed and requires explicit operator reconciliation; no silent rebind of outstanding work.

## Durability and limits
- Per-app persistent idempotency: identical payload => original receipt; changed payload => conflict. Registration/grant revocation and new admission serialize in PostgreSQL.
- Eight unsettled receipts and 60 new admissions/hour/app; replays do not consume new admission slots.
- Durable dispatch-unknown precedes native transport. Native creates a durable correlation before inference. Lost replies reconcile native state, never blindly replay paid work.
- Completion and one stable delivery ID are committed atomically. Callback retry cannot rerun inference. Consumer commits effect + delivery-ID tombstone before acknowledgment; same ID/different body fails.
- Signed callback: HMAC-SHA256(timestamp + '.' + deliveryId + '.' + exact UTF-8 body), five-minute timestamp window. Body includes contractVersion, deliveryId, receiptId, applicationId, subject and result.
- Public HTTPS IPv4 egress only; all DNS answers checked, chosen address pinned, TLS hostname retained, no redirects/proxies, bounded body and timeout. Optional exact operator-configured RFC1918 callback pins permit explicitly configured private integrations, not private research sources. Loopback, link-local/metadata and other reserved ranges remain denied even when pinned.
- Questions <=4000 characters, <=4 sources, <=8 facts, bounded native runtime and result. Source/model output never confers shell/tool authority.

## Knowledge and privacy gate
Research emits source-held bytes/digests, timestamps and source/native lineage. Candidate promotion requires approved provenance, literal quote/source agreement, relevance evaluation and deterministic policy checks; model confidence or a model-provided validated flag alone is insufficient. Canonical reuse, refresh, conflict quarantine and correction lineage must be exercised live.

Deletion is live-store logical erasure with minimal non-content audit/idempotency tombstones, not a claim of physical media or backup destruction. Owner-side cleanup must cover current and historical content, FTS and cached response copies. Unexpected external artifacts or unresolved dependencies fail closed. Backup expiry is operator-managed and not presumed verified.

## Required acceptance, still OPEN
Real independent app registration/login; actual native inference and approved-source research; knowledge reuse/refresh/correction; wrong-project/customer/binding and tool-escalation negatives; concurrent/restarted duplicate admission; callback disconnect/retry/replay and consumer restart; in-flight cancellation; complete governed export/delete/retention; isolated runtime guards; source publication, final OpenAPI/guide and evidence. Unit/mock results never substitute for these gates.

Implementation evidence so far: gateway unit/typecheck and isolated real PostgreSQL admission/concurrency tests. No Stage 3 runtime deployment or completion verdict yet.

## Qualified implementation

QA4 closes this bounded Stage 3 contract. See [as-built](QA4-AS-BUILT.md),
[evidence](QA4-ACCEPTANCE.json), and [exported JSON Schema](application-v1.schema.json).
`node dsh/rebuild/stage3/export-schema.mjs --check` verifies that the frozen
manifest/request schema matches the built gateway validators. The authorization
and lifecycle rules above apply in addition to syntactic JSON validation.
