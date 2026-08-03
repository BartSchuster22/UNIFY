# Initial Threat Model

## Scope

The model covers the public UNIUI origin, Gateway REST/SSE/WebSocket APIs, Gateway PostgreSQL, adapters, exact Hermes instances, AGENCY, DMM, WORKER, CHAT, MemoryV4 and focused applications. External chat systems are outside the UNIFY product boundary; attempts to expose them are in scope as boundary violations.

## Trust boundaries

1. Untrusted browser/native/external client to public Gateway edge.
2. Edge to Gateway private service.
3. Gateway to PostgreSQL and optional event broker.
4. Gateway to each downstream service with distinct credentials.
5. Downstream service to exact Hermes framework.
6. UNIFY Chat boundary to excluded external-session, mirror, route and relay data.
7. Build/CI system to image registry and deployment host.
8. Operator evidence/log access boundary.

## Assets

- Named identities, sessions, refresh tokens and RBAC grants.
- Downstream service credentials and DMM vault material.
- Profile identity/routing/runtime state.
- Worker project/policy/approval and Hermes Kanban/cron state.
- Internal Chat content and attachments; exclusion of external-channel routes and identities.
- Memory content, scopes, provenance and retrieval audit.
- Operation, idempotency and audit evidence.
- Framework mappings, deployment configuration, backups and release provenance.

## Threat register

| ID | Threat | Impact | Required controls | Blocking gate |
|---|---|---|---|---|
| T01 | Direct public access to legacy mutation API | Bypass central policy/audit | Private networking or authenticated edge, service auth, fail-closed startup, direct-access E2E | Before domain mutation cutover |
| T02 | Worker fail-open mutation auth | Unauthorized execution/deletion | Unconditional server auth, remove browser credential fallback, startup refusal, public-edge negative tests | Before any Worker mutation integration |
| T03 | Confused deputy targets wrong framework/resource | Cross-framework mutation | Canonical resource refs, framework-scoped RBAC, exact adapter binding, confirmation displays canonical target | Gateway foundation |
| T04 | Native ID collision | Read leak or wrong write | Compound IDs, mapping registry, collision fixtures, no label joins | Contracts/read adapters |
| T05 | Replay or duplicate execution | Double dispatch/send/write | Idempotency records, payload hash, optimistic concurrency, adapter support, no blind retries | Operations foundation |
| T06 | Stale-state mutation | Overwrite or unsafe operation | Source version/etag, short preflight expiry, re-read before execute, stale mapping blocks | Operations foundation |
| T07 | Credential leakage | Service compromise | Secrets/files or manager, separate adapter credentials, recursive redaction, no browser return, bundle/log/evidence scans | Every release |
| T08 | CSRF/session theft/fixation | Unauthorized actor action | HttpOnly Secure SameSite cookies, CSRF, rotation, revocation, HSTS, login throttling | Auth foundation |
| T09 | Privilege escalation | Cross-role/domain access | Deny-by-default RBAC, resource scopes, server/event authorization matrix, audit denied decisions | Auth foundation |
| T10 | Unauthorized SSE/WS subscription | Data leakage | Authenticate handshake, per-event scope filter, cursor bound to principal, reauthorize on permission change | Realtime phase |
| T11 | Event command injection | Unauthorized execution | Event transports carry no execution commands; mutations only via authenticated HTTP operation API | Realtime phase |
| T12 | External chat data or controls cross the UNIFY boundary | Data leakage, unauthorized delivery, duplicate execution | Fail-closed source/session filters, no route or channel-binding fields, realtime filtering, negative read/write tests | Chat integration |
| T13 | Malicious upload/path/content | RCE, exfiltration, storage abuse | Multipart limits, filename normalization, content sniffing policy, malware seam, private storage, signed/authorized download | Chat mutation phase |
| T14 | Public attachment URL | Private data leak | Authenticated download or short-lived signed URL, authorization on every access | Chat mutation phase |
| T15 | Memory sibling-scope leak | Sensitive memory disclosure | Named principals, consistent list/get/search semantics, indistinguishable forbidden/not-found policy, negative isolation tests | Memory read integration |
| T16 | Ungoverned canonical/live memory write | Integrity/governance loss | Separate write/promote permissions, legal transitions, provenance review, initial UI restriction | Memory mutation phase |
| T17 | Audit tampering or secret-bearing evidence | Loss of accountability/leak | Append-oriented records, restricted audit role, integrity controls, recursive redaction, external backup | Hardening |
| T18 | SPA fallback returns HTML for API 404 | False client success/monitoring errors | Route `/api/*` before SPA fallback and return JSON 404 | Edge/UI foundation |
| T19 | Gateway/source connection conflation | False operational confidence | Separate browser, event hub and each upstream bridge state/last event/lag | Realtime phase |
| T20 | Supply-chain/image compromise | Runtime compromise | Lockfiles, pinned base versions, SAST, dependency/container scan, SBOM, signed provenance where available | Every release |
| T21 | Backup unavailable or corrupt | Irrecoverable loss | Automated backup, age/readiness check, isolated restore rehearsal, retention and encryption | Before production mutation |
| T22 | Cache shown as current during outage | Unsafe operator decisions | Provenance, observed/expiry, stale state, read-only stale UI, false-empty tests | Read adapters/UI |
| T23 | Rate/resource exhaustion | Outage | Per-user/IP/operation limits, body bounds, cursor pagination, virtualization, adapter concurrency/timeouts/circuit breakers | Foundation and performance |
| T24 | Cross-site content/Markdown injection | Session/data compromise | Safe renderer, output encoding, restrictive CSP, no unsafe HTML by default | UI foundation |
| T25 | OAuth issuer mix-up, wrong audience or token substitution | Cross-instance access or confused-deputy authorization | Exact issuer/audience/type/client validation, trusted discovery/JWKS, negative cross-instance corpus | OIDC resource-server foundation |
| T26 | Native/public client secret extraction or authorization-code interception | Account/session takeover | Public-client classification, system browser, exact claimed HTTPS redirect, PKCE S256, no APK/SPA secret | Native/PUCA profile |
| T27 | Bearer or refresh-token replay | Unauthorized API access and persistent compromise | Short access lifetime, DPoP for required clients, rotating refresh-token family and reuse revocation | Native/PUCA profile |
| T28 | OAuth client registry abuse or drift | Malicious redirect, grant expansion or rogue application | Reviewed lifecycle, step-up, least-privilege provisioning adapter, exact readback/reconciliation, drift blocking | Application Registry |
| T29 | Identity Authority or signing-key outage/compromise | Login outage, false trust or lockout | Bounded issuer/JWKS cache, fail-closed ceilings, overlap/emergency rotation, alerting, backup/restore and no automatic password fallback | Identity operations |
| T30 | Unsafe account linking | Attacker binds an external identity to a privileged local principal | Never link by email/username alone; one-use challenge, existing-session/operator proof, exact issuer+subject and append-oriented audit | Identity migration |
| T31 | OAuth tokens/codes/DPoP proofs leak through browser, logs or evidence | Session theft or replay | BFF for web, server-side token storage, recursive redaction, bounded audit metadata and secret scans | Every auth release |

## Security invariants

- Production mutation authentication never fails open.
- Downstream credentials are not exposed to clients.
- Authorization is enforced at REST and event subscription boundaries.
- A connected browser is not proof of upstream health.
- An HTTP success response is not proof of a verified mutation.
- External-channel sessions, messages, routes, events and delivery controls never reach a UNIFY client.
- No arbitrary MemoryV4 canonical/live write is exposed before governance enforcement.
- Public health endpoints reveal no sensitive configuration.
- A valid identity token never bypasses UNIFY application, RBAC, framework/resource or operation policy.
- Tokens issued for another UNIFY instance or audience fail closed.
- Identity Authority failure never enables local-password fallback automatically.
- Native/public clients contain no client secret; browser OAuth tokens remain server-side when a BFF is available.

## Verification strategy

Automated security evidence includes permission-matrix tests, CSRF/CORS and session tests, replay/idempotency tests, direct-downstream browser-request detection, unauthorized SSE/WS tests, malicious upload cases, secret scans over source/bundles/logs/evidence, dependency/container scanning, backup restore and rollback rehearsal.

## Residual risks at bootstrap

This documentation phase does not remediate existing legacy weaknesses. Worker mutation auth, Chat drift/attachments/history, and MemoryV4 maturity remain blockers governed by later phase gates. Existing applications remain available; no cutover has occurred.
