# Functionality QA10 — Step 6 Guided Provider Workflow

- Date: `2026-08-09T16:40:48Z`
- Branch: `feature/unify-functionality-qa10`
- Step 5 base revision: `4e0ab9376a1bc2309dd13c4c09b53b3a17d7184e`

## Scope

Step 6 replaces inline credential entry with a guided, governed Hermes provider setup workflow while preserving Hermes as the sole provider and model authority.

## Workflow

The Models and Providers screen now exposes **Guided provider setup**:

1. Choose an API-key provider from authoritative Hermes inventory.
2. Enter the provider credential in an ephemeral password field.
3. Review exact framework, owner, provider, and pinned provider source version.
4. Explicitly acknowledge that the secret will be sent to the selected Hermes framework.
5. Run a governed `provider.credential.set` dry-run.
6. Enable execute only when the matching dry-run returns a `verified` operation.
7. Execute with an independent idempotency key.
8. Require a `verified` governed result and authoritative Hermes readback.
9. Clear credential state and refresh authoritative inventory.

Editing provider or credential invalidates prior review and dry-run evidence.

## Credential security

- Credential state exists only inside the open React modal.
- It is never placed in a URL, query parameter, local storage, notice, or evidence display.
- Closing the modal or switching framework discards it.
- Dry-run/execute failure clears it and forces re-entry.
- Success clears it before the modal closes.
- Gateway governance persists only redacted/hash evidence.
- Adapter command audits redact credential payloads.
- OAuth providers show truthful Hermes-managed guidance and no token field.
- Providers whose credential contract is immutable are not offered as setup targets.

## Authority, concurrency, and verification

- All reads and mutations target the exact URL-selected verified framework.
- The target is `owner=hermes`, `kind=provider`, exact native provider ID, exact framework ID.
- Provider `sourceVersion` is pinned as `expectedSourceVersion` for dry-run and execute.
- Gateway promotes that precondition into the Hermes command envelope and removes it from the owner payload.
- Hermes adapter rejects stale source versions before execution.
- After execution, the adapter re-reads authoritative providers/models and fails with a retryable `502` unless the requested credential or model state is observable.
- Stale inventory, dry-run, and execute responses are discarded after framework changes.
- An edited credential cannot inherit an in-flight dry-run result.
- There is no Agency or local provider writer and no fallback catalogue.

## Permissions and capabilities

Credential setup requires both:

```text
credentials.manage
provider.credentials.execute = supported
```

Read-only, forbidden, unavailable, unsupported, OAuth, and immutable-credential states remain explicit. The application shell passes the real authenticated permission to the Models view.

Existing credential removal and model selection also send source-version preconditions and now require verified operation results.

## Regression coverage

Coverage includes:

- guided choose → credential → review → dry-run → execute flow;
- explicit acknowledgement and matching dry-run requirement;
- distinct dry-run and execute idempotency keys;
- source-version propagation through UI, gateway, and Hermes command envelope;
- credential clearing after success and conflict;
- no plaintext secret in UI completion evidence or persisted adapter/governance evidence;
- exact Herman routing while Alica is also registered;
- zero reads or writes to the non-selected Alica framework;
- role and capability denial;
- application-shell `credentials.manage` propagation;
- hard Hermes outage with no fallback catalogue;
- adapter authoritative readback failure after an apparently successful native mutation;
- verified readback for credential and model-management operations.

## Verification

Focused checks and the final repository gate:

```text
UNIUI typecheck = PASS
UNIUI tests = 51 passed, 2 expected fail
Gateway typecheck = PASS
Gateway tests = 86 passed
Hermes control adapter typecheck = PASS
Hermes control adapter tests = 28 passed
pnpm qa = PASS
```

The complete gate passed workspace linting, typechecking, all package and Python tests, production builds, reproducible contract checks, standalone-runtime verification, backup/identity/canary safety self-tests, and formatting.

## Operational boundary

No production provider credential was submitted, removed, or changed. Tests use fixture-only credentials and mocked owner calls.
