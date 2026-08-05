# Phase 10 — Remove All Legacy Runtime Code

## Result

UNIFY production runtime has no connection path to Agency, DMM, Worker, `/CHAT`, or MemoryV4. Native Core and registered Hermes framework endpoints are the only domain/runtime sources.

## Deleted runtime surfaces

- Gateway integration adapters, federation service, and adapter types.
- Legacy/migration owner HTTP client and tests.
- Cutover policy and domain activation implementation.
- Generic adapter SDK package and Gateway dependency.
- Migration reader feature flag and dynamic imports.
- Legacy URL, username, password, token, and secret-file configuration.
- Compose secret preparation and mounts for retired services.
- Integration/resource/search/event/shadow proxy routes.
- Cross-owner UNIUI search and migration Memory explorer.
- Legacy route inventory and cutover scripts.
- Migration-only owner/provenance values in current contracts.

## Retained boundaries

- Gateway authentication, authorization, operations, audit, framework registry, and Hermes control integration.
- Core native profiles, work, conversations, messages, routing, attachments, realtime events, and PostgreSQL integrity.
- Gateway recipient-scoped PostgreSQL notifications; listing does not refresh an external owner.
- Historical discovery/evidence documents and applied database migration history. These are records, not executable runtime paths.

## Enforcement

`scripts/check-standalone-runtime.mjs` verifies:

- deleted runtime directories and files remain absent;
- production source and Compose contain no retired connection settings or owner-client symbols;
- current contracts contain no retired owner values;
- retired public proxy routes do not return to Gateway or OpenAPI.

The check runs in `pnpm lint`, `pnpm standalone:check`, and therefore `pnpm qa`.

## Verification commands

```bash
pnpm contracts:generate
pnpm qa
pnpm standalone:check
git diff --check
```

Completion additionally requires a clean pushed branch whose local and upstream commit IDs are identical.
