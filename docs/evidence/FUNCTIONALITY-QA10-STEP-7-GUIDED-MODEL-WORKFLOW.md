# Functionality QA10 — Step 7 Guided Model Workflow

- Date: `2026-08-09T17:24:15Z`
- Branch: `feature/unify-functionality-qa10`
- Step 6 base revision: `e2df4af4a51f821165cb58091deb9115422780e6`

## Scope

Step 7 replaces one-click/browser-confirm model changes with a guided, governed Hermes model-selection workflow. Hermes remains the sole catalogue, selection, provider-readiness, cost-tier, and capability authority.

## Workflow

The Models and Providers screen now exposes **Guided model selection**:

1. Choose a credential-ready or credential-free Hermes provider.
2. Choose an exact native model from that provider's authoritative catalogue.
3. Review framework, provider, model, capabilities, cost tier, and source version.
4. Acknowledge that provider pricing may differ, including premium or unknown tiers.
5. Review the truthful impact: existing sessions are unchanged; new Hermes sessions use the selection.
6. Run a governed `model.select` dry-run.
7. Enable execution only after the matching operation returns `verified`.
8. Execute with a separate idempotency key and explicit expensive-model confirmation.
9. Require verified governed execution and authoritative Hermes adapter readback.
10. Refresh authoritative provider/model inventory.

Per-model **Select** actions enter the same guided review rather than bypassing it. Already-selected models are reported truthfully and cannot generate a no-op mutation.

## Provider readiness

The workflow offers only providers that:

- report `credentialStatus=configured`; or
- advertise `authType=none`;
- and expose at least one authoritative model.

A provider with a missing credential must be configured through Step 6 first. No local readiness inference or fallback model catalogue is used.

## Cost and confirmation controls

- Cost tier is shown from Hermes inventory as `free`, `standard`, `premium`, or `unknown`.
- The acknowledgement explicitly includes premium and unknown tiers.
- `confirmExpensiveModel=true` is sent only from the acknowledged guided intent.
- Gateway rejects malformed non-boolean expensive-model confirmation values.
- Hermes native management remains authoritative if it requires additional expensive-model confirmation.

## Authority, isolation, and concurrency

- All reads, dry-runs, executions, and refreshes target the exact URL-selected verified framework.
- Mutation target is `owner=hermes`, `kind=model`, exact native model ID, exact framework ID.
- Payload pins exact provider ID and model `expectedSourceVersion`.
- Step 6's gateway envelope promotion sends that precondition to the Hermes command layer.
- Stale framework, inventory, and dry-run responses are discarded.
- Provider/model edits invalidate prior acknowledgement and dry-run evidence.
- Dry-run and execute use independent idempotency keys.
- A stale dry-run fails closed, refreshes authoritative inventory, and rotates all retry keys.
- Uncertain retries are safe: native selection is idempotent in effect and adapter readback must observe the exact provider/model as selected.
- There is no Agency or local model writer and no fallback catalogue.

## Permissions and capabilities

Model selection requires both:

```text
models.manage
models.execute = supported
```

The application shell passes the real authenticated `models.manage` permission. Read-only, forbidden, unsupported, unavailable, provider-not-ready, and already-selected states remain explicit.

## Regression coverage

Coverage includes:

- exact premium-model guided selection;
- displayed capabilities and cost tier;
- explicit pricing/impact acknowledgement;
- mandatory matching dry-run;
- distinct dry-run and execute idempotency keys;
- exact provider/model/framework/source-version payload;
- expensive-model confirmation propagation;
- stale catalogue conflict and safe retry with new keys;
- execute disabled after failed dry-run;
- role and capability denial;
- application-shell `models.manage` propagation;
- exact Herman reads and model mutation while Alica is also registered;
- zero reads or writes to non-selected Alica;
- hard Hermes outage without fallback inventory;
- existing Step 6 authoritative model-selection readback verification.

## Verification

Focused checks and the final repository gate:

```text
UNIUI typecheck = PASS
UNIUI tests = 54 passed, 2 expected fail
Gateway typecheck = PASS
Gateway mutation tests = 7 passed
pnpm qa = PASS
```

The UNIUI integration-test budget is explicitly 10 seconds to accommodate the expanded governed modal workflows under full-workspace parallel load; focused runs remain well below that budget.

The complete gate passed workspace linting, typechecking, all package and Python tests, production builds, reproducible contract checks, standalone-runtime verification, backup/identity/canary safety self-tests, and formatting.

## Operational boundary

No production model was selected. All mutations were fixture-only governed requests against mocked Hermes owners.
