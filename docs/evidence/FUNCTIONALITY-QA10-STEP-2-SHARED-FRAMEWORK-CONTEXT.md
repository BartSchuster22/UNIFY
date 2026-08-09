# Functionality QA10 — Step 2 Shared Framework Context

- Date: `2026-08-09T13:30:58Z`
- Branch: `feature/unify-functionality-qa10`
- Step 1 revision: `b2b4f69c65b7cbc099eb41e9857a988914a7715c`

## Scope completed

Step 2 introduces one authenticated, URL-backed framework authority for UNIUI and migrates Profiles and Models & Providers to that shared state. Work, Chat and Safety Actions remain intentionally scheduled for Step 3 and retain their Step 1 expected-failure coverage.

## Implementation

`apps/uniui/src/FrameworkContext.tsx` now owns:

- one `/api/v1/frameworks` discovery request for the authenticated shell;
- filtering to enabled and verified frameworks;
- one selected framework ID shared by all consumers;
- URL restoration through the `framework` query parameter;
- automatic first-framework selection only when no framework was requested;
- fail-closed handling for an invalid requested framework;
- rejection of unregistered runtime selections;
- URL updates without dropping unrelated query parameters;
- explicit discovery, loading and selection-error states;
- a governed refresh function for later shell integration.

The context is mounted only after named-user authentication. Login and unauthenticated boot do not perform framework discovery.

## Migrated views

Profiles and Models & Providers now:

- consume the shared framework list and selection;
- stop performing duplicate framework discovery;
- stop independently parsing and writing framework URL state;
- use the shared selection for every read and mutation target;
- display shared discovery or invalid-selection failures;
- disable framework selection while discovery is in progress;
- preserve the selected framework when moving between the two views.

## Test evidence

New context tests verify:

1. discovery occurs once for multiple consumers;
2. disabled and unavailable registrations are excluded;
3. the first real framework is selected when the URL has no framework;
4. a valid Herman URL selection is restored;
5. changing to Alica updates every consumer and the URL;
6. an invalid URL framework fails closed with no selected framework;
7. an unregistered runtime selection is rejected.

A shell integration test starts in Models with `hermes-herman`, navigates to Profiles, and verifies:

- only one framework discovery request;
- Models reads `hermes-herman` providers;
- Profiles reads `hermes-herman` profiles;
- no Alica framework request occurs;
- the URL remains `framework=hermes-herman`.

UNIUI result:

```text
Test Files  10 passed (10)
Tests       40 passed | 4 expected fail (44)
```

The four Step 1 expected failures remain truthful because Step 3 has not yet removed `hermes-main` from Work and Chat, Step 4 has not yet implemented profile rename, and Step 5 has not yet implemented explicit provider/model incomplete-state guidance.

## Full repository QA

```text
pnpm qa = PASS
```

Passed gates include lint, typecheck, all workspace tests, Python integration tests, production builds, contract reproducibility, standalone boundaries, backup retention, identity capacity, canary self-test and formatting.

## Production impact

No production deployment or mutation was performed in Step 2. Provider selection, model selection, framework registration, profile names and MemoryV4 authority remain unchanged.

## Decision

**Step 2 is complete.** The shared framework authority is implemented, tested and ready for Step 3 to migrate Work, Chat and Safety Actions away from `hermes-main`.
