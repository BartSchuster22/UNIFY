# Phase 4 — Core Authentication System

Phase 4 establishes PostgreSQL-backed authentication and authorization for the standalone Core. It does not depend on Worker, DMM, Agency, CHAT, or another runtime.

## Security boundary

- **Human authentication:** named identities, Argon2id password proofs, server-side opaque sessions, and optional TOTP MFA.
- **Service authentication:** one-time opaque bearer credentials attached to durable service principals.
- **Authorization:** deny by default; permission checks intersect role bindings, resource scope, binding expiry, and credential scopes.
- **Browser mutations:** session cookie plus a session-bound double-submit CSRF proof.
- **Audit:** security decisions append to the immutable Core audit chain with request/correlation identifiers and no raw secrets.

The Fastify plugin exposes the frozen `/core/v1/identity/*` interfaces. Domain handlers can use `AuthenticationService` from `@unify/core/auth`; they must authenticate each request and call `authorize` for the exact permission and scope before performing work.

## Passwords and administrator bootstrap

Passwords are accepted only when they meet the Core policy (minimum 16 characters, sufficient character diversity and variation, and no normalized username). They are stored as Argon2id hashes with a deployment pepper. Production defaults are:

| Parameter | Value |
|---|---:|
| Memory | 65,536 KiB |
| Iterations | 3 |
| Parallelism | 1 |
| Hash length | 32 bytes |
| Retained password history | 5 |

Bootstrap is a one-shot operation protected by `CORE_AUTH_BOOTSTRAP_TOKEN`. It creates exactly one active administrator and the global `core.admin` binding. A transaction-level singleton prevents concurrent or repeated bootstrap.

```bash
DATABASE_URL='postgresql://…' \
CORE_AUTH_PASSWORD_PEPPER='at-least-32-byte-secret…' \
CORE_AUTH_TOKEN_PEPPER='different-at-least-32-byte-secret…' \
CORE_AUTH_MFA_KEY_BASE64="$(openssl rand -base64 32)" \
CORE_AUTH_BOOTSTRAP_TOKEN='one-time-at-least-32-byte-token…' \
CORE_AUTH_BOOTSTRAP_USERNAME=administrator \
CORE_AUTH_BOOTSTRAP_DISPLAY_NAME=Administrator \
CORE_AUTH_BOOTSTRAP_PASSWORD='<injected-secret>' \
pnpm --filter @unify/core auth:bootstrap
```

The command accepts bootstrap proofs through deployment-injected environment variables and prints only the created identity ID and username. It never prints the password, password hash, peppers, MFA keys, session secrets, or CSRF secrets. Do not enter secret values into persistent shell history; inject them from the deployment secret manager.

## Sessions and CSRF

A successful browser login sets:

- `unify_core_session`: opaque, `HttpOnly`, `SameSite=Strict`, `Secure` by default;
- `unify_core_csrf`: opaque, readable by the browser, `SameSite=Strict`, `Secure` by default.

Only HMAC-SHA-256 digests are persisted. Mutation requests must supply the CSRF value in both the cookie and `x-csrf-token`; it must also match the digest bound to the authenticated session. Logout, password changes, locking, MFA changes, explicit revocation, and the per-identity session cap revoke sessions with durable reasons.

## Throttling and locking

Login throttling uses independent identity, network, and identity/network-pair buckets. PostgreSQL updates each bucket atomically. Generic login responses do not reveal whether an identity exists. Reaching the account threshold locks the identity and revokes every active session. An administrator may explicitly unlock it; independent network/pair throttle windows remain authoritative.

Default thresholds:

| Control | Default |
|---|---:|
| Pair failures | 5 per 15 minutes |
| Identity failures | 10 per 15 minutes |
| Network failures | 50 per 15 minutes |
| Throttle block | 15 minutes |
| Account lock | 10 failures / 15 minutes |
| Sessions per identity | 10 |
| Session lifetime | 8 hours |

## MFA

TOTP uses 160-bit secrets, SHA-1 as required by the interoperable `otpauth` profile, six digits, 30-second periods, and a ±1-period clock window. Secrets are encrypted using AES-256-GCM and a versioned key. Accepted TOTP counters are persisted and atomically advanced to prevent replay. Ten one-use recovery codes are disclosed once at enrollment and stored only as keyed digests.

For initial deployment, use `CORE_AUTH_MFA_KEY_BASE64` with key version `1`. For rotation, register the new version in a forward migration, set `CORE_AUTH_MFA_KEY_VERSION`, and provide all keys still needed by active/pending enrollments:

```bash
CORE_AUTH_MFA_KEY_VERSION=2
CORE_AUTH_MFA_KEYS_JSON='{"1":"<base64-32-bytes>","2":"<base64-32-bytes>"}'
```

Startup fails closed when the active registry version is missing, retired, malformed, or when an active enrollment requires an unavailable key.

## Scoped RBAC and service credentials

Role bindings have a scope kind/id and optional expiry. Global bindings apply everywhere; resource bindings apply only to an exact scope. Service credentials add a second restriction: a permission must be granted by RBAC **and** allowed by the credential's exact or `<namespace>.*` scope. Credential tokens are returned only at issuance. Revocation is immediate, and stale in-process principals are rejected by a live database check.

Cookie sessions authenticate browser identity endpoints. Read-only authenticated endpoints may also use `Authorization: Bearer <service-credential>`. Cookie-authenticated mutations require CSRF and are intentionally unavailable to service bearer credentials unless a future frozen contract explicitly permits them.

## Required environment

| Variable | Requirement |
|---|---|
| `DATABASE_URL` | PostgreSQL 16 Core database |
| `CORE_AUTH_PASSWORD_PEPPER` | At least 32 bytes; distinct from token pepper |
| `CORE_AUTH_TOKEN_PEPPER` | At least 32 bytes |
| `CORE_AUTH_MFA_KEY_BASE64` | One 32-byte key, base64 encoded; initial/single-key deployment |
| `CORE_AUTH_MFA_KEYS_JSON` | Optional version-to-base64 map used during rotation |
| `CORE_AUTH_MFA_KEY_VERSION` | Active registered key version; defaults to `1` |
| `CORE_AUTH_BOOTSTRAP_TOKEN` | Required only until administrator bootstrap |
| `CORE_AUTH_MFA_ISSUER` | Optional TOTP issuer; defaults to `UNIFY Core` |

Thresholds and session policy can be adjusted with the validated `CORE_AUTH_*` variables defined in `src/auth/config.ts`. Production secrets belong in the deployment secret manager, not source, command history, logs, browser storage, or generated artifacts.

## Verification

```bash
pnpm --filter @unify/core auth:test
pnpm --filter @unify/core test
pnpm typecheck
```

Set `CORE_TEST_DATABASE_URL` and `CORE_AUTH_TEST_DATABASE_URL` to clean PostgreSQL databases to execute both live suites. Tests cover migration invariants, Argon2id parameters, crypto tamper handling, bootstrap races/denials, generic login failures, throttling, account locking, password history, session and CSRF behavior, TOTP replay prevention, recovery-code consumption, scoped authorization, service credential restrictions/revocation, strict HTTP bodies, request correlation, secret-free audit details, and audit-chain integrity.
