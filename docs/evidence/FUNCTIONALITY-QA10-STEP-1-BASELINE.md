# Functionality QA10 — Step 1 Baseline

- Date: `2026-08-09T12:30:17Z`
- Branch: `feature/unify-functionality-qa10`
- Baseline revision: `5701c529e106e844fc3acd0a984774f23d5f3baf`

## Purpose

This evidence establishes the pre-implementation baseline for the Alica-V1 two-framework UNIUI functionality programme. Step 1 changes no production configuration and performs no production mutation.

## Authoritative production topology

| Framework ID | Name | Registered state | Base profile | Provider selection | Model selection |
|---|---|---|---|---|---|
| `hermes-alica` | Alica | enabled / verified | `default` / Default | none | none |
| `hermes-herman` | Herman | enabled / verified | `default` / Default | none | none |

Both profiles are running and currently report `anthropic/claude-opus-4.6`, while provider inventory reports no selected provider and model inventory reports no selected model. This is an incomplete governed configuration, not an accepted model choice.

## Automated source baseline

A dedicated executable red baseline was added at:

```text
apps/uniui/src/FunctionalityQA10.baseline.test.ts
```

Vitest result:

```text
Test Files  1 passed (1)
Tests       4 expected fail (4)
```

The four expected failures record these known gaps:

1. production UI routes still contain the retired `hermes-main` framework ID;
2. framework base agents are still represented as Default and no governed `profile.rename` operation exists;
3. Work and Chat do not require an explicit selected framework for isolated reads and writes;
4. Models & Providers does not render an explicit incomplete state when neither a provider nor model is selected.

`it.fails` is deliberate. Each requirement executes and proves the current defect. When implementation makes a requirement pass, Vitest will report an unexpected pass until the marker is removed and the case is promoted to a permanent normal regression test.

## Real-browser production baseline

Authenticated Chromium completed navigation across all UNIUI sections.

Working without page exceptions:

- Frameworks
- Models & Providers
- Profiles
- Memory & knowledge
- Audit
- Operations
- Notifications
- Settings

Known framework-routing failures:

```text
Work & Kanban: Framework not found
Chat: Framework not found
```

The failed production requests targeted `hermes-main`, which is not registered. Production has only `hermes-alica` and `hermes-herman`.

The initial unauthenticated `/auth/me` response is expected before named-user login and is not classified as a defect.

## Production QA10 baseline

The deployed production acceptance script completed successfully:

```text
qa10_run=passed
```

It verified health, capabilities, profiles, providers, Work, conversations, events, concurrency and audit through direct framework-scoped API requests for both `hermes-alica` and `hermes-herman`.

This distinction is important: the governed backend routes pass while the current Work and Chat browser views fail because those views target the wrong framework ID.

## Full repository QA baseline

The complete repository quality suite passed after adding the executable baseline:

```text
pnpm qa = PASS
UNIUI: 35 passed, 4 expected fail
Python integration tests: 4 passed
lint/typecheck/build/contracts/standalone/retention/capacity/canary/format = PASS
```

## Baseline decision

**Step 1 baseline established.**

The production backend remains healthy. The next implementation step must create one authoritative shared framework context and eliminate UI-level `hermes-main` routing without changing provider or model selections.
