# Phase 8 — provider production QA acceptance

## Scope

Production target: ALICA-v1 (`167.233.135.142`).

Framework authorities:

- `hermes-alica`
- `hermes-herman`

Each runtime exposes the same 42-provider Hermes catalogue and independent framework state.

## Executed matrix

The production harness `scripts/phase-8-provider-production-qa.py` ran independently inside both read-only Hermes runtime containers.

Per framework it executed:

- 42 provider contract and redaction checks;
- 42 provider-validation dry-runs;
- 42 model-refresh dry-runs;
- 42 inference-test dry-runs;
- 42 disconnect/remove dry-runs;
- 42 stale-source-version execute probes expecting safe HTTP 409 errors;
- a before/after state comparison proving no credential or selection mutation.

Combined production coverage:

| Check | Alica | Herman | Total |
|---|---:|---:|---:|
| Provider contracts | 42 | 42 | 84 |
| Governed dry-runs | 168 | 168 | 336 |
| Safe stale-version errors | 42 | 42 | 84 |
| Secret-response scans | all responses | all responses | passed |
| State unchanged | passed | passed | passed |

## Restart and isolation

Each Hermes runtime was restarted separately. While Alica restarted, Herman remained healthy; while Herman restarted, Alica remained healthy. Both returned healthy and repeated the complete 42-provider harness successfully after restart. Container identities remained unchanged, proving restart rather than replacement.

## Production state and decisive blocker

Both framework inventories truthfully report:

- provider count: 42;
- configured provider: `moa` only;
- selected provider/model: none;
- real provider credentials/accounts: none.

Therefore real per-provider inference, valid-credential acceptance, persistence of provider credentials, and destructive disconnect/reconnect cannot be executed for the 41 unconfigured providers. Provider secrets/accounts were not supplied to ALICA-v1 and cannot be fabricated by QA.

`moa/default` was invoked on both frameworks. That exposed a false-positive defect in the inference gate: the prior adapter accepted any returned message ID/content, including an accepted user message, as successful inference. The corresponding created Hermes session had zero messages, zero API calls, zero input/output tokens, and no assistant response. The adapter was corrected to require a non-empty assistant/agent response, poll authoritative session messages, and emit only a SHA-256 response digest plus latency.

## Evidence

Production host paths:

- `/opt/unify/qa/phase-8/alica-phase8.json`
- `/opt/unify/qa/phase-8/herman-phase8.json`
- `/opt/unify/qa/phase-8/alica-phase8-postrestart.json`
- `/opt/unify/qa/phase-8/herman-phase8-postrestart.json`
- `/opt/unify/qa/phase-8/alica-phase8-inference-attempt.json`
- `/opt/unify/qa/phase-8/herman-phase8-inference-attempt.json`

The evidence contains only non-secret setup metadata, result states, counts, safe error codes, and response digests. Runtime secret values are checked against every raw adapter response and the final evidence document.

## Acceptance verdict

**Phase 8 is not fully accepted.**

Passed:

- all 42 providers are independently enumerated for Alica and Herman;
- truthful contract shape and safe setup metadata;
- secret response/evidence redaction;
- framework isolation;
- governed validation, refresh, inference, and disconnect dry-run routing;
- safe stale-source errors;
- independent runtime restart and recovery;
- no production-state mutation.

Blocked:

- valid credential/account acceptance for 41 providers;
- real assistant inference for all 42 providers;
- provider-specific credential persistence across restart;
- real disconnect/reconnect or revoke behavior.

Unblock requirement: provision independent authorized test credentials/accounts/endpoints and billable-inference approval for each provider in both frameworks. OAuth and external-cloud providers additionally require interactive account authorization and relevant cloud/CLI prerequisites.
