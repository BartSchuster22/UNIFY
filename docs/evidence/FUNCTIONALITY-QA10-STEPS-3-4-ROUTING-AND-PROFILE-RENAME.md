# Functionality QA10 — Steps 3–4 Routing and Native Profile Rename

- Date: `2026-08-09T15:21:42Z`
- Branch: `feature/unify-functionality-qa10`
- Prior Step 2 revision: `c6bc664ecb328fd4b62d4346844e387b83c2bc9a`

## Step 3 — Remove hard-coded framework routing

### Implementation

- Removed the retired `hermes-main` framework from production Work and Chat routes.
- Changed the UNIUI Work API functions to require an explicit framework ID for projects, boards, board tasks, and cronjobs.
- Refactored Work and Chat to consume the authoritative shared `FrameworkContext`.
- Added framework selectors to Work and Chat.
- Scoped Work reads, Work mutations, Chat reads, and Chat mutations to the selected enabled/verified framework.
- Corrected Chat mutation operation IDs to the Hermes control contract:
  - `conversation.session.create`
  - `conversation.message.send`
- Framework IDs are included in Work canonical IDs and governed mutation targets.
- Added request generations and framework-change cleanup so a late response from a prior framework cannot overwrite the current page state.
- Refactored Safety Actions to use the shared framework selection instead of editable or default framework/native IDs.
- Invalid or absent selection blocks scoped reads and mutations and displays the shared controlled selection error.

### Isolation regressions

UNIUI tests prove in the same suite that:

- a Herman URL selection sends every Work read to `hermes-herman` and sends none to Alica;
- a Herman URL selection sends every Chat read to `hermes-herman` and sends none to Alica;
- governed Work mutations receive the selected framework;
- the retired `hermes-main` string is absent from production Work, Chat, and API routing source.

## Step 4 — Native `profile.rename`

### Contract and governance

- Added `profile.rename` to `HermesProfileOperationSchema`.
- Added a Gateway client call to `POST /control/v1/commands/profiles`.
- Added framework-scoped profile management to `HermesGatewayService`.
- Added the governed Gateway mutation `profile.rename` with:
  - exact `owner=hermes`, `kind=profile`, `frameworkId`, and source native ID;
  - `profiles.manage` permission;
  - explicit confirmation;
  - distinct, syntax-validated `payload.newId`;
  - mandatory `payload.expectedSourceVersion`;
  - idempotent operation claiming and replay evidence.
- The expected source version is promoted to the Hermes command precondition and removed from owner payload.

### Native adapter behavior

For named Hermes profiles, execution uses only the supported native CLI contract:

```text
hermes profile rename <sourceId> <newId>
```

The adapter:

1. validates source and destination IDs;
2. reads authoritative profile state;
3. rejects an occupied destination with a controlled `409 conflict`;
4. checks the optimistic source-version precondition;
5. supports `validate` and `dry-run` without mutation;
6. executes the native CLI command only in execute mode;
7. rereads Hermes profiles;
8. requires source absence and destination presence;
9. fails with `502 internal_error` if readback cannot prove the rename;
10. treats source-absent/destination-present as safe native replay;
11. emits the source and destination IDs in governed event evidence.

### Isolated native CLI contract proof

An isolated temporary HOME was used; no production profile was touched.

Observed native command contract:

```text
hermes profile create seed --no-alias --no-skills
hermes profile rename seed alica
```

Observed result:

```text
✓ Renamed seed → alica
isolated_named_profile_rename=passed
```

Filesystem checks proved that the `seed` directory disappeared and `alica` existed.

### Built-in `default` constraint

The isolated runtime also proved that current Hermes explicitly rejects:

```text
hermes profile rename default alica
```

with:

```text
Error: Cannot rename the default profile.
```

This is a native Hermes limitation, not bypassed by UNIFY. The adapter now fails it closed as a controlled conflict rather than using filesystem moves, profile cloning, generic `profile.update`, or fabricated readback. Therefore the governed native rename operation is complete for named profiles, but the requested future production migrations `default → alica` and `default → herman` remain blocked until Hermes itself defines a supported built-in-default migration contract. No production rename was attempted.

## Automated verification

Final repository gate:

```text
pnpm qa = PASS
```

This passed workspace linting, typechecking, all package tests, production builds, reproducible contract generation, standalone-runtime checks, backup-retention self-test, identity-capacity self-test, production-canary self-test, and formatting.

Focused results included:

- Contracts: `9 passed`
- Hermes control adapter: `27 passed`
- Gateway: `85 passed`
- UNIUI: `44 passed, 2 expected fail`
- Workspace typecheck: passed

The two remaining expected failures are the later base-agent/default migration and provider/model incomplete-state UX gates. The Step 3 routing/isolation expected failures were converted to normal passing regressions.

## Production impact

No production deployment, framework mutation, profile mutation, provider selection, model selection, or MemoryV4 mutation was performed in Steps 3–4.
