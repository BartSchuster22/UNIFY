# UNIFY

Aquiero's standalone Core, authenticated Gateway, Hermes framework control plane, and Mantine operator UI.

UNIFY owns native profiles, work, conversations, attachments, routing, authorization, audit, and access-plane state. Registered Hermes framework endpoints remain the supported framework runtime dependency. A dedicated, governed MemoryV4 adapter is the only supported external-memory connection; production has no connection path to Agency, DMM, Worker, or `/CHAT`.

## Runtime invariants

- Browsers and focused applications use only same-origin UNIFY APIs.
- Core owns native profiles, work, conversations, messages, attachments, routing, and durable events.
- Gateway owns authentication, authorization, framework registrations, operations, audit, and derived notifications.
- Framework operations use only registered, versioned Hermes control endpoints and scoped credentials.
- Agency, DMM, Worker, and `/CHAT` are not valid runtime owners or configured upstream services; MemoryV4 is external memory truth behind the dedicated Gateway adapter and is not a UNIFY resource owner.
- Rendering a route never mutates state.
- Meaningful writes require capability and policy checks, idempotency, exact targets, and durable evidence.
- UNIFY does not introduce a second board writer, scheduler, dispatcher, webhook owner, or responder.

## Deployables

```text
apps/core          Native domain APIs and PostgreSQL state
apps/gateway       Identity, policy, framework control, operations and audit
apps/uniui         Mantine browser operator application
apps/chat-pwa      Native Core conversation PWA
apps/alerts-pwa    Gateway notification PWA
packages/*         Contracts, generated SDK, auth client and UI components
```

## Verification

```bash
pnpm install --frozen-lockfile
pnpm qa
pnpm standalone:check
pnpm image:verify
```

`standalone:check` fails if retired generic adapters, owner clients, proxy routes, owner values, environment variables, secrets, or migration runtime paths return. The narrow MemoryV4 allowlist is documented and tested separately.

`image:verify` builds the pinned distroless production images, exercises health and graceful shutdown under the Compose security restrictions, emits CycloneDX SBOMs, and fails on fixable HIGH or CRITICAL vulnerabilities.

## Current architecture

- [ALICA-v1 production as-built](docs/as-built/ALICA-V1-CURRENT-SETUP.md)
- [ALICA-v1 pre-Phase-14 production snapshot](docs/as-built/ALICA-V1-PRE-PHASE14-SNAPSHOT.md)
- [Source-of-truth matrix](docs/architecture/SOURCE-OF-TRUTH.md)
- [Canonical resource identity](docs/architecture/RESOURCE-IDENTITY.md)
- [Hermes control contract](docs/architecture/HERMES-CONTROL-V1.md)
- [Governed MemoryV4 adapter](docs/adapters/MEMORY-V4.md)
- [MemoryV4 adapter acceptance evidence](docs/evidence/MEMORY-V4-ADAPTER-REPORT.md)
- [Native work management](docs/rebuild/phase-08-native-work-management.md)
- [Native conversations](docs/rebuild/phase-09-native-agent-conversations.md)
- [Legacy runtime removal](docs/rebuild/phase-10-remove-legacy-runtime.md)
- [Lightweight production images](docs/rebuild/phase-11-lightweight-production-image.md)
- [Phase 14.0 frozen baseline evidence](docs/rebuild/phase-14-0-baseline-evidence.md)
- [Five-container single-instance rebuild plan](docs/rebuild/phase-14-five-container-topology-plan.md)
- [Phase 14.1 combined framework runtime evidence](docs/rebuild/phase-14-1-combined-runtime-evidence.md)
- [Phase 14.2 five-service Compose evidence](docs/rebuild/phase-14-2-five-service-compose-evidence.md)
- [Phase 14.3 declarative configuration evidence](docs/rebuild/phase-14-3-declarative-configuration-evidence.md)
- [Phase 14.4 installer and upgrade evidence](docs/rebuild/phase-14-4-installer-upgrade-evidence.md)
- [Phase 14.5 automated and live acceptance evidence](docs/rebuild/phase-14-5-automated-live-acceptance-evidence.md)
- [Phase 14.6 production cutover and obsolete-topology retirement evidence](docs/rebuild/phase-14-6-production-cutover-evidence.md)
- [Phase 15 UNIFY Web container plan](docs/rebuild/phase-15-unify-web-container-plan.md)
- [Phase 15 UNIFY Web production evidence](docs/rebuild/phase-15-unify-web-production-evidence.md)
- [Five-service installer, upgrade, and rollback](docs/runbooks/FIVE-SERVICE-INSTALLER.md)
- [Authentication](docs/security/AUTHENTICATION.md)
- [Governed operations](docs/operations/MUTATIONS.md)
- [Local Compose](docs/runbooks/LOCAL-COMPOSE.md)
- [Production cutover](docs/runbooks/PRODUCTION-CUTOVER.md)

Earlier discovery, planning, and evidence documents are retained as historical records. Where they describe legacy generic adapters, owners, routes, or credentials, this README, the Phase 10 report, and the dedicated MemoryV4 adapter contract supersede them.
