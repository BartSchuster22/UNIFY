# Phase 6 Verification Report

Date: 2026-07-19

## Result

**PASS.** Phase 6 adds focused, installable Chat and Alerts web applications while preserving Gateway as the browser API boundary and existing domain services as authoritative owners. No native shell, push credential, downstream browser credential, second Chat responder, or notification owner was introduced.

## Delivered

- Authenticated responsive Chat PWA with `chat.read`, permission-conditioned `chat.send`, virtualized history, per-session drafts, governed sends, and authoritative refresh.
- Authenticated responsive Alerts PWA with owner RBAC, grouping, filtering, UNIUI deep links, and durable recipient-scoped acknowledgement.
- Shared auth, focused-shell, Chat, and notification packages consumed by the focused apps and UNIUI.
- PWA manifests, icons, and shell-only service workers that exclude `/api/` and authenticated data.
- Gateway notification materialization, durable acknowledgement, CSRF, RBAC, audit, OpenAPI, generated SDK, and no-store API responses.
- Hardened Compose images and same-origin proxies for Chat and Alerts.
- Native-shell readiness boundary with no native implementation or credentials.

## Automated gates

| Gate | Command | Result |
|---|---|---|
| Lint and boundaries | `pnpm lint` | PASS |
| TypeScript | `pnpm typecheck` | PASS, all 11 projects |
| Tests | `pnpm test` | PASS, 69 tests |
| Production builds | `pnpm build` | PASS, Gateway, UNIUI, Chat, Alerts and packages |
| Contract drift | `pnpm contracts:check` | PASS, reproducible |
| Formatting | `pnpm format:check` | PASS |
| Compose schema | `docker compose config --quiet` | PASS |
| Patch hygiene | `git diff --check` | PASS |

The Chat and Alerts component tests include axe accessibility checks. Gateway coverage includes recipient isolation, persisted state, acknowledgement RBAC/CSRF, and audit behavior. UNIUI coverage proves shared virtualized Chat rendering and URL-state isolation.

## Real-runtime evidence

The final local acceptance stack reported:

- PostgreSQL: healthy; migration service: exit `0`.
- Gateway, UNIUI, Chat, and Alerts: healthy.
- Gateway and all web applications: UID/GID `10001`, read-only root filesystem, all capabilities dropped, `no-new-privileges`.
- Chat and Alerts shell HTML, manifest, and service worker: HTTP `200`, defensive CSP, `DENY` framing, denied camera/microphone/geolocation, and `Cache-Control: no-store`.
- Manifest MIME type: `application/manifest+json`.

A real named administrator session was created through the Chat same-origin proxy and then reused across all three browser origins:

```text
login 200 admin
uniui shared-session 200 admin cache no-store
chat shared-session 200 admin cache no-store
alerts shared-session 200 admin cache no-store
chat-resource 200 items 1
alerts-resource 200 items 1
logout 204
post-logout-me 401
```

This verifies working named-user authentication, shared host-scoped session cookies, no-store authenticated responses, Chat and Alerts Gateway reads, CSRF logout, and immediate revocation. No credential or session value was printed or retained.

## Runtime defects found and fixed

1. The original Chat default port conflicted with an existing loopback Grafana binding. Focused defaults were moved to Chat `3101` and Alerts `3102`, and Gateway origins/runbooks were updated.
2. Notification JSON used `createdAt`/`deepLink`, while PostgreSQL record expansion expected `created_at`/`deep_link`. Explicit persistence mapping and regression assertions were added.
3. API responses lacked explicit cache prevention. Gateway now emits `Cache-Control: no-store` and `Pragma: no-cache`.
4. Parallel workspace QA exhausted local worker resources. Canonical build, typecheck, and test orchestration is serialized for deterministic CI/local execution.
5. UNIUI URL state leaked between tests after deep-link support. Every test now resets browser history.
6. The host filesystem reached capacity during container builds. Only disposable Docker build cache and dangling image data were pruned; persistent volumes were not removed.

## Security and ownership conclusion

- Browsers contact only Gateway through same-origin proxies.
- Domain credentials remain server-side secret files.
- Service workers cache no API requests or authenticated payloads.
- Notification acknowledgement is recipient-, owner-, session-, CSRF-, and permission-scoped.
- Chat writes remain governed Gateway operations delegated to the authoritative Chat owner.
- Native packaging remains blocked behind explicit future approval and platform-security design.

Phase 6 acceptance does not imply any legacy owner cutover or native-app authorization.
