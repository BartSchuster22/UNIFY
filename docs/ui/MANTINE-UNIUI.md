# Mantine UNIUI

## Purpose

UNIUI is the authenticated browser operator console for the Unified Gateway. It is a read-only Phase 4 projection of authoritative owner data. It never presents the Gateway cache or normalized view as the source of truth and rendering a view never performs an owner mutation.

## Runtime boundary

- The browser calls only same-origin `/api/v1/*` routes.
- The UNIUI Node server proxies `/api/*` to the Gateway and serves the immutable Vite bundle.
- Authentication uses the Gateway's named-user `HttpOnly` cookie session. Login accepts username/password; credentials are never retained by UNIUI.
- State-changing session actions acquire `/auth/csrf` and send `x-csrf-token`.
- Navigation is omitted unless the principal has the corresponding owner permission.
- CSP, frame denial, MIME sniffing protection, referrer policy and permissions policy are emitted by the UNIUI server.

## Shell and navigation

The Mantine `AppShell` provides:

- a desktop navigation rail and collapsible mobile navigation;
- a global Gateway search field;
- visible signed-in identity and roles;
- persisted light/dark theme selection;
- a skip-to-content link and semantic `header`, `nav`, and `main` landmarks;
- `Ctrl+K` or `/` global-search focus and `Escape` mobile-nav close;
- a reduced-motion mode inherited from the operating system.

The shell is usable down to 320 CSS pixels. Tables become horizontal scroll regions, resource cards collapse to one column, and the Chat split view becomes a stacked layout below 768 pixels.

## Truthful-state design system

Every owner-backed collection is wrapped by the same `TruthPanel` and `TruthBanner` behavior. It renders `current`, `stale`, `partial`, `empty`, `unavailable`, `unsupported`, `forbidden`, `failed`, and `inconclusive` as distinct labeled states. It also exposes:

- authoritative owner and adapter identity;
- source status and observation time;
- warnings returned by the Gateway;
- explicit retry controls for failures;
- an explicit empty-state panel instead of a blank screen;
- per-resource truth badges and canonical IDs.

Colors reinforce state but never carry the meaning alone.

## Views

| View | Gateway source | Owner semantics |
|---|---|---|
| Overview | `/integrations`, `/notifications` | Adapter health and source counts only |
| Frameworks | `/resources?owner=agency` | Agency is authoritative |
| Providers and models | `/resources?owner=dmm` | DMM is authoritative; provider/model tabs remain distinct |
| Profiles | `/resources?owner=hermes` | Hermes is authoritative |
| Work and Kanban | `/resources?owner=worker` | Worker is the only writer; board columns are projections |
| Chat | `/resources?owner=chat` | Chat owns sessions/messages/routes |
| Memory | `/resources?owner=memory-v4` and `/search` | MemoryV4 owns records; search remains read-only |
| Audit | `/audit` | Gateway hash-chain audit history |
| Operations | `/operations` | Gateway operation-state history |
| Notifications | `/notifications` | Normalized notification projection |
| Settings | `/sessions`, `/auth/csrf`, `/auth/logout` | Named sessions and local appearance only |

## Virtualized Chat

Chat session selection and message rendering are bounded and read-only. `@tanstack/react-virtual` renders only the visible message window plus overscan rather than mounting the entire result set. The message area uses `role="log"`, has an accessible label, preserves line breaks, and displays the current bounded-result count. Pagination truncation is reported rather than implied to be complete.

## Accessibility and interaction gates

Automated Vitest/JSDOM gates cover:

- named-user login labels and initial focus;
- axe-core checks for login and authenticated shell structure;
- semantic navigation and responsive menu controls;
- keyboard focus via `Ctrl+K`;
- explicit truthful empty-state announcements;
- the virtualized Chat log.

Manual/runtime gates are represented by the production bundle and Compose smoke verification at desktop and mobile CSS breakpoints. No behavior depends on hover or pointer-only interaction. Focus indicators use Mantine's keyboard focus ring.

## Development

```bash
pnpm --filter @aquiero/uniui typecheck
pnpm --filter @aquiero/uniui test
pnpm --filter @aquiero/uniui build
```

`pnpm --filter @aquiero/uniui build` creates `apps/uniui/dist`. The production image performs this build from the frozen workspace lockfile and runs as the non-root `uniui` user.
