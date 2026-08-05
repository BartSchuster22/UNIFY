# Mantine UNIUI

UNIUI is the authenticated operator console for native Core and registered Hermes frameworks.

## Runtime boundary

- The browser uses only same-origin UNIFY APIs.
- UNIUI never receives framework credentials or constructs upstream service URLs.
- Authentication uses the Gateway named-user `HttpOnly` session and CSRF protection.
- Navigation is permission-aware.
- CSP, frame denial, MIME protection, referrer policy, and permissions policy are emitted by the server.
- There is no integration explorer, migration Memory view, cross-owner search, or legacy download helper.

## Current views

| View | Source | Ownership |
|---|---|---|
| Frameworks | Gateway framework registry | Gateway registration with exact Hermes identity |
| Providers/models | registered Hermes control endpoint | exact Hermes framework |
| Profiles | native/Core and Hermes capability APIs | native Core or exact Hermes framework |
| Work/Kanban | native Core work APIs | Core PostgreSQL |
| Chat | native Core conversation APIs | Core PostgreSQL |
| Audit | Gateway `/audit` | Gateway PostgreSQL |
| Operations | Gateway `/operations` | Gateway PostgreSQL |
| Notifications | Gateway `/notifications` | recipient-scoped Gateway projection |
| Settings | Gateway session/auth APIs | Gateway identity plane |

## Truthful states

Unsupported, unavailable, stale, partial, empty, forbidden, failed, inconclusive, and current remain distinct. A framework outage never becomes an invented empty result or a fallback to another owner.

## Accessibility and responsive behavior

The Mantine `AppShell` provides desktop and mobile navigation, signed-in identity, persisted color scheme, keyboard-visible focus, semantic landmarks, and a skip link. Tables scroll horizontally and cards collapse at narrow widths. Conversation history is bounded and virtualized.

## Development

```bash
pnpm --filter @aquiero/uniui typecheck
pnpm --filter @aquiero/uniui test
pnpm --filter @aquiero/uniui build
```
