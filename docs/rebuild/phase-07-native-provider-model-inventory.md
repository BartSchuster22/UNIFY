# Phase 07 — Hermes-native provider and model inventory

## Scope and source of truth

UNIFY Core owns the durable, queryable control-plane state for provider/model selection, routing policy, validation evidence, and reconciliation history. Hermes remains the authoritative source for provider and model discovery. The Core tables are provenance-carrying projections and policy state; they are not an independent provider catalog and they must not be populated from a retired DMM service.

The implementation consists of:

- migration `009_native_provider_model_inventory.sql`;
- `NativeModelService` in `apps/core/src/models/service.ts`;
- Hermes provider/model inventory contracts and adapter methods;
- strict Core v1 inventory, routing, resolution, validation, and reconciliation schemas;
- immutable catalog snapshots and operational evidence.

## Preconditions

1. Back up the Core PostgreSQL database and verify the backup before migration.
2. Verify migrations 001–008 are applied with their recorded checksums.
3. Verify every registered framework intended for reconciliation reports the pinned Hermes control contract and provider/model capabilities.
4. Verify framework credential references resolve. Never put credential values in provider metadata, logs, snapshots, or reconciliation evidence.
5. Keep model-management mutations disabled until migration, reconciliation, and route-resolution checks pass.

## Migration and rollout

1. Deploy code containing migration 009 while writes remain contained.
2. Run `pnpm --filter @unify/core db:migrate` against the target Core database.
3. Run `pnpm --filter @unify/core db:verify` and confirm migration 009 is recorded.
4. Reconcile one non-critical framework first. Confirm:
   - one immutable catalog snapshot is written;
   - provider/model rows carry framework ID, native reference, source version, and observation time;
   - exactly one selected default exists per framework when Hermes declares one;
   - missing credentials make a provider unavailable and its models non-selectable;
   - profiles for that framework receive an ordered routing policy without silently dropping unavailable fallbacks.
5. Validate a configured provider. The result must create immutable `provider_validation_evidence`; no secret may be returned.
6. Resolve routes for representative capability requirements and inspect every rejection reason.
7. Reconcile the remaining frameworks, then enable model-management operations only after acceptance evidence is recorded.

## Reconciliation behavior

- Reconciliation reads Hermes-native provider and model documents from the registered framework gateway.
- Source versions and observation timestamps are persisted on every catalog snapshot and projected row.
- Rows absent from the latest Hermes observation are retained for evidence and foreign-key safety, but become `unavailable` and non-selectable.
- Selected defaults are updated transactionally before the new selection is applied, preserving partial uniqueness constraints.
- Routing drift is reported when a policy candidate is disabled, unavailable, not selectable, attached to an unavailable provider, or lacks a usable credential.
- Reconciliation evidence and snapshots are immutable. Never repair them in place; correct the source or policy and run another reconciliation.

## Monitoring and alerts

Monitor at least:

| Signal | Alert condition |
|---|---|
| Latest catalog snapshot age | exceeds the agreed reconciliation interval plus grace period |
| Reconciliation status | `failed`, or repeated `drifted` after the rollout window |
| Provider credential state | selected provider is not `configured` or `not-required` |
| Provider/model observation state | selected model or provider is not `available` |
| Route resolution | no selectable candidate, required-candidate rejection, or rising capability mismatches |
| Policy writes | version-conflict rate above normal operator concurrency |
| Evidence integrity | immutable trigger missing, evidence insert failure, or migration checksum mismatch |

Safe logs may contain canonical IDs, source versions, safe error codes, and rejection reason codes. They must not contain provider credentials, framework bearer tokens, authorization headers, or raw secret references beyond approved opaque reference identifiers.

## Rollback

Migration 009 is intentionally forward-only because it adds policy/evidence state and immutable records.

1. Disable model-management operations and stop reconciliation jobs.
2. Roll application traffic back to the last compatible release only if that release can tolerate migration 009's additive columns/tables.
3. Do **not** delete migration 009 tables or rewrite evidence in place.
4. Restore the pre-migration backup only for catastrophic schema failure and only under a full Core outage procedure; this discards post-backup Core writes.
5. If Hermes inventory is wrong, fix Hermes or the framework adapter, restore credential references if needed, and reconcile again. Do not reintroduce DMM as a runtime dependency or source of truth.

## Verification commands

```bash
pnpm --filter @unify/core typecheck
pnpm --filter @unify/core test
pnpm --filter @unify/core check:contracts
pnpm --filter @aquiero/gateway test
pnpm contracts:check
pnpm qa
```

The PostgreSQL model integration test requires a disposable database whose name starts with `unify_core_model_test` and `CORE_MODEL_TEST_DATABASE_URL` pointing to it. The test drops the `core` schema; never target a shared or production database.

## Acceptance evidence

Retain:

- migration and database verification output;
- successful real-PostgreSQL model integration output;
- generated OpenAPI/SDK artifact checks;
- reconciliation IDs and source versions for each framework;
- provider validation evidence IDs;
- route-resolution checks for selected, fallback, unavailable-provider, and capability-mismatch cases;
- the clean full-QA result and synchronized release commit.
