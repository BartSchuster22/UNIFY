# Focused Chat and Alerts PWAs

## Scope

Phase 6 adds two installable, responsive web applications without creating new state owners:

- `apps/chat-pwa` is the focused Chat client.
- `apps/alerts-pwa` is the focused notification inbox.
- UNIUI remains the broad operator console.
- Gateway remains the only browser API boundary.

Both PWAs use the same named-user session, CSRF, RBAC, resource, mutation, and notification contracts as UNIUI. Neither browser bundle contains an Agency, DMM, Worker, Chat, or Memory credential.

## Shared components

| Package | Responsibility | Consumers |
|---|---|---|
| `@aquiero/auth-client` | Same-origin Gateway client, session login/logout, CSRF, governed requests, PWA registration | Chat, Alerts |
| `@aquiero/design-system` | Authenticated focused shell, login, permission denial, truthful async states | Chat, Alerts |
| `@aquiero/chat-components` | Session list, virtualized messages, optional composer | UNIUI, Chat |
| `@aquiero/notification-components` | Grouping, severity/state filters, deep links, acknowledgement | UNIUI, Alerts |

The focused applications may compose these packages but must not fork their business behavior.

## Chat behavior

- Requires `chat.read`; sending additionally requires `chat.send`.
- Reads bounded `chat-session` and `chat-message` collections through Gateway.
- Virtualizes message history.
- Persists an unsent draft locally per selected session.
- Sends through governed `chat.message.send`, with an idempotency key and authoritative refresh.
- A read-only account sees history but never receives a send control.

## Alerts behavior

- Requires at least one owner-read capability.
- Loads only notifications whose source owner is readable by the principal.
- Groups by owner and filters by active/acknowledged state and severity.
- Acknowledgement is recipient-scoped, CSRF-protected, permission-checked, persisted in Gateway PostgreSQL, and audited.
- Deep links open a permission-filtered UNIUI view. An unauthorized view falls back to Overview.

## PWA and offline boundary

Each app includes a manifest, standalone display metadata, an icon, and a service worker. The service worker caches only the unauthenticated application shell. It explicitly excludes `/api/` requests, responses, credentials, Chat history, notifications, and mutation results. HTML, manifests, and service workers are served with `no-store` so deployments cannot strand a stale shell.

PWA installation is enhancement-only: authentication, responsive layouts, keyboard use, and all core actions work in an ordinary browser tab.

## Runtime

```bash
# Defaults: Gateway 28081, UNIUI 3000, Chat 3001, Alerts 3002
docker compose up -d --build --wait

curl -fsS http://127.0.0.1:${CHAT_PWA_PORT:-3001}/healthz
curl -fsS http://127.0.0.1:${ALERTS_PWA_PORT:-3002}/healthz
```

Each focused shell privately proxies `/api/*` to Gateway. Its own browser origin is allowlisted by Gateway; secure session cookies and CSRF validation remain enforced.

## Verification

```bash
pnpm --filter @aquiero/chat-pwa typecheck
pnpm --filter @aquiero/chat-pwa test
pnpm --filter @aquiero/chat-pwa build
pnpm --filter @aquiero/alerts-pwa typecheck
pnpm --filter @aquiero/alerts-pwa test
pnpm --filter @aquiero/alerts-pwa build
```

The component tests cover authenticated rendering, permission-conditioned controls, notification acknowledgement, deep links, and axe accessibility. Compose verification must also inspect security/cache headers and prove `/api/v1/auth/me` is unauthenticated before login through each focused proxy.
