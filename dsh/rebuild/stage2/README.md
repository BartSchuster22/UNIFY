# Stage 2 engineering implementation — NOT CLOSED

Development and all test/build artifacts belong on ALICA-v1. Stage 1 deployment, data, published revisions, and existing workloads are not upgrade targets.

## Implemented and exercised components

- Core Keycloak authorization-code/PKCE authentication with explicit issuer, audience, nonce, RSA signature, expiry and client-role validation. Password login is disabled in OIDC mode; browser sessions require a valid provider userinfo response. Provider tokens and flow material are sealed with session/flow-bound AES-GCM.
- Durable issuer/subject identity binding without email/username account linking, transactional client-role projection and single-use state consumption.
- Explicitly read-only, short-lived project service credentials with a distinct token class and API audience. These are not browser sessions, provider keys or adapter credentials. Their native project read is bounded to the first 500 projects; full project pagination is not qualified.
- UI authentication discovery and identity-provider entry, failing closed rather than falling back on discovery failure.
- A durable, exclusive-writer filesystem transaction primitive with request/release ownership, rollback state, retained data and retry tests. This primitive is NOT yet a complete installation driver.

## Evidence so far

- Gateway: 161 unit/component tests passed; gateway build/typecheck passed.
- UI: production build and typecheck passed.
- Real disposable PostgreSQL: all up migrations applied; 15 assertions passed, including concurrent identity creation, issuer isolation, single-use state, disabled users, role replacement, project credential revocation and adapter table privilege denial. Disposable DB removed after the test.
- Transaction primitive: 10 filesystem tests passed.
- Authorized model: OpenAI Codex OAuth / gpt-6-astra. A real provider preflight succeeded outside the candidate; this is NOT native candidate model acceptance. No native production credentials were modified by this implementation.

## Remaining acceptance gates

Complete the pinned public-bundle installer/driver, first-owner recovery, live Keycloak browser flow over TLS, real native provider setup/inference and restart retention, negative end-to-end authorization tests, independent clean installation, publication, evidence and closure. GitHub CLI on the coordinator currently lacks authentication; source transport and public artifact publication must be verified separately.

No production-readiness claim. Stage 1 graceful Hermes shutdown remains unqualified.
