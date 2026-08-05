# Phase 11 — Lightweight Production Images

## Result

UNIFY's Gateway and web shells use pinned multi-stage images. Build stages contain the package manager and compiler; runtime stages use the non-root distroless Node.js 22 image and contain only compiled application output plus production dependencies.

## Pinned supply chain

| Purpose | Reference |
|---|---|
| Dockerfile frontend | `docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e` |
| Build | `node:22.22.2-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f` |
| Runtime | `gcr.io/distroless/nodejs22-debian13:nonroot@sha256:939d6f1671529d230f50b563578e9b5d206af58f038b10ebd7e1233023d4e167` |
| PostgreSQL | `postgres:16.6-alpine@sha256:1d04b9ba1d4996401f2552b51beda8187f175c0645c091e4781134fc9c9a3eef` |
| Scanner | `aquasec/trivy:0.69.3@sha256:bcc376de8d77cfe086a917230e818dc9f8528e3c852f7b1aff648949b6258d1c` |

Never replace these with floating tags. Update a version and digest together after reviewing upstream release notes and passing `pnpm image:verify`.

## Runtime controls

Every application container:

- runs as UID/GID `65532:65532`;
- has a read-only root filesystem and a restricted `/tmp` tmpfs;
- drops every Linux capability;
- enables `no-new-privileges`;
- has CPU, memory, PID, and shutdown-time limits;
- includes a container health check;
- receives `SIGTERM` and drains requests before exit.

Gateway shutdown stops event polling, closes Fastify, and drains the PostgreSQL pool. Web shells stop accepting connections, close idle connections, and enforce a ten-second drain deadline.

## Verification

Static checks run in normal QA:

```bash
pnpm image:check
pnpm qa
```

The release verification builds all four images, checks image metadata and size ceilings, starts the UI with the production security restrictions, waits for health, proves graceful shutdown, emits image-specific CycloneDX SBOMs, and fails on fixable HIGH or CRITICAL vulnerabilities:

```bash
pnpm image:verify
```

Generated SBOMs are written beneath `artifacts/sbom/` and are release evidence, not source files. Publish them alongside the immutable image digest.

## Release gates

A production image must not be published unless all of the following pass:

1. `pnpm qa`
2. `pnpm image:verify`
3. image digest recorded in the release manifest;
4. generated SBOM retained with release evidence;
5. no fixable HIGH or CRITICAL vulnerability reported.

Unfixed findings are reported by Trivy but do not fail the automated gate because no remediated package exists. They still require review before release.
