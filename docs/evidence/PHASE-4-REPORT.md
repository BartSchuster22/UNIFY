# Phase 4 Verification Report

Date: 2026-07-19

## Result

Phase 4 — Mantine UNIUI is complete. The production bundle and same-origin Gateway proxy were exercised through the hardened Compose stack. The implementation does not change authoritative ownership or enable owner writes.

## Delivered scope

- Mantine authenticated responsive `AppShell` with named-user session handling.
- Permission-filtered navigation and same-origin Gateway API client.
- Shared truthful-state banner, panel, badge, warning, retry, provenance and empty-state patterns.
- Agency framework view.
- DMM provider, model, and catalog views.
- Hermes profile and agent views.
- Worker project, Kanban, task, cron, and notification projections.
- Chat session selection and `@tanstack/react-virtual` message window.
- MemoryV4 explorer and scoped search.
- Gateway audit, operation, notification, session, appearance, keyboard, and accessibility views.
- New paginated `/api/v1/audit` and `/api/v1/operations` collection endpoints, RBAC gates, OpenAPI contracts, generated SDK artifacts, and route coverage.
- Vite production build and non-root static/proxy container.

## Truth and ownership

All owner views render the Gateway's source freshness independently. Current, stale, partial, empty, unavailable, unsupported, forbidden, failed, and inconclusive states are not flattened. Owner and adapter provenance, warning details, observation time, canonical identity, pagination boundaries, and authoritative status remain visible. No test or runtime verification mutated Agency, Hermes, DMM, Worker, Chat, or MemoryV4.

## Automated gates

The serial workspace gate passed:

```text
lint and workspace boundaries: passed
format check: passed
contract generation reproducibility: passed
all workspace typechecks: passed
all workspace builds: passed
all repository tests: 47 passed
```

Test distribution:

| Workspace | Tests |
|---|---:|
| UNIUI | 4 |
| Gateway | 32 |
| Contracts | 3 |
| Adapter SDK | 7 |
| TypeScript SDK | 1 |

UNIUI gates assert:

- accessible named-user login labels and initial focus;
- axe-core login and authenticated-shell scans;
- semantic primary navigation and mobile menu control;
- `Ctrl+K` keyboard search focus;
- explicit truthful empty-state announcement;
- virtualized Chat `role="log"` rendering.

## Production bundle

```text
Vite modules transformed: 6,976
index HTML: 0.52 kB
CSS: 224.73 kB (33.55 kB gzip)
JavaScript: 497.26 kB (150.64 kB gzip)
```

## Compose runtime evidence

The local images were rebuilt from the frozen lockfile. PostgreSQL, Gateway, and UNIUI reached healthy status. Gateway and UNIUI both ran as UID `10001` with read-only roots, dropped capabilities, and `no-new-privileges`.

The first same-origin proxy attempt returned `502`, identifying a real network-boundary defect: bridge-networked UNIUI could not reach a Gateway bound to host loopback. The final Compose topology places UNIUI on host networking while preserving loopback-only bindings for both services. The proxy was rebuilt and reverified.

Final HTTP evidence:

```text
UNIUI document: 200
JavaScript bundle: 200 (497,264 bytes)
Content-Security-Policy: present
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
named-user login through UNIUI proxy: 200
current principal: 200
integrations: 200 (5 adapters)
resources: 200
operations: 200
audit: 200
notifications: 200
sessions: 200
CSRF cookie issued: true
CSRF-protected logout: 204
principal after logout: 401
```

An unavailable isolated MemoryV4 endpoint was intentionally represented through integration truth/notification state during the final UI run; it did not make the shell or other owner views fail.

## Security

- Session credential remains an `HttpOnly`, strict same-site cookie.
- The readable CSRF cookie is reflected as the mutation header by the browser API client.
- Login credentials are not retained in application state after the request lifecycle.
- UI proxy strips hop-by-hop request/response headers.
- Static paths are normalized and constrained to the production asset root.
- UI responses include CSP, frame denial, MIME sniffing denial, no-referrer policy, permissions policy, and no-store HTML caching.
- Production source maps are disabled.
- No production owner mutation or cutover occurred.

## Known bounded behavior

Resource and search views request bounded Gateway pages. When the Gateway reports more data, the UI labels the result as bounded instead of claiming completeness. Chat virtualizes the loaded message page; it does not silently fetch or mount an unbounded history.
