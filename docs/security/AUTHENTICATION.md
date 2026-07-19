# Identity, Sessions, RBAC, and CSRF

## Web authentication

UNIFY uses named users and server-side sessions. The browser receives:

- `aquiero_session`: opaque, `HttpOnly`, `Secure` in production, `SameSite=Strict`;
- `aquiero_csrf`: opaque CSRF value, `Secure` in production and `SameSite=Strict`;
- `x-csrf-token` on successful login so an in-memory client can use it immediately.

Only SHA-256 token hashes are stored. The raw session token is never returned in JSON or logged. The CSRF header, CSRF cookie, and session-bound CSRF hash must all match for cookie-authenticated mutations.

Passwords use Node's scrypt with a random per-password salt and a deployment pepper supplied through `AUTH_PEPPER_FILE`. Login errors do not reveal username existence. Repeated failures trigger bounded exponential backoff.

## Authorization

Permissions are loaded from database role grants for every authenticated session lookup. The Gateway checks permissions server-side. Resource/framework scopes are represented on grants and will be enforced as adapters are enabled. Deny is the default.

## Revocation

Logout immediately revokes its server-side session. A user may revoke their own sessions. `users.manage` is required to revoke another user's session. Disabled/locked users and expired/revoked sessions cannot authenticate.

## Bootstrap

After migrations and before public exposure, create exactly one named administrator:

```bash
pnpm --filter @aquiero/gateway build
DATABASE_URL_FILE=/run/secrets/gateway_database_url \
AUTH_PEPPER_FILE=/run/secrets/gateway_auth_pepper \
BOOTSTRAP_ADMIN_PASSWORD_FILE=/run/secrets/bootstrap_admin_password \
pnpm --filter @aquiero/gateway bootstrap-admin
```

Bootstrap fails if any user already exists and never prints the password. Routine user creation/rotation will use authenticated administrative APIs; bootstrap is not a general user-management bypass.

## Production requirements

Production startup fails when either the database URL or authentication pepper is missing. Passwords, peppers, database credentials, session tokens, and CSRF values must never be committed or passed into browser bundles.
