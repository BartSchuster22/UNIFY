# Development session stability and execution feedback repair

## Cause and repair

OIDC login previously bounded the DSH cookie/session by the initial access/ID token
expiry (maximum five minutes) and discarded the refresh token. The authenticated
session now keeps the existing bounded AuthService lifetime (default eight hours).
Access and rotating refresh tokens are sealed server-side with AES-GCM and
session-specific AAD. No OIDC access/refresh token is returned to the browser.

Before access-token expiry, the server refreshes through the pinned confidential
Keycloak client. Refreshed access JWTs must pass signature, issuer, audience,
authorized-party, subject, expiry, and admitted-role checks. Changed roles require
fresh login rather than retaining stale local privileges. Userinfo checking remains
in place. Provider refusal, expired refresh credentials, local expiry/revocation,
and invalid bindings fail closed. No long-lived access tokens or offline access
were enabled. Existing legacy bindings require one fresh sign-in.

PostgreSQL row locks on the active session and binding serialize refresh and
persist rotated sealed tokens. There is no schema migration and no in-memory-only
refresh-token store. Local absolute session lifetime is not extended by refresh;
Keycloak session policy still applies.

## Chat behavior

The composer now shows a waiting indicator and elapsed time while awaiting the
server response. It explicitly says individual tool progress is not streamed;
it does not invent tool phases. After interruption/failure, an uncertain-outcome
warning retains the draft and blocks resending until the user acknowledges checking
history. No automatic resend is introduced. This is request feedback, not a durable
job monitor or streamed-token/tool-event implementation.

## Verified tests

- Gateway: all 253 tests passed across 30 files, including 38 OIDC and four new
  store transaction tests; gateway TypeScript check passed.
- ChatView/ExecutionFeedback: seven tests passed; UI TypeScript check passed.
- Gateway and UI production compilation succeeded.
- Live Chromium: waiting and elapsed indicators visible; aborted intercepted request
  produced an uncertain-outcome warning, preserved draft, and disabled duplicate
  send. The intercepted request never reached Hermes; zero new model tasks.
- Live browser remained authenticated for 370 seconds, beyond the former five-minute
  cutoff: every /auth/me check returned HTTP 200 and browser cookie values remained
  unchanged. No re-login or browser-token replacement occurred. This verifies the
  expiry boundary, not an eight-hour/day-scale endurance run.

## Engineering rollout, not distribution qualification

Only dev3 Core and UniUI were replaced. Runtime config and mounts were compared
against their preceding identities; image layers contain only the two auth JS files
and UI static files respectively. All other running container IDs/start times were
unchanged. All seven candidate services healthy; ownership verified; maintenance
false. Development, shared UniUI, and shared Core HTTP checks returned 200.

The first preparation attempt failed before live mutation on a cell-unit pathname.
An initial application attempt rolled back after a config-schema mismatch. The
rollback restored image/config ownership; maintenance was explicitly cleared.
The corrected apply verified successfully. No database contents, Keycloak realm,
Hermes data, or OpenAI authorization were reset. DSH2 was untouched.

Current bundle: /var/lib/alica-dsh-internal/dev3-session-feedback-2/bundle
Manifest SHA256: c31da897ba2a0fbc5f798ddd85e9c3ac5a62cea19ef0f90fd2c73e84c8294025
Core image: sha256:053d5f48f2d8e24dbaf8556ada584001daa3dff3cbe04a6c07a33ac334f472a6
UI image: sha256:9830542cd82284671a5c161ea05200ec834e31f85e8f5e449822c7e7953075d3
Backup/receipt: /var/lib/alica-dsh-internal/dev3-session-feedback-2/

Cell and TLS unit commands were checked against the new path and manifest pin.
The final distributable candidate still needs these source fixes incorporated and
full fresh-install/lifecycle/day-scale qualification. This overlay is not a general
upgrade mechanism and must not be represented as a fresh-install artifact.
