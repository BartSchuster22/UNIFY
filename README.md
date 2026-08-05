# UNIFY

Aquiero's standalone Core, authenticated Gateway, Hermes framework control plane, and Mantine operator UI.

UNIFY owns native profiles, work, conversations, attachments, routing, authorization, audit, and access-plane state. Registered Hermes framework endpoints remain the only supported framework runtime dependency. Production has no connection path to Agency, DMM, Worker, `/CHAT`, or MemoryV4.

## Runtime invariants

- Browsers and focused applications use only same-origin UNIFY APIs.
- Core owns native profiles, work, conversations, messages, attachments, routing, and durable events.
- Gateway owns authentication, authorization, framework registrations, operations, audit, and derived notifications.
- Framework operations use only registered, versioned Hermes control endpoints and scoped credentials.
- Agency, DMM, Worker, `/CHAT`, and MemoryV4 are not valid runtime owners or configured upstream services.
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
```

`standalone:check` fails if retired adapters, owner clients, proxy routes, owner values, environment variables, secrets, or migration runtime paths return.

## Current architecture

- [Source-of-truth matrix](docs/architecture/SOURCE-OF-TRUTH.md)
- [Canonical resource identity](docs/architecture/RESOURCE-IDENTITY.md)
- [Hermes control contract](docs/architecture/HERMES-CONTROL-V1.md)
- [Native work](docs/rebuild/phase-08-native-work.md)
- [Native conversations](docs/rebuild/phase-09-native-agent-conversations.md)
- [Legacy runtime removal](docs/rebuild/phase-10-remove-legacy-runtime.md)
- [Authentication](docs/security/AUTHENTICATION.md)
- [Governed operations](docs/operations/MUTATIONS.md)
- [Local Compose](docs/runbooks/LOCAL-COMPOSE.md)
- [Production cutover](docs/runbooks/PRODUCTION-CUTOVER.md)

Earlier discovery, planning, and evidence documents are retained as historical records. Where they describe legacy adapters, owners, routes, or credentials, this README and the Phase 10 report supersede them.
