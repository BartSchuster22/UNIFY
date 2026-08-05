# Phase 5 — Hermes Framework Gateway

## Status

Phase 5 adds the standalone Core outbound gateway for independently registered Alica and Herman Hermes runtimes. The gateway depends only on the versioned `hermes-control/v1` contract and the UNIFY-owned Hermes control adapter. It has no runtime dependency on Worker, DMM, Agency, CHAT, or another retired control-plane application.

## Ownership boundary

- Hermes remains the immutable source of truth for native runtime identity, version, health, and capabilities.
- The UNIFY-owned adapter exposes the pinned Hermes runtime through `hermes-control/v1` without modifying Hermes.
- Core owns registration, endpoint and credential isolation, contract validation, normalized observations, capability documents, circuit state, and audit records.
- Credential values never enter PostgreSQL. Core stores only opaque `secret://` references and non-secret credential version labels.

## Independent Alica and Herman registration

`FrameworkGatewayService.registerAlicaAndHerman` rejects the pair unless all of these differ:

- canonical Core framework ID;
- private HTTPS origin;
- secret credential reference;
- native Hermes framework ID; and
- native Hermes instance ID.

Database uniqueness constraints enforce the same endpoint, credential, native identity, and instance isolation across every registration. `ensureAlicaAndHermanRegistered` is idempotent for startup reconciliation and fails closed with `framework_registration_drift` if an existing row differs from configuration.

Configure both registrations together; partial pair configuration is rejected:

```text
CORE_ALICA_FRAMEWORK_ID=frm_...
CORE_ALICA_ENDPOINT=https://10.20.0.2:28082
CORE_ALICA_CREDENTIAL_REFERENCE=secret://frameworks/alica
CORE_ALICA_NATIVE_FRAMEWORK_ID=hermes-alica
CORE_ALICA_INSTANCE_ID=alica-private-1
CORE_ALICA_RELEASE=0.20.0
CORE_ALICA_COMMIT=b8b17b8cee50b85adb7fba6ea332dc06731b86f4

CORE_HERMAN_FRAMEWORK_ID=frm_...
CORE_HERMAN_ENDPOINT=https://10.20.0.3:28082
CORE_HERMAN_CREDENTIAL_REFERENCE=secret://frameworks/herman
CORE_HERMAN_NATIVE_FRAMEWORK_ID=hermes-herman
CORE_HERMAN_INSTANCE_ID=herman-private-1
CORE_HERMAN_RELEASE=0.20.0
CORE_HERMAN_COMMIT=b8b17b8cee50b85adb7fba6ea332dc06731b86f4

CORE_FRAMEWORK_GATEWAY_SECRET_ROOT=/run/secrets/unify-frameworks
CORE_FRAMEWORK_GATEWAY_CREDENTIAL_CACHE_TTL_MS=5000
```

Each registration also supports independent timeout, retry, response-size, and circuit settings through `CORE_ALICA_*` and `CORE_HERMAN_*` variables documented by `frameworkGatewayConfigFromEnvironment`.

Construct the runtime with `frameworkGatewayRuntimeFromEnvironment`, authenticate a bootstrap service/user principal with `frameworks.manage`, and call `runtime.ensureRegistered(principal, requestContext)`. Runtime reads and inspections require `frameworks.read` in global or matching framework scope.

## Private transport

Core accepts only origin-only HTTPS URLs. Before every attempt it resolves the host and requires every returned address to be private, loopback, link-local, or carrier-grade private space. Empty, public, or mixed public/private resolution fails closed. Redirects are disabled, response bodies are bounded, and URL credentials, paths, queries, and fragments are rejected.

A private DNS name must resolve exclusively to private addresses. Its certificate must be trusted by the Core host. Install the private CA in the operating-system trust store rather than disabling certificate validation.

The adapter supports native TLS through:

```text
HERMES_ADAPTER_TLS_KEY_FILE=/run/secrets/.../framework.key
HERMES_ADAPTER_TLS_CERT_FILE=/run/secrets/.../framework.crt
```

Use independent certificates and private keys for Alica and Herman. `deploy/unify-hermes-control-adapter@.service` and `deploy/hermes-control-adapter.env.example` are hardened deployment templates; instantiate separate `@alica` and `@herman` units with separate environment files and network addresses.

## Inspection and contract enforcement

A successful inspection validates all four authenticated endpoints:

- `GET /control/v1/identity` — exact contract version, native framework ID, runtime kind, and instance ID;
- `GET /control/v1/version` — exact pinned release and commit and a clean runtime;
- `GET /control/v1/health` — strict health response contract;
- `GET /control/v1/capabilities` — strict capability response contract.

Every response is validated with the canonical TypeBox schemas from `@aquiero/contracts`; additional or malformed fields fail. All four calls in one inspection must use the same credential version. Raw validated responses are stored as immutable observations, and known Hermes capabilities are normalized into Core capability documents without inventing support for unknown native features.

## Resilience

Each idempotent GET has:

- a bounded per-attempt timeout;
- bounded exponential retries for network failures, timeouts, and HTTP 408, 425, 429, 500, 502, 503, and 504;
- no retry for deterministic contract, identity, version, authorization, or client errors;
- strict JSON content type and a configurable maximum body size.

Circuit state is persisted per framework in PostgreSQL. After the configured failure threshold, requests fail fast until the open interval expires. A leased half-open probe permits only one recovery inspection across Core processes. Success resets the circuit; failure reopens it. Safe error codes are persisted, never upstream response bodies or credentials.

## Token rotation

Gateway credential files use this strict JSON form:

```json
{
  "active": {
    "version": "2026-08-v2",
    "token": "a-secret-token-of-at-least-32-bytes"
  },
  "retiring": {
    "version": "2026-08-v1",
    "token": "the-previous-secret-token-at-least-32-bytes",
    "notAfter": "2026-08-04T22:00:00.000Z"
  }
}
```

The adapter accepts the same active/retiring overlap document when configured with `HERMES_ADAPTER_TOKEN_BUNDLE_FILE`. It reloads on a bounded cache interval and compares token digests in constant time. Core refreshes its credential file immediately after HTTP 401 and tries only unexpired, previously untried versions.

Zero-downtime rotation order:

1. Atomically replace the adapter bundle with new `active` and old `retiring` values.
2. Wait at least the adapter token-cache interval.
3. Atomically replace the matching Core secret bundle.
4. Run an authenticated inspection and confirm the new credential version in `framework_gateway_runtime` and immutable rotation history.
5. Remove the retiring credential from both sides after the overlap deadline.

Never reuse a token or token file between Alica and Herman. Tokens are not logged, audited, or stored in Core tables.

## Persistence

Forward-only migration `007_hermes_framework_gateway.sql` adds:

- immutable registration isolation indexes;
- `framework_gateway_policies`;
- `framework_gateway_runtime`;
- immutable `framework_gateway_observations`; and
- immutable `framework_gateway_token_rotations`.

Successful inspections update the existing Core framework health/version projection and capability documents in the same transaction as observations and audit. Failed inspections update circuit state and emit a safe failure audit record.

## Verification

```bash
pnpm --filter @unify/core typecheck
pnpm --filter @unify/core frameworks:test
pnpm --filter @aquiero/hermes-control-adapter typecheck
pnpm --filter @aquiero/hermes-control-adapter test

# A database name beginning with unify_core_framework_test is mandatory.
CORE_FRAMEWORK_TEST_DATABASE_URL='postgresql://.../unify_core_framework_test' \
  pnpm --filter @unify/core frameworks:test
```

The live PostgreSQL suite verifies migrations, authorization, idempotent Alica/Herman registration, endpoint and credential isolation, all four contracts, normalized capability persistence, audit-safe observations, and framework-specific token rotation.
