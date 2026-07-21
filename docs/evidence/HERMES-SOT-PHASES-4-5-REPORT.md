# Hermes source-of-truth Phases 4 and 5 evidence

Date: 2026-07-21

## Decision

**PASS.** Phase 4 Gateway/Hermes foundations and Phase 5 Profiles/Models cutover are implemented and verified.

## Ownership result

- Hermes is the only production source for framework profiles and provider/model configuration.
- Profiles and Models no longer read from Agency or DMM production context routes.
- Unsupported profile and provider credential writes fail closed with `NO_IDEMPOTENT_NONINTERACTIVE_INTERFACE` and remain visibly disabled.
- Provider projections contain only safe identity, selection, and credential-status fields. They do not expose credential values, fingerprints, environment-variable names, secret locations, or tokens.
- Worker, CHAT, and Memory V4 read integrations remain available pending their own cutover phases; Agency and DMM legacy readers are disabled by default.

## Phase 4 evidence

- Registered framework connections are pinned to `hermes-control/v1`, Hermes `0.18.0`, and commit `9e54eee44f1cbbe62247a36546e51ff8940373c6`.
- Gateway service authentication is resolved from secret references and is never returned by registration APIs.
- Gateway proxies capabilities, profiles, providers, work, conversations, and events with Hermes provenance.
- Framework event replay is persisted in PostgreSQL with bounded pagination, cursor validation, idempotency, and stale/unavailable truth.
- `framework.reconcile` routes through `HermesGatewayService` and uses a Gateway-derived idempotency key.
- The host-local adapter runs as the enabled `unify-hermes-control-adapter.service` systemd unit and listens on loopback.
- The pinned Hermes tracked tree was unchanged after verification.

## Phase 5 evidence

- Live Gateway Profiles response: 6 items, all `owner=hermes`.
- Live Gateway Providers response: 26 items, all `owner=hermes`.
- Recursive provider response key audit found no forbidden secret-bearing fields.
- Legacy `profiles/agency-context` and `models/dmm-context` requests fail closed with HTTP 503.
- Worker, CHAT, and Memory V4 resource reads continue to return HTTP 200.
- Profiles/Models tests cover ownership, provenance, pagination, unavailable Hermes without fallback, secret safety, and unsupported mutations.

## Database and adapter evidence

- Applied repository migrations: `001_gateway_foundation`, `002_governance_guards`, `002_hermes_control_registry`, `003_hermes_adapter_foundations`, and `004_gateway_hermes_framework`.
- Controlled `004` rollback and reapply completed successfully.
- The pre-existing external ledger entry `003_notification_critical_severity` remains preserved.
- PostgreSQL adapter verification passed with 2 durable events, idempotent replay, 2 audit events, and a valid audit hash chain.
- Live reconciliation completed for `profiles` and `providers`, emitted 2 events, and those events were served by the Gateway as `freshness=current`.

## Contract and QA evidence

- OpenAPI and generated TypeScript SDK now include the public framework capabilities, Profiles, Providers, Work, Conversations, and Events projections.
- Generated artifacts are reproducible (`pnpm contracts:check`).
- Full `pnpm qa` passed after final source and generated-artifact changes:
  - lint and architecture/source-of-truth policy checks;
  - all workspace typechecks;
  - Gateway: 13 files / 79 tests;
  - Hermes control adapter: 2 files / 10 tests;
  - UNIUI: 5 files / 19 tests;
  - all remaining workspace tests and builds;
  - generated contract, legacy inventory, and formatting checks.
- Pinned live Hermes contract verification passed.

## Production evidence

- Merged development/production Compose configuration validates.
- Final Gateway and UNIUI images built successfully.
- Gateway and UNIUI were recreated from the final images and reached healthy state.
- Gateway readiness returned HTTP 200; UNIUI returned HTTP 200.
- Authenticated live framework, capabilities, Profiles, Providers, Events, Worker, CHAT, and Memory V4 requests returned HTTP 200.
