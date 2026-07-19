# ADR 0001 — Modular Monolith in a TypeScript Monorepo

- **Status:** Accepted
- **Date:** 2026-07-19

## Context

One Aquiero installation must normalize several domains and one or more Hermes instances. Cross-cutting identity, policy, operations, audit, mappings and events need transactional consistency. Premature microservices would multiply deployment, authentication, tracing and failure modes.

## Decision

Implement the Gateway as a TypeScript modular monolith with strict internal module and adapter interfaces in a pnpm monorepo. Deploy Gateway, UNIUI, focused Chat and Alerts independently. Use Fastify for the Gateway and React/Vite/Mantine for browser applications.

## Consequences

- One Gateway process and database simplify transactions and operations.
- Internal boundaries remain testable and extractable.
- Shared packages prevent contract/UI duplication.
- Module-boundary linting and contract tests are mandatory to prevent an unstructured monolith.
- Horizontal scaling later requires shared event pub/sub and replay implementation.

## Rejected alternatives

- Big-bang rewrite: rejected for ownership and rollback risk.
- Initial microservice fleet: rejected as unnecessary operational complexity.
- Browser composition of legacy APIs: rejected because it bypasses central identity/policy and exposes service credentials/contracts.
