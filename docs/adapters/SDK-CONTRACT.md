# Adapter SDK Contract

Framework integrations implement `FrameworkAdapter`; Gateway and UI code must not import framework internals. Each adapter exposes capabilities, reads canonical resource references, and performs explicit-mode mutations.

## Request context

Every call carries request and correlation IDs. Mutations carry an idempotency key. Callers may provide `AbortSignal`; adapters must stop work promptly when it aborts.

## Truth and provenance

Every adapter result declares `sourceStatus`, `observedAt`, optional expiry/source version, and warnings. Adapters must distinguish `live`, `cached`, `stale`, `derived`, `unavailable`, and `ambiguous`. Unknown state is not converted into a successful empty result.

## HTTP resilience

`ResilientHttpClient` provides:

- per-request deadlines;
- caller cancellation;
- normalized authentication, authorization, validation, conflict, rate-limit, timeout, unavailable, protocol, and circuit-open errors;
- bounded exponential retry delay and bounded `Retry-After` handling;
- retries for reads;
- retries for mutations only when an idempotency key is present;
- closed/open/half-open circuit breaking with a single recovery probe.

Unsafe mutations are attempted once. Caller cancellation is not counted as an upstream failure.

## Credentials

Adapters receive credential handles and a `CredentialProvider`, not credentials embedded in configuration. Resolved headers live only for the request. They must never be included in errors, evidence, logs, capability manifests, or returned values.

## Contract testing

Each framework adapter must run the shared hermetic contract suite and its own fixtures for:

- success and canonical mapping;
- degraded/unavailable source;
- timeout and cancellation;
- safe retry and no unsafe retry;
- malformed upstream responses;
- authentication/authorization failures;
- circuit opening and recovery;
- secret-free errors and evidence.
