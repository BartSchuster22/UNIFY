# ADR 0005 — Per-Instance OIDC Identity Authority and UNIFY Application Registry

- **Status:** Accepted
- **Date:** 2026-08-03
- **Decision owner:** UNIFY
- **Applies to:** UNIUI, focused web applications, native APKs, CLIs, service clients and particular use-case applications (PUCAs)
- **Implementation plan:** [`../plans/QA10-AUTHENTICATION-AND-APPLICATION-REGISTRY-PLAN.md`](../plans/QA10-AUTHENTICATION-AND-APPLICATION-REGISTRY-PLAN.md)

## Context

UNIFY Core is the public mediation and policy layer of one agent-framework instance. The domestic UNIUI is one client, but additional browser applications, Android APKs, service applications and PUCAs must be able to connect to the same UNIFY Core without receiving framework credentials or using a proprietary password protocol.

The current Gateway has a secure same-origin baseline: named users, scrypt password hashes, opaque server-side sessions, CSRF binding, revocation, throttling and deny-by-default RBAC. It does not provide OAuth/OIDC client identity, native-app PKCE, audience-bound access tokens, passkeys, application registration, delegated authorization, service principals or cross-application SSO.

Implementing a complete Authorization Server inside UNIFY would add a high-risk cryptographic and protocol product to the Gateway, duplicate mature open-source work, increase the attack surface and make external clients dependent on a proprietary protocol. Directly coupling UNIFY request authentication to one vendor's API would create avoidable lock-in and runtime fragility.

## Decision

Each UNIFY instance SHALL use a dedicated standards-compliant Identity Authority deployed beside UNIFY Core. The initial supported implementation SHALL be a pinned Keycloak release. UNIFY runtime authentication SHALL use vendor-neutral OpenID Connect and OAuth standards; Keycloak-specific integration is permitted only behind an administrative provisioning adapter.

The target division of ownership is:

| Concern | Authoritative owner |
|---|---|
| Users, authenticators, passkeys, MFA, OIDC login sessions | Identity Authority |
| OAuth clients, authorization codes, refresh tokens, signing keys and JWKS | Identity Authority |
| Stable local principal binding (`issuer + subject`) | UNIFY Core |
| Application approval, UNIFY scopes, framework/resource grants and lifecycle evidence | UNIFY Core Application Registry |
| Browser BFF sessions and CSRF state | UNIFY Core |
| Framework/resource authorization and operation policy | UNIFY Core |
| Agent-domain state and capabilities | Exact Layer 1 framework |

UNIFY Core SHALL act as:

1. an OAuth Resource Server for native, service and external clients;
2. an OIDC confidential client and Backend-for-Frontend for domestic UNIUI and focused first-party web applications;
3. the owner of fine-grained UNIFY authorization, framework/resource scopes, operation policy and audit;
4. the owner of the governed Application Registry projection and approval lifecycle;
5. the only public API boundary to framework adapters.

## Binding protocol profile

The production profile SHALL follow finalized specifications and align with OAuth 2.1 direction without claiming that the current OAuth 2.1 draft is a finalized RFC:

- OpenID Connect Core 1.0;
- OAuth 2.0 Security Best Current Practice, RFC 9700;
- Authorization Code with PKCE `S256`, RFC 7636;
- OAuth for Native Apps, RFC 8252;
- Authorization Server Metadata, RFC 8414;
- Protected Resource Metadata, RFC 9728;
- JWT Access Token Profile, RFC 9068, when JWT access tokens are used;
- DPoP, RFC 9449, for supported public/native clients;
- PAR, RFC 9126, for high-assurance clients;
- revocation, introspection and device authorization only where their defined client profiles require them.

The Implicit Grant and Resource Owner Password Credentials Grant are forbidden. Native applications are public clients and SHALL NOT contain client secrets. Redirect URIs are exact; wildcard redirect URIs are forbidden.

## Client profiles

- **Domestic UNIUI/focused web UI:** OIDC Authorization Code + PKCE through a Gateway BFF; browser receives only an opaque secure session cookie.
- **Native Android APK:** system browser, claimed HTTPS App Link, Authorization Code + PKCE, no embedded secret, Android Keystore key, DPoP where supported, rotating refresh token.
- **Browser PUCA:** BFF preferred; public-browser flow is an explicitly reviewed exception.
- **Server PUCA:** Authorization Code for delegated users; Client Credentials with `private_key_jwt` or mTLS for autonomous service identity.
- **CLI/constrained client:** Device Authorization Grant only where the normal native browser callback is impractical.

## Lightweight deployment constraints

The accepted architecture deliberately avoids a service mesh, Redis requirement, an auth sidecar per client and a custom token service. The initial topology is one Identity Authority process using PostgreSQL, one Gateway and existing UI deployables behind the existing edge.

UNIFY validates short-lived JWT access tokens locally using issuer-bound cached JWKS. Introspection is not performed on every request. Fine-grained permissions remain database-backed in UNIFY and are resolved after token/session authentication. This keeps ordinary API authorization local while preserving short token lifetimes and fail-closed behavior.

The Identity Authority SHALL use a separate database/schema, separate database credentials and a separate backup/restore unit even when it shares the existing PostgreSQL server. Its public user endpoints may be edge-routed; its administrative interface and metrics SHALL remain private.

## Application Registry

The UNIFY Application Registry is separate from the Framework Registry. It owns approval and UNIFY authorization metadata, not readable OAuth secrets. OAuth protocol registration remains authoritative in the Identity Authority and is reconciled through a `ClientRegistryProvisioner`.

Public anonymous Dynamic Client Registration is disabled. Registration uses a reviewed workflow:

```text
draft -> security_review -> approved -> active -> suspended -> revoked -> retired
```

A client cannot become active until UNIFY has provisioned it, read it back from the Identity Authority and verified exact parity for redirect URIs, grants, authentication method and required security controls.

## Adapter boundaries

Three interfaces SHALL prevent vendor lock-in:

- `OidcIssuerAdapter`: discovery, JWKS refresh, token verification, optional introspection/revocation and DPoP verification;
- `ClientRegistryProvisioner`: create, update, rotate, disable and read back OAuth clients;
- `ClaimsMapper`: map trusted external identity claims to the UNIFY principal model without granting domain permissions from untrusted claim names.

Normal API authentication SHALL NOT call a Keycloak administrative API.

## Migration rule

The current local password/session path remains available only as a rollback-controlled migration path until UNIUI OIDC/BFF login, identity linking, recovery, backup/restore and production canary gates pass. There is no big-bang user migration and no automatic fallback from failed OIDC to password authentication.

After cutover, local password hashes and login routes SHALL be removed or compiled behind a disabled, audited rollback feature. Existing opaque BFF sessions and CSRF controls may remain because they are appropriate browser protections; their identity source changes from local password verification to OIDC.

## Consequences

### Positive

- Every UI/APK/PUCA uses interoperable standards.
- Framework credentials remain server-side.
- The Gateway keeps one authorization and audit path.
- Passkeys, MFA, SSO, device/session revocation and client lifecycle become available without creating a new security product.
- Per-instance issuer and audience validation prevent cross-instance confused-deputy acceptance.
- The runtime path remains portable across compatible Identity Authorities.

### Costs

- Identity Authority availability, upgrades, signing keys, database and backup become production responsibilities.
- User identity migration requires stable subject linking and rollback evidence.
- Native and service clients need maintained client profiles and conformance tests.
- Keycloak adds a bounded runtime footprint that must pass host-capacity and load gates.

## Rejected alternatives

- **Build OAuth/OIDC inside UNIFY:** rejected because protocol and cryptographic complexity are disproportionate and high risk.
- **Expose the current password login to APKs/PUCAs:** rejected because it lacks client identity, delegation, audience binding, native-app safety and standardized lifecycle.
- **Static API keys for every PUCA:** rejected because keys provide weak user delegation, coarse revocation and poor device/application attribution.
- **One vendor-specific auth adapter per application:** rejected because clients should speak standard OIDC/OAuth directly.
- **ORY Hydra stack:** rejected as the default because a complete deployment requires additional identity/login components.
- **Dex as primary authority:** rejected because it is primarily an OIDC federation broker, not the complete local identity/client-governance system required here.
- **ZITADEL as the initial default:** retained as the preferred lightweight alternative, but Keycloak is selected for the initial QA10 baseline because its current documentation and ecosystem explicitly cover the broader FAPI, DPoP, PAR, WebAuthn and client-policy profile.

## Acceptance condition

This ADR is implemented only when the plan's QA10 gates are green, exact release evidence is committed, live production canaries pass for all client profiles, backup/restore and key rotation are rehearsed, and the local password path can be disabled without loss of access or recovery capability.
