# QA10 Authentication and Application Registry — Building and Implementation Plan

- **Status:** Binding implementation plan
- **Decision:** [`ADR 0005`](../adr/0005-PER-INSTANCE-OIDC-IDENTITY-AUTHORITY.md)
- **Scope:** Per-instance authentication for domestic UNIUI, focused web applications, Android APKs, CLIs, services and particular use-case applications (PUCAs)
- **Primary Identity Authority:** Keycloak, pinned and replaceable through standards
- **Production posture:** Robust, fail-closed and lightweight; no custom Authorization Server
- **Completion condition:** Every accepted client profile passes the ten QA gates, production canary and rollback/restore evidence, and direct password authentication can be disabled safely

---

## 1. Executive build decision

UNIFY Core remains the Layer 2 mediation, policy and audit boundary between clients and one exact Layer 1 framework instance. Authentication is added as a standards-based access-plane capability, not embedded as a new framework concern and not implemented separately by each UI.

The implementation SHALL add one per-instance Identity Authority and four cohesive UNIFY capabilities:

1. **OIDC/OAuth trust:** discovery, strict token verification, BFF login and logout;
2. **principal binding:** stable `issuer + subject` identities mapped to UNIFY roles and framework/resource grants;
3. **Application Registry:** reviewed application/client lifecycle and least-privilege access policy;
4. **client profiles:** domestic BFF, Android/native, browser PUCA, server PUCA, service and constrained CLI.

The shortest safe implementation path is:

1. freeze the protocol/security profile and capacity envelope;
2. deploy a private, pinned development Identity Authority;
3. implement vendor-neutral verification and principal binding;
4. migrate domestic UNIUI to OIDC through the existing server-session BFF pattern;
5. implement the Application Registry and provisioning reconciliation;
6. enable native and PUCA profiles one at a time;
7. add passkeys, step-up, key rotation, recovery and operational controls;
8. run conformance, attack, outage, restore and load gates;
9. canary production before disabling local password login.

No phase is complete merely because an endpoint works. Each phase must have tests, evidence, a committed revision and a verified GitHub push.

---

## 2. Goals and non-goals

### 2.1 Goals

- One robust authentication model for UNIUI, APKs and PUCAs.
- Per-instance issuer/audience isolation.
- Phishing-resistant passkeys and administrator step-up.
- Secure public/native clients without embedded secrets.
- Confidential service clients using asymmetric credentials where possible.
- Explicit user actor and application actor on every authorized request.
- UNIFY-owned fine-grained RBAC and framework/resource scopes.
- A governed, reconciling Application Registry with no secret readback.
- Standard discovery so a client can start from a UNIFY instance URL.
- Local, low-latency API token verification under normal operation.
- Safe outage behavior, signing-key rotation, backup, restore and rollback.
- A portable runtime path that can support another compliant Identity Authority later.

### 2.2 Non-goals

- Building an OAuth/OIDC Authorization Server in the Gateway.
- Moving framework-domain authorization into Keycloak.
- Giving any client direct Hermes credentials or framework endpoints.
- Supporting password grant, implicit grant or anonymous client registration.
- Building a global multi-instance identity federation in the first release.
- Adding Kubernetes, a service mesh, Kafka or Redis solely for authentication.
- Treating CORS origins as identity or authorization.
- Mirroring OAuth secrets into UNIFY PostgreSQL.
- Disabling the existing login path before an accepted rollback-controlled cutover.

---

## 3. Binding invariants

1. The exact Layer 1 framework remains source of truth for agent-domain state.
2. UNIFY Core remains the only public API boundary to framework capabilities.
3. The Identity Authority owns authentication credentials and OAuth protocol state; UNIFY owns domain authorization.
4. A valid token proves identity, not permission to perform a framework operation.
5. Every request binds both human/service principal and application client.
6. `issuer`, `audience`, `subject` and `client_id` are validated; labels and email addresses are never identity keys.
7. A token issued for one UNIFY instance is rejected by every other instance unless an explicit future federation policy says otherwise.
8. Native/public clients never possess a client secret.
9. Browser OAuth tokens never enter JavaScript when a BFF is available.
10. OAuth access never bypasses capability, RBAC, resource-scope, mutation-policy, idempotency or verified-readback controls.
11. Identity Authority failure never activates local-password fallback automatically.
12. Public anonymous Dynamic Client Registration remains disabled.
13. Client secrets, refresh tokens, cookies, codes, DPoP proofs and identity credentials never appear in logs or evidence.
14. Registry activation requires provision, readback and exact-policy reconciliation.
15. A phase is incomplete until code, tests and evidence are committed and pushed.

---

## 4. Target topology

```text
Internet
  |
  +-- https://uniui.aquiero.com/
  |     +-- static UNIUI
  |     +-- /api/v1/* -> UNIFY Gateway
  |     +-- /.well-known/oauth-protected-resource -> UNIFY Gateway
  |
  +-- stable per-instance issuer, e.g. https://id.uniui.aquiero.com/
        +-- OIDC login/passkeys
        +-- authorization/token/revocation endpoints
        +-- discovery and JWKS
        +-- no public administration or metrics

Private host/network
  +-- UNIFY Gateway
  +-- Keycloak (one process)
  +-- PostgreSQL
  |     +-- UNIFY database/schema and credentials
  |     +-- identity database/schema and separate credentials
  +-- exact Hermes framework adapter
```

### 4.1 Lightweight constraints

The initial deployment uses:

- one Keycloak process;
- the existing PostgreSQL server with strict database/credential separation;
- the existing reverse proxy and TLS automation;
- the existing Gateway server-session and CSRF foundation;
- local JWT verification with bounded JWKS caching;
- no per-request introspection under normal operation;
- no Redis/session cluster before horizontal scaling is approved;
- no auth proxy in front of the Gateway;
- no client-specific server component inside UNIFY.

Initial resource budgets are release gates, not assumptions:

| Budget | Initial target |
|---|---:|
| Identity Authority steady-state RSS | <= 512 MiB after tuning |
| Identity Authority hard memory limit | <= 1 GiB unless measured evidence approves more |
| Added steady-state CPU | negligible outside login/token activity |
| Added persistent storage | measured and retention-bounded |
| Login p95 excluding human interaction | <= 750 ms on the production host |
| Cached JWT verification p95 | <= 10 ms Gateway overhead |
| Added Gateway authorization p95 | <= 15 ms |

If Keycloak cannot meet the measured host envelope without weakening security, stop and run the same conformance profile against ZITADEL. Do not silently exceed the envelope.

### 4.2 Host-capacity prerequisite

The production host must have safe disk and memory headroom before pulling images, creating an identity database or retaining backups. The current root filesystem has recently been critically full; implementation must begin with a measured capacity gate and retention cleanup. Authentication must not be deployed onto a host that cannot retain current encrypted backups and rollback images.

---

## 5. Standards and security profile

### 5.1 Required standards

| Capability | Standard/profile |
|---|---|
| User authentication | OpenID Connect Core 1.0 |
| OAuth security baseline | RFC 9700 |
| User-facing authorization | Authorization Code |
| Public-client code binding | PKCE `S256`, RFC 7636 |
| Native application behavior | RFC 8252 |
| Authorization Server discovery | RFC 8414 / OIDC discovery |
| Resource-to-issuer discovery | RFC 9728 |
| JWT access-token shape | RFC 9068 when JWT is selected |
| Native/public proof of possession | DPoP, RFC 9449 |
| High-assurance authorization requests | PAR, RFC 9126 |
| Token revocation | RFC 7009 |
| Optional introspection | RFC 7662 |
| Constrained client login | RFC 8628 where approved |
| Optional delegated service exchange | RFC 8693 in a later reviewed phase |
| Passkeys | WebAuthn/FIDO2 |

OAuth 2.1 remains a draft at plan creation. The build follows its security direction but uses finalized RFCs as binding requirements.

### 5.2 Forbidden protocol behavior

- Implicit Grant;
- Resource Owner Password Credentials Grant;
- password collection by native/PUCA clients;
- wildcard redirect URIs;
- accepting an ID token as an API token;
- unsigned tokens or symmetric algorithms shared across unrelated clients;
- caller-supplied issuer or JWKS URL;
- client secrets embedded in APK/SPA bundles;
- refresh tokens in localStorage/sessionStorage;
- bearer tokens in URLs;
- anonymous/unbounded Dynamic Client Registration;
- permanent static API keys as the normal PUCA protocol.

### 5.3 Token validation

The Gateway verifier must enforce:

- exact allowlisted issuer;
- exact resource audience;
- allowed asymmetric signature algorithm;
- issuer-bound JWKS URL from trusted discovery;
- `exp`, `nbf`, optional bounded `iat` and clock skew;
- token type and required scopes;
- stable `sub`;
- `client_id`/`azp` consistency;
- instance/organization binding where configured;
- DPoP `cnf.jkt`, proof signature, `htm`, `htu`, `iat`, nonce and replay cache when DPoP is required;
- no network retrieval based on token header input.

Unknown `kid` triggers one bounded JWKS refresh with request coalescing. Repeated unknown keys fail closed and are rate-limited. Cached keys have an explicit stale ceiling and overlap window for controlled rotation.

### 5.4 Initial lifetime profile

Exact values remain configurable by risk class. The initial tested profile is:

| Artifact | Initial policy |
|---|---|
| Authorization code | single use, 60–90 seconds |
| Access token | approximately 5 minutes |
| BFF session | idle timeout plus 8-hour absolute ceiling |
| Native refresh token | rotation on every use; family reuse detection |
| Administrative step-up | recent phishing-resistant authentication, maximum age 5 minutes for critical operations |
| DPoP proof replay | rejected through bounded `jti` cache |
| Signing-key overlap | old public key retained through maximum token lifetime plus skew |

---

## 6. Client profiles

### 6.1 Domestic UNIUI and focused first-party web applications

Use a Gateway-owned BFF flow:

```text
GET /api/v1/auth/oidc/start
  -> create one-use state, nonce and PKCE verifier server-side
  -> set transaction cookie/session binding
  -> redirect to Identity Authority

GET /api/v1/auth/oidc/callback
  -> verify state and transaction binding
  -> exchange code server-to-server
  -> verify issuer, nonce, audience and PKCE result
  -> resolve/link principal
  -> create/rotate opaque UNIFY session
  -> retain OAuth tokens server-side only when required
  -> redirect to an allowlisted local path
```

Browser rules:

- only opaque `HttpOnly`, `Secure`, `SameSite` session cookie;
- existing CSRF double/triple binding remains for mutations;
- session rotates at login and privilege change;
- post-login redirect is local and allowlisted;
- frontend never reads access or refresh tokens;
- logout revokes BFF session and performs OIDC logout where supported.

### 6.2 Android Chat APK and native PUCAs

- public OAuth client;
- system browser or OS authorization agent, never WebView;
- Authorization Code + PKCE `S256`;
- claimed HTTPS Android App Link;
- exact package name and release signing-certificate fingerprints in registry;
- DPoP key generated non-exportably in Android Keystore;
- refresh token in platform-protected storage;
- rotating refresh token and reuse-family revocation;
- device/session list and remote revoke;
- app attestation only as an additional risk signal;
- maintained AppAuth-based integration where compatible.

### 6.3 Browser PUCA

Preferred profile is a confidential BFF equivalent to UNIUI. A direct SPA profile requires a separate security acceptance and must use Authorization Code + PKCE, strict CSP, no long-lived token storage and DPoP where supported. Lack of a backend is not sufficient reason to weaken token handling silently.

### 6.4 Server PUCA with user delegation

- confidential OIDC client;
- Authorization Code + PKCE;
- PAR required for high-risk clients;
- `private_key_jwt` preferred;
- audit preserves `sub` and `client_id`/`azp`;
- user consent or first-party administrative approval according to application class;
- no broader UNIFY rights than the intersection of user grant, application grant and exact resource policy.

### 6.5 Autonomous service PUCA

- Client Credentials;
- dedicated service principal;
- asymmetric `private_key_jwt` or mTLS preferred;
- no human `sub` fabrication;
- narrowly scoped audience, operation families and framework resources;
- key rotation and emergency revocation;
- service operation audit records both service identity and application.

### 6.6 CLI/constrained device

Use normal native browser callback when available. Enable Device Authorization Grant only for an approved client type with bounded polling, short user codes, rate limits and explicit operator visibility.

---

## 7. Data and domain model

### 7.1 Identity tables

Migrations should evolve local users into external principal bindings without losing RBAC history:

```text
identity_issuers
  id, issuer_url, discovery_url, audience, status,
  jwks_cache_metadata, created_at, updated_at

principal_identities
  id, principal_id, issuer_id, subject,
  username_snapshot, display_name_snapshot,
  email_snapshot, linked_at, last_seen_at, disabled_at
  UNIQUE(issuer_id, subject)

identity_link_challenges
  id, local_user_id, issuer_id, subject, state_hash,
  expires_at, consumed_at, approved_by
```

Emails and usernames are display/recovery metadata, never unique cross-system identity keys.

### 7.2 BFF authentication transactions and sessions

```text
oidc_transactions
  id, state_hash, nonce_hash, pkce_verifier_encrypted_or_wrapped,
  return_path, issuer_id, created_at, expires_at, consumed_at

sessions
  existing opaque token hash and CSRF hash,
  plus principal_id, issuer_id, identity_subject,
  oauth_client_id, authentication_context,
  authentication_methods, authenticated_at,
  step_up_expires_at, token_family_reference where required
```

One-use transaction material is short-lived, encrypted where it must be recoverable and deleted immediately after callback or expiry.

### 7.3 Application Registry tables

```text
applications
  id, slug, display_name, description, application_type,
  owner_principal_id, environment, status,
  identity_issuer_id, oauth_client_id,
  dpop_required, par_required,
  created_at, approved_at, approved_by,
  suspended_at, revoked_at, retired_at

application_redirect_uris
application_logout_redirect_uris
application_origins
application_public_keys
application_apk_identities
  package_name, signing_certificate_sha256, app_link_host

application_grants
  application_id, permission, framework_id, resource_scope,
  effect, valid_from, valid_until, approved_by

application_registration_revisions
  desired_metadata_json, desired_hash,
  observed_metadata_json, observed_hash,
  provider_revision, reconciliation_state,
  observed_at

application_credentials_metadata
  key_id, credential_type, created_at, expires_at,
  rotated_at, revoked_at

application_audit_events
  append-oriented lifecycle and reconciliation evidence
```

No table stores a readable client secret. If a legacy confidential client temporarily requires a secret, it is generated/displayed once by the Identity Authority and only its status/rotation metadata is projected into UNIFY.

### 7.4 Application lifecycle

```text
draft
  -> security_review
  -> approved
  -> provisioning
  -> active
  -> suspended
  -> revoked
  -> retired
```

State transitions are server-enforced. `active` requires exact readback parity. Suspension prevents new UNIFY authorization immediately and disables/restricts the OAuth client through reconciliation. Revocation is terminal unless a separately audited re-registration creates a new client identity.

---

## 8. Gateway module design

```text
apps/gateway/src/
  identity/
    issuer-registry.ts
    oidc-discovery.ts
    jwks-cache.ts
    access-token-verifier.ts
    dpop-verifier.ts
    principal-resolver.ts
    claims-mapper.ts
  auth/
    bff-login.ts
    bff-callback.ts
    logout.ts
    sessions.ts
    step-up.ts
  applications/
    service.ts
    policy.ts
    routes.ts
    repository.ts
    reconciliation.ts
    types.ts
  provisioning/
    client-registry-provisioner.ts
    keycloak-provisioner.ts
  authorization/
    principal-context.ts
    decision.ts
    application-grants.ts
    resource-grants.ts
```

### 8.1 Runtime adapter interfaces

```ts
interface OidcIssuerAdapter {
  discover(issuer: URL): Promise<TrustedIssuerMetadata>;
  getVerificationKeys(issuerId: string): Promise<VerificationKeySet>;
  verifyAccessToken(input: AccessTokenInput): Promise<ExternalIdentity>;
  verifyIdToken(input: IdTokenInput): Promise<ExternalIdentity>;
  verifyDpop?(input: DpopInput): Promise<DpopBinding>;
}

interface ClaimsMapper {
  map(identity: ExternalIdentity): Promise<PrincipalIdentityInput>;
}

interface ClientRegistryProvisioner {
  create(desired: DesiredClient): Promise<ObservedClient>;
  update(id: string, desired: DesiredClient): Promise<ObservedClient>;
  disable(id: string): Promise<ObservedClient>;
  rotateKey(id: string, request: RotationRequest): Promise<ObservedClient>;
  read(id: string): Promise<ObservedClient>;
}
```

Normal token validation uses `OidcIssuerAdapter`. Only registry administration uses `ClientRegistryProvisioner`.

### 8.2 Unified principal context

Cookie sessions and OAuth tokens must converge into one internal model:

```ts
interface PrincipalContext {
  principalId: string;
  issuer: string;
  subject: string;
  applicationId: string;
  oauthClientId: string;
  sessionId?: string;
  tokenId?: string;
  dpopThumbprint?: string;
  roles: string[];
  permissions: string[];
  oauthScopes: string[];
  frameworkScopes: string[];
  resourceScopes: string[];
  authenticationContext?: string;
  authenticationMethods: string[];
  authenticatedAt: string;
}
```

Authorization is the intersection of:

```text
valid identity
AND active principal
AND active registered application
AND OAuth scope
AND UNIFY permission
AND framework/resource grant
AND exact framework capability
AND operation/mutation policy
AND required authentication strength
```

### 8.3 Error contract

Return stable non-secret codes:

- `AUTH_REQUIRED`
- `AUTH_TOKEN_INVALID`
- `AUTH_ISSUER_UNTRUSTED`
- `AUTH_AUDIENCE_INVALID`
- `AUTH_DPOP_REQUIRED`
- `AUTH_DPOP_INVALID`
- `AUTH_STEP_UP_REQUIRED`
- `APPLICATION_UNKNOWN`
- `APPLICATION_INACTIVE`
- `APPLICATION_SCOPE_FORBIDDEN`
- `IDENTITY_LINK_REQUIRED`
- `IDENTITY_AUTHORITY_UNAVAILABLE`

Do not reveal whether a subject, client secret or local account exists.

---

## 9. Application Registry API

Proposed versioned routes:

```text
GET    /api/v1/identity/issuers
GET    /api/v1/auth/me
POST   /api/v1/auth/oidc/start
GET    /api/v1/auth/oidc/callback
POST   /api/v1/auth/logout
POST   /api/v1/auth/step-up
GET    /api/v1/auth/sessions
DELETE /api/v1/auth/sessions/{sessionId}

GET    /api/v1/applications
POST   /api/v1/applications
GET    /api/v1/applications/{applicationId}
PATCH  /api/v1/applications/{applicationId}
POST   /api/v1/applications/{applicationId}/submit-review
POST   /api/v1/applications/{applicationId}/approve
POST   /api/v1/applications/{applicationId}/provision
POST   /api/v1/applications/{applicationId}/reconcile
POST   /api/v1/applications/{applicationId}/suspend
POST   /api/v1/applications/{applicationId}/revoke
POST   /api/v1/applications/{applicationId}/keys/rotate
GET    /api/v1/applications/{applicationId}/revisions
GET    /api/v1/applications/{applicationId}/audit

GET    /.well-known/oauth-protected-resource
```

All mutations use existing UNIFY operation governance: permission, CSRF where cookie-authenticated, idempotency, validation/dry-run where useful, explicit high-risk confirmation, operation evidence and readback.

### 9.1 New permissions

- `applications.read`
- `applications.create`
- `applications.review`
- `applications.manage`
- `applications.credentials.rotate`
- `identity.issuers.read`
- `identity.issuers.manage`
- `identity.sessions.manage`
- `identity.audit.read`

Application permissions never grant framework permissions by themselves.

---

## 10. Keycloak deployment plan

### 10.1 Version and image policy

- pin exact semantic version;
- pin container image digest in production;
- generate and retain SBOM/provenance where available;
- scan image before promotion;
- never use `latest`;
- stage upgrade against conformance and rollback suites;
- retain one tested rollback image within bounded disk retention.

### 10.2 Database separation

- separate database/schema and least-privilege database user;
- Gateway cannot read Identity Authority credential tables;
- Identity Authority cannot read UNIFY domain/audit tables;
- encrypted backups and independent restore checks;
- migration version recorded with release evidence.

### 10.3 Network and edge

Public:

- issuer discovery;
- authorization/login/passkey pages;
- token/revocation endpoints required by registered clients;
- JWKS;
- user logout endpoints.

Private:

- admin console/API except tightly controlled operator access;
- metrics;
- health details;
- database;
- management/bootstrap endpoints.

Apply exact hostname/issuer configuration, TLS, HSTS, frame policy, request bounds and trusted proxy settings. Startup fails if hostname, database or production secrets are absent.

### 10.4 Realm/tenant configuration as code

Store sanitized declarative configuration and hashes in Git. Do not commit secrets, private signing keys, recovery codes or registration access tokens. Build an idempotent bootstrap/reconciliation command that:

- creates/updates the instance realm or organization;
- configures approved flows and disables forbidden grants;
- enables passkeys/WebAuthn;
- configures token lifetimes;
- installs client policies;
- creates a bootstrap administrative identity through one-time secret procedure;
- creates the Gateway BFF client;
- reads all settings back and emits redacted evidence.

### 10.5 Key management

- signing keys generated in the Identity Authority/HSM-capable store;
- private keys never exported into Git evidence;
- documented routine and emergency rotation;
- overlapping public JWKS publication;
- Gateway unknown-key refresh and bounded stale cache tested;
- rollback does not reactivate compromised keys.

---

## 11. Identity migration and cutover

### 11.1 Preserve local authorization history

Existing UNIFY user IDs remain local principal IDs so roles, audit records and operation evidence stay linked. Add one or more external identities to each principal.

### 11.2 Safe account linking

Preferred migration for the initial administrator:

1. create matching named identity in the Identity Authority through bootstrap;
2. authenticate through OIDC with phishing-resistant factor enrollment;
3. require an authenticated existing UNIFY session or one-time operator-approved link challenge;
4. display both identities and require explicit confirmation;
5. bind exact `issuer + sub` to the existing principal;
6. write append-oriented audit evidence;
7. test new login, session revoke and recovery before changing defaults.

Never auto-link solely by email or username.

### 11.3 Dual-path migration rules

During migration:

- local password route is feature-flagged and edge-restricted where possible;
- login UI defaults to OIDC only after accepted BFF tests;
- OIDC outage never falls back automatically;
- local sessions and OIDC-origin sessions are distinguishable in audit;
- permission changes affect both paths identically;
- rollback can restore the prior release without database loss;
- rollback window has an explicit expiry and owner.

### 11.4 Final removal

After QA10 acceptance:

- disable local password login at edge and Gateway;
- verify no local-password login calls in canary and logs;
- retain password hashes only for the approved rollback retention period;
- remove hashes and authentication pepper through a reviewed migration;
- remove bootstrap password secret;
- update current-state authentication documentation;
- prove identity backup/restore and break-glass access independently.

---

## 12. Passkeys, MFA, recovery and step-up

### 12.1 Baseline

- passkeys available to every user;
- at least one WebAuthn/passkey required for administrators;
- recovery codes available with one-time display and secure hashing/storage by Identity Authority;
- TOTP may be an approved fallback;
- SMS is not accepted as the primary high-assurance factor;
- user can list and revoke sessions/authenticators;
- adding/replacing an authenticator requires recent authentication.

### 12.2 Step-up operations

Require a recent approved `acr`/`amr` for:

- application approval/provision/revocation;
- client key rotation;
- issuer configuration;
- user/role/permission changes;
- framework credential operations;
- destructive/protected framework operations;
- passkey and recovery-method changes;
- security/retention policy changes.

Gateway returns `AUTH_STEP_UP_REQUIRED` with a safe local continuation reference, not the original sensitive payload. After step-up, the operation still requires its normal confirmation/idempotency controls.

### 12.3 Break-glass

Break-glass is offline, disabled by default, hardware/secret-manager protected, time-bounded, separately approved and fully audited. It never activates automatically due to an outage.

---

## 13. Observability and audit

### 13.1 Audit actor chain

Every authorization and meaningful operation records:

- request/correlation ID;
- issuer and subject pseudonymous/stable reference;
- local principal ID;
- application ID and OAuth client ID;
- session ID or token `jti` where safe;
- DPoP key thumbprint where applicable;
- authentication context/methods and time;
- requested scope and resulting decision;
- framework/resource target;
- reason code;
- no raw token, code, cookie, secret or DPoP proof.

### 13.2 Metrics

- login start/callback success and failure by safe reason;
- token verification success/failure by safe reason;
- JWKS refresh, age and unknown-key counts;
- Identity Authority readiness and latency;
- active/revoked sessions;
- DPoP replay rejection;
- registry drift and reconciliation failures;
- application lifecycle counts;
- step-up required/success/failure;
- rate-limit and lockout counts;
- backup age and restore-rehearsal status.

Labels must be bounded. Never label metrics with user subject, token ID or arbitrary client input.

### 13.3 Alerts

Alert on:

- issuer/JWKS unavailability near stale ceiling;
- signing-key mismatch surge;
- token validation failure surge;
- DPoP replay;
- anonymous registration exposure;
- registry drift;
- backup age breach;
- Identity Authority restart loop;
- database migration failure;
- resource-limit pressure;
- administrative login without required authentication context.

---

## 14. Failure and resilience design

### 14.1 Identity Authority unavailable

- new login and token refresh unavailable truthfully;
- cached JWT validation continues only for already trusted keys and unexpired tokens within policy;
- existing BFF sessions continue only within their own expiry and authorization state;
- high-risk/step-up operations fail closed;
- UI reports `IDENTITY_AUTHORITY_UNAVAILABLE` rather than invalid credentials;
- no local-password auto-fallback;
- metrics and alert fire.

### 14.2 PostgreSQL unavailable

Gateway authorization fails closed when current principal/application grants cannot be established. Identity Authority login may also become unavailable. Readiness reflects the distinction; no cached broad permission fallback is permitted.

### 14.3 Signing-key rotation

- new and old keys overlap;
- Gateway refreshes discovery/JWKS predictably;
- existing unexpired tokens signed by the retiring key remain valid only through policy;
- emergency compromise rotation may revoke sessions/tokens and intentionally fail old tokens;
- rollback cannot restore a compromised private key.

### 14.4 Registry drift

If observed OAuth client metadata differs from approved desired metadata:

- mark client `drifted`;
- block activation and high-risk use;
- alert;
- require explicit reconcile/diff review;
- never overwrite unexplained provider state silently.

---

## 15. Testing strategy

### 15.1 Unit tests

- issuer and audience validation;
- clock boundaries;
- claim mapping;
- principal linking;
- application lifecycle;
- permission intersection;
- DPoP proof and replay cache;
- JWKS refresh/coalescing/stale policy;
- redirect and return-path allowlists;
- redaction.

### 15.2 Integration tests

Use a pinned real Identity Authority container and PostgreSQL. Test:

- realm/bootstrap idempotency;
- OIDC discovery and JWKS;
- code + PKCE flow;
- BFF callback and session rotation;
- logout/revocation;
- passkey-capable flow seams;
- confidential client authentication;
- service principal;
- client provisioning/readback/reconciliation;
- key rotation;
- issuer outage and recovery;
- database migration and rollback.

Do not claim QA10 from a mocked OIDC server alone.

### 15.3 Protocol and attack tests

- state/nonce replay;
- code injection and replay;
- PKCE downgrade;
- redirect URI and open-redirect attacks;
- issuer mix-up;
- wrong audience/cross-instance token;
- ID-token-as-access-token substitution;
- signature algorithm confusion;
- unknown/malicious `kid`;
- JWKS SSRF attempts;
- expired/not-yet-valid tokens;
- stolen bearer and DPoP mismatch;
- DPoP `jti` replay and method/URL mismatch;
- refresh-token reuse;
- session fixation;
- CSRF/login CSRF;
- application suspended during active session;
- user permission revoked during active session;
- client registry privilege escalation;
- secret and token leakage scans.

### 15.4 Client E2E matrix

| Scenario | UNIUI BFF | Android | Browser PUCA | Server PUCA | Service |
|---|---:|---:|---:|---:|---:|
| Login/token acquisition | required | required | required | required | required |
| Correct instance audience | required | required | required | required | required |
| Revocation | required | required | required | required | required |
| User + app permission intersection | required | required | required | required | service equivalent |
| Step-up | required | required where supported | required | required | admin rotation only |
| Offline/reconnect | session policy | required | client-specific | required | required |
| Audit actor chain | required | required | required | required | required |

### 15.5 OpenID conformance

Run the applicable OpenID Foundation conformance profiles against the deployed issuer/client configuration. Store sanitized test-plan identifiers, exact versions, timestamps and outcomes. Secrets and full tokens remain outside Git evidence.

### 15.6 Performance/load

Measure:

- cached JWT verification;
- login/token endpoint concurrency;
- refresh rotation;
- Application Registry list/reconcile;
- JWKS rotation under load;
- rate-limit behavior;
- memory/CPU steady state and peak;
- Identity Authority restart and warm-up.

Load tests use disposable test principals and clients, never real projects or framework mutations.

---

## 16. QA10 release gates

| Gate | Required authentication/registry evidence |
|---|---|
| 1. Contract correctness | OpenAPI, generated SDK, discovery/resource metadata, schema compatibility and client-profile contract tests |
| 2. Identity/truth integrity | Exact issuer/subject/client/audience binding, no email linking, no cross-instance acceptance, accurate application state |
| 3. Security | RFC 9700 profile, PKCE, DPoP/PAR where required, passkeys, authz matrix, CSRF/CORS, scans, attack tests, no high/critical findings |
| 4. Operation safety | Application lifecycle idempotency, step-up, confirmation, key rotation, provision/readback/reconcile and rollback evidence |
| 5. Reliability | Identity/JWKS/database outage and recovery, refresh reuse, restart, timeout and stale-cache boundaries |
| 6. Data durability | UNIFY + Identity Authority migration, encrypted backup, isolated restore, realm/client/user/role parity and audit integrity |
| 7. Client correctness | UNIUI, Android and accepted PUCA profiles use only approved flows and never direct framework access |
| 8. Accessibility/recovery | Login/passkey/recovery/logout/session-management keyboard/mobile/accessibility evidence |
| 9. Performance/resource | Defined p95 and host resource budgets met under representative load |
| 10. Production/rollback | Exact commits/images/config hashes, public issuer/API health, key rotation, rollback rehearsal and uninterrupted canary |

A gate is red if evidence is missing, even if the happy-path login works.

---

## 17. Git, commit and delivery discipline

Implementation is performed on a dedicated remote branch such as `feat/qa10-auth-registry`, unless an explicitly approved release workflow says otherwise.

### 17.1 Mandatory work-package loop

For every independently reviewable work package:

1. inspect current branch/worktree and pull/rebase safely;
2. implement only the package scope;
3. run targeted tests;
4. run the full required repository gate before phase completion;
5. update contract/runbook/evidence documentation;
6. inspect `git diff` and secret-scan changed files;
7. commit with a conventional, descriptive message;
8. push immediately to the GitHub remote branch;
9. verify the remote contains the exact commit with `git ls-remote` or equivalent;
10. record the commit and test commands in phase evidence.

A local commit is not completion. An unpushed working tree is not durable progress. Do not accumulate the entire authentication implementation in one commit.

### 17.2 Suggested commit series

```text
docs(auth): accept per-instance OIDC and application registry architecture
chore(identity): add pinned local identity authority deployment
feat(identity): add issuer discovery and strict token verification
feat(auth): add external principal binding and unified principal context
feat(auth): migrate UNIUI login to OIDC BFF sessions
feat(applications): add governed application registry
feat(applications): add Keycloak provisioning reconciliation
feat(auth): add passkey step-up and session governance
feat(auth): add native PKCE and DPoP client profile
feat(auth): add confidential and service PUCA profiles
ops(identity): add backup restore rotation and monitoring
security(auth): complete conformance and adversarial gates
ops(auth): add production canary and rollback evidence
docs(auth): complete QA10 cutover and retire local password login
```

### 17.3 Merge/promotion rule

- feature branch may contain incremental green work packages;
- `main` receives only phase-complete, reviewed, reproducible commits;
- production deploys an exact `main` commit and pinned image digests;
- no force-push after evidence references a commit;
- no production secret or unsanitized conformance artifact enters Git.

---

## 18. Phase plan with deliverables and stop conditions

### Phase A0 — Baseline and capacity

Latest execution evidence: [`../evidence/AUTH-REGISTRY-CAPACITY-GATE-2026-08-03.md`](../evidence/AUTH-REGISTRY-CAPACITY-GATE-2026-08-03.md). Its `STOP` verdict is binding until root storage and host-wide backup growth are remediated and a rerun passes.

Deliverables:

- accepted ADR and this plan;
- updated threat model and ownership matrix;
- measured CPU/memory/disk baseline;
- freed and reserved disk capacity for images, database, backups and rollback;
- selected issuer/resource URLs;
- protocol profile and threat register;
- exact Keycloak candidate version/digest.

Stop if host capacity cannot safely support current services, one rollback image and encrypted backups.

### Phase A1 — Reproducible Identity Authority development deployment

Deliverables:

- pinned Compose service;
- separate PostgreSQL database/user;
- production-like hostname configuration;
- private admin/metrics routes;
- health/readiness;
- non-secret realm configuration as code;
- idempotent bootstrap/reconcile command;
- container and dependency scan;
- local runbook.

Gate: clean rebuild from empty volumes produces the same redacted configuration hash.

### Phase A2 — Identity contracts and discovery

Deliverables:

- contracts for trusted issuer, external identity and principal context;
- RFC 9728 protected-resource metadata;
- OIDC discovery/JWKS cache;
- strict access-token verifier;
- stable error contract;
- negative token corpus.

Gate: wrong issuer/audience/algorithm/key/type/time tokens all fail closed.

### Phase A3 — Principal binding and authorization convergence

Deliverables:

- identity/principal migrations;
- explicit safe link workflow;
- unified principal context for cookie and OAuth authentication;
- user + application + resource authorization intersection;
- audit actor chain;
- permission-change immediate effect.

Gate: existing RBAC tests pass unchanged in meaning and new token clients cannot gain permissions from claims alone.

### Phase A4 — UNIUI OIDC BFF

Deliverables:

- start/callback/logout/step-up routes;
- server-held transaction and token state;
- opaque session rotation;
- existing CSRF preservation;
- safe return paths;
- UNIUI login/recovery/logout/session UI;
- local-password migration feature flag;
- Playwright E2E.

Gate: browser storage and bundles contain no OAuth tokens; OIDC outage has truthful fail-closed behavior.

### Phase A5 — Application Registry

Deliverables:

- schema, service, routes and permission matrix;
- lifecycle state machine;
- redirect/origin/key/APK metadata validation;
- desired/observed revisions and drift state;
- UNIUI administrative screens;
- operation/idempotency/audit integration.

Gate: no application becomes active without review, provision and readback parity.

### Phase A6 — Keycloak provisioning adapter

Deliverables:

- least-privilege admin service credential;
- create/update/disable/read/rotate operations;
- exact metadata normalization and hashing;
- periodic bounded reconciliation;
- drift alerting;
- secret-safe one-time credential handling;
- provider outage behavior.

Gate: induced out-of-band redirect/grant change is detected and blocks activation/high-risk use.

### Phase A7 — Passkeys, MFA, recovery and step-up

Deliverables:

- administrator passkey enforcement;
- recovery codes/fallback policy;
- authenticator/session management;
- `acr`/`amr` mapping;
- critical-operation step-up;
- break-glass runbook and rehearsal.

Gate: critical operations reject stale/password-only context according to policy, including via direct API calls.

### Phase A8 — Android/native profile

Deliverables:

- native client registration type;
- Android App Link and signing-certificate policy;
- PKCE/system-browser reference integration;
- DPoP verifier and replay store;
- refresh rotation/reuse response;
- device/session revoke API;
- sanitized reference APK/E2E evidence.

Gate: copied token fails from a different device key and APK contains no client secret.

### Phase A9 — PUCA profiles

Deliverables:

- browser-BFF profile;
- delegated confidential server profile;
- autonomous service profile;
- `private_key_jwt`/mTLS policy;
- optional device-flow profile only if required;
- SDK examples and integration checklist;
- scope/consent/first-party policy.

Gate: each profile passes user/app/resource intersection and revocation E2E.

### Phase A10 — Operations, backup and rotation

Deliverables:

- encrypted Identity Authority backup;
- UNIFY identity/registry backup coverage;
- isolated restore rehearsal;
- realm/client/user/authenticator/role parity checks that do not expose secrets;
- signing-key rotation rehearsal;
- client-key rotation rehearsal;
- metrics, dashboards and alerts;
- retention/resource limits;
- upgrade and rollback runbooks.

Gate: fresh-host restore can authenticate a test user/client and preserve correct grants without using production tokens in evidence.

### Phase A11 — Conformance, security and performance

Deliverables:

- OpenID conformance results;
- full adversarial suite;
- SAST/dependency/container/secret scans;
- performance/resource report;
- outage/recovery report;
- external review or penetration-test findings resolved;
- zero high/critical vulnerabilities.

Gate: all ten QA gates green in staging.

### Phase A12 — Production canary

Deliverables:

- exact release/commit/image/config manifest;
- one canary principal and one canary client per accepted profile;
- synthetic login/token/verification/revocation probes that avoid real framework mutations;
- resource and error-rate thresholds;
- rollback rehearsal;
- uninterrupted 14-day capability-family window.

Gate: no auth bypass, cross-instance acceptance, token replay, registry drift, secret leak or unexplained outage during the window.

### Phase A13 — Cutover and legacy-login retirement

Deliverables:

- explicit approval;
- OIDC default for every supported client;
- local-password route disabled;
- zero legacy-login calls;
- password hash/pepper removal after rollback retention;
- current-state docs and runbooks updated;
- final QA10 evidence and exact GitHub commit.

Gate: stopping/removing the local-password path causes no loss of login, recovery, revocation or administrative access.

---

## 19. Final step-by-step implementation plan

Execute in this exact order. Do not advance while the current step's gate is red.

1. **Create and push the implementation branch.** Start `feat/qa10-auth-registry`, verify a clean base and push the branch before code changes.
2. **Commit the architecture baseline.** Merge this ADR/plan, update ownership and threat documentation, run documentation checks and verify the GitHub commit.
3. **Run the host-capacity gate.** Measure disk, memory and CPU; free/reserve sufficient space for the pinned image, database growth, encrypted backups and rollback image.
4. **Freeze public identifiers.** Approve the per-instance issuer URL, UNIFY API resource/audience and exact allowed origins; changing issuer later is a migration.
5. **Pin Keycloak.** Select an exact tested version and image digest, record license/SBOM/scan evidence and prohibit `latest`.
6. **Add the development Identity Authority deployment.** Add one Keycloak service and a separate PostgreSQL database/user; keep admin/metrics private; commit and push.
7. **Add configuration-as-code reconciliation.** Configure approved flows, disable implicit/password grants, configure token lifetimes, passkeys and the Gateway BFF client; verify deterministic readback; commit and push.
8. **Publish identity/resource discovery contracts.** Add trusted issuer configuration and RFC 9728 resource metadata to contracts/OpenAPI/SDK; commit and push.
9. **Implement the vendor-neutral OIDC verifier.** Add discovery, issuer-bound JWKS cache and strict RFC 9068 validation with negative token tests; commit and push.
10. **Implement DPoP as an isolated security module.** Verify proof signature, key binding, method/URI/time/nonce and replay; leave enforcement profile-driven; commit and push.
11. **Migrate the principal model.** Add `issuer + subject` bindings while preserving local principal IDs, roles and audit history; prohibit automatic email linking; commit and push.
12. **Unify authentication into `PrincipalContext`.** Make cookie sessions and OAuth tokens feed the same authorization path; load current UNIFY grants server-side; commit and push.
13. **Implement safe account linking.** Add one-use, expiring, audited administrator migration flow and negative link tests; commit and push.
14. **Implement UNIUI BFF login.** Add start/callback/logout, state, nonce, PKCE, transaction expiry, session rotation and token secrecy; commit and push.
15. **Update UNIUI authentication screens.** Add OIDC login, truthful outage/recovery, session/device view and accessible logout; verify no browser token storage; commit and push.
16. **Run the domestic-UI migration gate.** Test login, CSRF, permission changes, logout, session revoke, Identity Authority outage and rollback with a real pinned Identity Authority.
17. **Add Application Registry migrations and domain service.** Implement application types, lifecycle, grants, redirects/origins/keys/APK identity and desired/observed revisions; commit and push.
18. **Add registry permissions and APIs.** Enforce review, step-up, idempotency, confirmation, audit and no-secret-readback; regenerate SDK; commit and push.
19. **Add UNIUI registry administration.** Build draft/review/approve/provision/reconcile/suspend/revoke and drift-diff surfaces; commit and push.
20. **Implement the Keycloak provisioning adapter.** Use a least-privilege private admin credential; create/update/disable/read/rotate and normalize readback; commit and push.
21. **Enable reconciliation and drift blocking.** Detect out-of-band client changes, alert and fail closed for activation/high-risk use; commit and push.
22. **Enable passkeys and administrator MFA.** Configure WebAuthn, recovery and authenticator/session management; verify direct API enforcement; commit and push.
23. **Implement step-up.** Map `acr`/`amr`, require recent strong authentication for registry, credential, role and destructive operations; commit and push.
24. **Implement Android/native registration.** Enforce public-client, PKCE, exact App Link, package/signing fingerprints, no secret and DPoP requirement; commit and push.
25. **Build and test the Android reference integration.** Use system browser and Keystore key, rotate refresh tokens and prove copied-token rejection; commit sanitized fixtures/evidence and push.
26. **Implement browser-BFF and delegated server PUCA profiles.** Add PAR and asymmetric client authentication policy where required; commit and push.
27. **Implement autonomous service PUCA profile.** Add dedicated service principals, Client Credentials and narrow framework/resource grants; commit and push.
28. **Add backup and isolated restore.** Cover the Identity Authority database/configuration and UNIFY identity/registry records; verify restored test login/client/grants; commit scripts/runbook/evidence and push.
29. **Rehearse key rotation.** Rotate Identity Authority signing key and PUCA keys with overlap, JWKS refresh and emergency-compromise behavior; commit evidence and push.
30. **Add production metrics and alerts.** Cover issuer/JWKS health, validation failures, DPoP replay, drift, backup age, resource pressure and step-up anomalies; commit and push.
31. **Run full protocol conformance.** Execute applicable OpenID Foundation profiles and retain sanitized identifiers/results; fix every material failure; commit and push.
32. **Run adversarial security gates.** Execute mix-up, replay, PKCE, redirect, algorithm, JWKS SSRF, cross-instance, token substitution, refresh reuse, CSRF and privilege-escalation suites; commit and push.
33. **Run resource/performance gates.** Verify the agreed memory, CPU and latency budgets under representative login/token/API load; tune or evaluate ZITADEL if the envelope fails.
34. **Run complete repository QA and scans.** Require tests, types, builds, OpenAPI reproducibility, formatting, dependency/container/secret scans and zero high/critical findings; commit fixes and push.
35. **Deploy staging from an exact GitHub commit.** Record commit, image digests, schema versions and configuration hashes; run E2E for every accepted client profile.
36. **Rehearse staging rollback.** Roll back Gateway and Identity Authority without account, grant, registry or key corruption; commit sanitized evidence and push.
37. **Deploy a production canary.** Keep local password login rollback-controlled; activate OIDC for designated users/clients; run non-destructive synthetic probes.
38. **Complete the uninterrupted 14-day window.** Reset the window on any security/reliability threshold breach; investigate rather than waiving failures.
39. **Approve cutover explicitly.** Review all ten QA gates, backup/restore, key rotation, rollback, capacity and canary evidence.
40. **Disable local password authentication.** Remove it from UI and edge, disable Gateway route, verify zero calls and retain only the approved rollback mechanism.
41. **Remove retired password material.** After the rollback retention period, migrate away password hashes and remove the authentication pepper/bootstrap password secret.
42. **Publish final QA10 evidence.** Update current-state documentation, commit the exact completion report, push to GitHub and verify the remote commit.

---

## 20. Completion definition

Authentication and the Application Registry are QA10 only when:

- all accepted clients use approved OIDC/OAuth profiles;
- every request identifies and authorizes both principal and application;
- cross-instance/wrong-audience tokens fail;
- native clients contain no secret and DPoP replay is rejected where required;
- browser tokens never enter frontend JavaScript;
- administrators use phishing-resistant authentication and step-up;
- registry state reconciles exactly with the Identity Authority;
- no high/critical security findings remain;
- backup, restore, signing-key rotation, client-key rotation, outage and rollback are proven;
- resource budgets are met;
- the uninterrupted production window passes;
- local password login can be removed without losing access or recovery;
- implementation, tests, evidence and final status are committed and verified on GitHub.
