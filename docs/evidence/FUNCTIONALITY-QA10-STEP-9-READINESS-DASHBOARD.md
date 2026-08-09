# Functionality QA10 — Step 9 Readiness Dashboard

- Date: `2026-08-09T19:46:02Z`
- Branch: `feature/unify-functionality-qa10`
- Step 8 base revision: `cb676890f5ad305fae2f328af17715b8ed1a7a74`

## Scope

Step 9 replaces the generic overview with an operator readiness dashboard. The dashboard answers whether the exact URL-selected Hermes framework and its required owner services are ready for governed UNIFY operation without inventing fallback state or collapsing partial failures into a false global success.

## Readiness model

The dashboard evaluates eight explicit areas:

1. Hermes framework runtime health and native checks;
2. selected provider authentication readiness;
3. selected model readiness;
4. running agent-profile gateway readiness;
5. native Hermes Work execution capability;
6. internal Hermes Chat execution capability;
7. MemoryV4 service readiness;
8. current operator read access across dashboard domains.

Each row reports one of:

- **Ready** — the authoritative owner returned the required positive state;
- **Attention** — the current operator cannot evaluate a domain or lacks expected access;
- **Blocked** — the owner responded, but a required selection, runtime, or capability is not ready;
- **Unavailable** — the authoritative probe failed.

Overall readiness is ready only when every checked prerequisite is ready. Any owner outage remains visible as unavailable; blocked capabilities remain blocked rather than being substituted with another framework or local inference.

## Exact framework routing

- The dashboard uses the shared URL-backed framework context.
- Only enabled and verified registrations are selectable.
- Health, capabilities, providers, models, and profiles are fetched from the exact selected framework ID.
- No probe fans out to another registered framework.
- Framework changes and stale asynchronous results are generation-checked before display.
- The selected framework ID is retained in every action link.

## Evidence and freshness

The dashboard displays:

- overall state and ready/attention/blocked/unavailable counts;
- a readiness progress indicator;
- owner-reported finding and evidence for each domain;
- framework commit and source version provenance;
- last completed probe time;
- automatic 30-second rechecks;
- an explicit **Recheck all** control.

Independent probes are isolated. One failed provider request does not erase successful framework, model, profile, capability, or MemoryV4 evidence.

## RBAC and actions

- Provider/model probes run only with `models.read`.
- Profile inventory runs only with `profiles.read`.
- MemoryV4 readiness runs only with `memory.read`.
- A skipped unauthorized probe reports **Attention**, not an owner outage.
- Action links are shown only when the current principal can open the target view.
- Links lead to the relevant Frameworks, Models, Profiles, Work, Chat, Memory, or Settings surface while preserving the exact framework selection.

## Regression coverage

Coverage includes:

- exact URL-selected Herman routing while Alica is also registered;
- zero runtime/inventory probes to non-selected Alica;
- all eight prerequisites ready;
- independent provider-owner failure and truthful overall unavailable state;
- unsupported Work and forbidden Chat capability blockers with native reason codes;
- operator permission gaps;
- manual full recheck behavior;
- permission-aware dashboard integration in the application shell;
- retained responsive-shell accessibility with zero Axe violations;
- existing Memory, Framework, Chat, Models, Providers, and Profiles navigation regressions.

## Verification

Focused checks:

```text
UNIUI typecheck = PASS
Readiness dashboard tests = 4 passed
Readiness + application-shell tests = 14 passed
Affected ESLint checks = PASS
git diff --check = PASS
```

Final repository gate:

```text
pnpm qa = PASS (exit 0)
```

Observed workspace test groups were `3`, `9`, `2`, `88`, `30`, `1`, `2`, and `61` passing tests, with `2` expected failures in the UNIUI suite, plus `4` passing Python tests. The gate also passed workspace linting and boundaries, all TypeScript typechecks, production builds, reproducible contract generation, standalone-runtime verification, backup-retention self-test, identity-capacity self-test, production-canary self-test, and Prettier formatting.

## Operational boundary

The dashboard is read-only. Verification used mocked owner responses and did not change any live framework, provider credential, model, profile, project, task, cronjob, session, message, or MemoryV4 record.
