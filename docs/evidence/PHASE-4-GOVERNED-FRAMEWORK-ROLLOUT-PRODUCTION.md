# Phase 4 governed framework rollout — production acceptance

## Result

**PASS — accepted on ALICA-v1 on 2026-08-11 UTC.**

The production exercise verified an immutable Alica-first canary, an enforced observation window and healthy-sample threshold, explicit administrator promotion of Herman, independent convergence of both framework targets, and a governed one-click rollback to both prior runtime images. The full rollout, observation, promotion, and rollback records remain persisted in production PostgreSQL and are copied into the repository as immutable JSON checkpoints.

No password, token, cookie, connection string, private key, or other secret is recorded in this evidence.

## Source and production release

| Attribute | Accepted value |
|---|---|
| Source branch | `feature/unify-functionality-qa10` |
| Governed rollout implementation | `6cf9e78` |
| Legacy upgrade compatibility fix | `95f9b15` |
| Candidate runtime marker fix | `4a40306` |
| Promotion audit SQL fix | `811875c` |
| Rollback audit SQL fix / accepted source | `b4109c983ead384d069a90752f2126b9c2ca9361` |
| Platform release | `phase-20.2-b4109c9` |
| Rollback platform release | `phase-20.0-95f9b15` |
| Production host | `ALICA-v1` (`167.233.135.142`) |
| Public UI | `https://uniui.aquiero.com` |

The managed installer accepted the final release and verified it idempotently:

```json
{"schemaVersion":"unify-installer-result/v1","mode":"upgrade","releaseId":"phase-20.2-b4109c9","changed":true,"project":"unify","status":"PASS"}
{"schemaVersion":"unify-installer-result/v1","mode":"verify","releaseId":"phase-20.2-b4109c9","changed":false,"project":"unify","status":"PASS"}
```

`/opt/unify-five-service/current` resolves to `phase-20.2-b4109c9`. The installer state and `/opt/unify-five-service/rollback` retain `phase-20.0-95f9b15` as the verified platform rollback artifact.

## Immutable artifacts

| Artifact | Immutable registry reference |
|---|---|
| Accepted Hermes runtime | `localhost:5000/unify/hermes-runtime@sha256:78924999ce02475102343153611516f42e7c196d160d1abdb9df3b114429a3a2` |
| Assessed candidate runtime | `localhost:5000/unify/hermes-candidate@sha256:5c08edb6e2df17ef877b13fb85516b1549058a6a294c8a1c4d112812ec790bbf` |
| Final Core | `localhost:5000/unify/core@sha256:8ce246ee87129cfb05960ea354ffd19645cbef2ac862759da100e55d9d3a3532` |
| Web | `localhost:5000/unify/web@sha256:512e3bd4a3dd3736032e51c6f9d2e1755ed2e7d45fda6b02d2701bd73528ed1f` |

Candidate assessment `fca_2a3fc30696a25d998a6169810a24dd53b1c4f9aca27207199f169a3aa49b76be` was `ready` before rollout creation. The candidate carried Hermes release `0.20.0`, upstream commit `3c27eb6234bf91b8ceee9e9071591b31e9b148cb`, and the explicit assessed-candidate runtime marker.

## Governed release rollout

Release plan:

```text
945d4dc5-2618-42a8-92ab-a7306b69dd6e
```

Policy snapshot:

```json
{
  "canaryFrameworkId": "hermes-alica",
  "observationWindowSeconds": 15,
  "requiredHealthySamples": 3,
  "manualPromotionRequired": true
}
```

### Canary isolation

The worker changed only Alica first. Persisted target state at the promotion gate was:

```text
hermes-alica  converged
hermes-herman awaiting_promotion
```

At that checkpoint:

- Alica used candidate digest `sha256:5c08edb6e2df17ef877b13fb85516b1549058a6a294c8a1c4d112812ec790bbf` and was healthy.
- Herman still used prior digest `sha256:78924999ce02475102343153611516f42e7c196d160d1abdb9df3b114429a3a2` and was healthy.
- Herman had no convergence mutation recorded.

### Observation gate

The observation window started at `2026-08-11T15:54:44.454Z` and had deadline `2026-08-11T15:54:59.454Z`.

Four healthy Alica observations were persisted at:

1. `15:54:45.066Z`
2. `15:54:50.854Z`
3. `15:54:56.861Z`
4. `15:55:02.843Z`

Every observation verified health, image identity, release identity, and commit identity. The third sample met the sample count but occurred before the deadline, so the plan remained `observing`. Promotion became available only after the fourth healthy sample occurred after the deadline. The live automation also attempted promotion before the gate and required the governed HTTP `409` rejection before continuing.

### Explicit promotion and convergence

The administrator explicitly promoted the plan at `2026-08-11T16:00:14.101Z`. The persisted event records the promotion actor. Herman started only after that event and converged at `16:01:12.046Z`.

The release plan reached `succeeded` at `16:01:12.167Z`. At the promoted checkpoint, both Alica and Herman were healthy and used the exact candidate image identity.

## Governed one-click rollback

Rollback plan:

```text
b4c824a5-c99d-42ad-b0db-b2f147bf6c5c
```

Persisted reason:

```text
Phase 4 production governed rollback verification
```

The rollback was queued by the governed API and executed independently against both targets. Alica converged first, Herman converged second, and the rollback plan reached `succeeded` at `2026-08-11T16:07:11.748Z` with the event:

```text
Governed rollback converged on every target
```

For both targets, rollback convergence checks persisted:

```json
{
  "healthy": true,
  "imageIdentity": true,
  "releaseLabel": true,
  "commitLabel": true
}
```

Final direct production inspection confirmed both containers healthy on the restored image ID `sha256:dbbe8231eda0061f819a9cbd02a9107bcf9c465efee99461421efe037d356ddf`, corresponding to accepted registry digest `sha256:78924999ce02475102343153611516f42e7c196d160d1abdb9df3b114429a3a2`.

## Final production convergence

| Workload | Final state |
|---|---|
| Alica runtime | healthy, restored runtime image |
| Herman runtime | healthy, restored runtime image |
| UNIFY Core | healthy, final Phase 4 image |
| PostgreSQL | healthy |
| Caddy | healthy |
| UNIFY Web | healthy |
| Governed rollout timer | active and enabled |
| Public UI | HTTP 200 |
| Public Core readiness | HTTP 200, release `phase-20.2-b4109c9` |

## Persisted evidence artifacts

| Artifact | SHA-256 |
|---|---|
| `artifacts/phase-4-framework-rollout/canary-checkpoint.json` | `8d7ff5605bca798a6139e9ef6db21eb57119d22743fa680c8c4fd17cea530810` |
| `artifacts/phase-4-framework-rollout/promoted-checkpoint.json` | `215f2eb6a4fdb9d804761b84125215d62ce012e4d0d8f2ab82ea15a5df6ed345` |
| `artifacts/phase-4-framework-rollout/rollback-checkpoint.json` | `314069be8ad6a4db911c2348218a374049746b6aa919d3331422be897c697853` |

These checkpoints contain the exact targets, previous and target image references and digests, dry-run checks, convergence checks, observation records, policy snapshot, promotion identity, rollback reason, and complete event histories returned by production Core.

## Defects found and corrected during live acceptance

Live production verification exposed three paths not exercised by the earlier mocked acceptance:

1. Candidate runtime images required `HERMES_CANDIDATE_ASSESSMENT=true` so the adapter validates the candidate’s immutable release and commit rather than the currently pinned baseline.
2. PostgreSQL required an explicit `uuid` cast for the promotion actor inside polymorphic `jsonb_build_object`.
3. PostgreSQL required explicit `uuid`/`text` casts for rollback audit details inside polymorphic `jsonb_build_object`.

The initial unhealthy candidate attempt restored Alica’s prior image automatically. The corrected candidate, promotion, and rollback then passed live production acceptance.

## Final acceptance

```json
{
  "converged": true,
  "rollbackVerified": true,
  "observationWindowVerified": true,
  "manualPromotionVerified": true,
  "oneClickGovernedRollbackVerified": true,
  "completeEvidencePersisted": true
}
```

Phase 4 is complete. Production is converged on the restored pre-candidate Hermes runtime, the final managed Core release is healthy, platform rollback remains available, and the governed rollout evidence is persisted both in production PostgreSQL and in immutable repository artifacts.
