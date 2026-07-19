# Native-shell readiness boundary

## Decision

Phase 6 does **not** add, publish, sign, or distribute a native mobile shell. Native packaging is allowed only after the responsive web applications and named-user authentication pass their browser, accessibility, security, and real-runtime gates.

The Chat and Alerts PWAs are the product implementations. A future shell must remain a thin transport wrapper around those web capabilities, not become another API client, credential store, notification owner, Chat responder, or source of business logic.

## Prerequisites

A native-shell proposal may start only when all of the following are evidenced:

- Chat and Alerts production builds pass.
- Phone-width layouts and keyboard navigation pass automated browser checks.
- Named-user login, logout, permission denial, CSRF, and session-cookie behavior pass through the deployed web origins.
- Service workers never cache authenticated API responses.
- Notification acknowledgement is durable and recipient-scoped.
- Chat drafts and sends reconcile correctly after refresh.
- Deep links have stable, permission-filtered web targets.
- CSP, frame denial, permissions policy, and non-root/read-only containers pass.

Phase 6 satisfies these prerequisites in the local acceptance environment; that is readiness evidence, not approval to build a shell.

## Future shell constraints

A reviewed future phase must decide and document:

1. Platform and wrapper choice.
2. Universal/app-link ownership and verified domains.
3. Cookie/session handling without copying Gateway credentials into native storage.
4. OS notification registration through a Gateway-owned device-token contract.
5. Logout, token revocation, device loss, and account-disable behavior.
6. Camera, microphone, filesystem, and background permissions, all denied by default.
7. Store signing, release provenance, privacy declarations, and rollback.
8. Web/native version compatibility and forced-minimum-version policy.

No native dependency, platform project, signing key, push credential, or privileged bridge belongs in the repository until that phase is explicitly approved.
