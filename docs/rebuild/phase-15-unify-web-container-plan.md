# Phase 15 — UNIFY Web Copy, Container, and ALICA-v1 Rollout Plan

## Objective

Copy the existing `uniui.aquiero.com` operator experience from the repository's `apps/uniui` source, build it as **UNIFY Web**, and run it on ALICA-v1 as a separately managed, hardened container. After private deployment acceptance, publish it through a new DNS subdomain and the existing containerized Caddy ingress.

UNIFY Web remains a presentation and same-origin API-proxy tier. UNIFY Core remains the central identity, policy, routing, audit, and framework-distribution gateway. The browser must not connect directly to Hermes runtimes.

## Starting point

- Canonical UI source: `apps/uniui`
- UI framework: React 19, Mantine 9, Tabler Icons, shared chat and notification components, Vite 8
- Runtime server: `apps/uniui/server.mjs`
- Existing production image definition: `Dockerfile.uniui`
- Existing live reference: `https://uniui.aquiero.com`
- ALICA-v1 Core ingress: containerized Caddy and the internal `unify_unify-ingress` network
- The live reference currently resolves to a different host than ALICA-v1. It is a behavioral reference, not a production dependency.

## Architecture decision

Run UNIFY Web in its own Compose project, `unify-web`, with one container:

```text
Browser
  -> HTTPS / new UNIFY Web subdomain
  -> existing containerized Caddy
  -> unify-web:3000
       -> same-origin /api/v1/* proxy
       -> unify-core:8080
       -> registered Hermes framework(s)
```

The add-on attaches only to the existing internal ingress network. It publishes no host ports, mounts no secrets, has no Docker socket, and has no direct framework or database network access. This preserves the accepted five-container Core topology as an independently managed platform unit while adding a separately deployable UI workload.

## Step-by-step delivery plan

### 1. Baseline and copy

1. Treat `apps/uniui` as the canonical source copy of the existing UNIFY operator UI.
2. Record the source commit and live reference headers/assets for traceability.
3. Preserve the current React/Mantine component system, authentication flow, CSRF behavior, navigation, framework views, work views, chat, audit, operations, notifications, and safety actions.
4. Do not copy production credentials, cookies, certificates, runtime data, or host configuration from the old UI host.

**Gate:** local source builds and its existing tests pass without functional regression.

### 2. Hardened UNIFY Web image

1. Build with the digest-pinned Node builder already declared by `Dockerfile.uniui`.
2. Produce static Vite assets.
3. Copy only the built assets and minimal Node HTTP/proxy server into the digest-pinned distroless runtime.
4. Run as UID/GID `65532:65532` with a read-only root, dropped capabilities, no-new-privileges, resource limits, health check, and graceful SIGTERM handling.
5. Tag the release, inspect it, scan it, generate an SBOM, and deploy only by immutable digest.

**Gate:** image builds, remains within the size limit, starts healthy, serves the SPA/security headers, proxies API requests, and shuts down gracefully.

### 3. Separate deployment unit

1. Use `deploy/unify-web/compose.yaml` as a one-service Compose project.
2. Attach only to the external internal network `unify_unify-ingress`.
3. Do not publish ports or attach database/framework/egress networks.
4. Configure `GATEWAY_INTERNAL_URL=http://unify-core:8080`.
5. Validate the Compose security contract and immutable image input.

**Gate:** rendered Compose has exactly one service, no host ports, one internal-network attachment, and all required hardening controls.

### 4. UI-to-Core compatibility

1. Choose the new production hostname before release activation.
2. Add its exact HTTPS origin to UNIFY Core's `ALLOWED_ORIGINS` allowlist.
3. Add a Caddy virtual host that proxies the new hostname to `unify-web:3000`.
4. Preserve host-only Secure/SameSite session cookies and CSRF checks through the same-origin UI proxy.
5. Do not expose `unify-core:8080` or any Hermes-native port.

**Gate:** login, authenticated reads, CSRF-protected mutation validation, logout, and origin rejection all pass through the new UI origin.

### 5. Local acceptance

1. Run UniUI unit, accessibility, type, and build tests.
2. Build and inspect the production image.
3. Run the image against a controlled mock Core for health, SPA routing, API forwarding, cookies, request bodies, and error behavior.
4. Run repository lint/type/test/build/contract/security checks.

**Gate:** all checks pass with no ignored high/critical fixed vulnerabilities.

### 6. ALICA-v1 preflight and rollback preparation

1. Inventory the current five accepted containers, Caddy release, Core release, ingress network, available resources, and DNS state.
2. Freeze relevant deployment changes.
3. Archive current Core/Caddy definitions and create checksums.
4. Verify the current encrypted backup and rollback commands.
5. Stage the digest-pinned UNIFY Web, Core, and Caddy images before changing production.

**Gate:** current production remains healthy and rollback is executable before mutation.

### 7. Private production deployment

1. Upgrade Core/Caddy configuration for the future hostname while keeping the existing public API origin healthy.
2. Start the separate `unify-web` project without DNS exposure.
3. Verify container health, no host port publication, network boundaries, Caddy-to-Web connectivity, and Web-to-Core connectivity using controlled host resolution.
4. Restart the Web container and confirm automatic convergence.
5. Run existing Core/Hermes QA to prove no regression.

**Gate:** private production acceptance passes before DNS is changed.

### 8. Subdomain activation

1. Create the agreed DNS `A` record pointing to ALICA-v1 (`167.233.135.142`); add `AAAA` only if the host's IPv6 ingress is intentionally supported.
2. Wait for authoritative and recursive DNS convergence.
3. Allow Caddy to obtain the certificate.
4. Verify certificate hostname, HTTPS redirect, HSTS/CSP/security headers, UI assets, `/healthz`, login, Core API access, and framework-backed views.

**Gate:** the new public hostname passes smoke and authenticated acceptance; the existing UNIFY Core origin remains healthy.

### 9. Closeout

1. Save evidence without secrets.
2. Update the ALICA-v1 as-built topology and operations runbook.
3. Record immutable image digests, deployment paths, DNS record, rollback commands, and acceptance results.
4. Commit, push, and verify the exact remote SHA.

## Rollback

Rollback is independent and ordered:

1. Remove or disable the new DNS record/Caddy site.
2. Stop the `unify-web` Compose project.
3. Restore the previous Caddy/Core release definitions if they were changed.
4. Verify the original Core public readiness and QA gates.
5. Retain the UNIFY Web image/evidence until the rollback-retention decision expires.

No database migration or framework-data mutation is required for the initial UNIFY Web deployment.

## Confirmed public hostname and migration

- Target hostname: `uniui.aquiero.com`
- Current address: `188.245.221.1` (the existing UI host)
- Target address: `167.233.135.142` (ALICA-v1)
- Observed DNS TTL during planning: approximately two minutes
- Migration policy: keep the existing UI serving until the new ALICA-v1 container passes private acceptance; then change the `A` record. Do not retire the old service until public acceptance passes through independent resolvers.
- DNS authority: `ns.udag.de`, `ns.udag.net`, and `ns.udag.org`
- The exact DNS update mechanism or credentials must be supplied/operated by the domain owner; no DNS credentials are stored in this repository.

## Information required before public activation

- DNS provider access or confirmation that the user will change `uniui.aquiero.com` from `188.245.221.1` to `167.233.135.142`
- Decision on when to retire the old UI service after the new public endpoint passes acceptance
