# Functionality QA10 — Step 5 Profiles Management UI

- Date: `2026-08-09T15:41:08Z`
- Branch: `feature/unify-functionality-qa10`
- Step 3–4 base revision: `fe5226127acc83842f839dd419c755c586bef2d6`

## Scope completed

UNIUI Profiles now exposes the governed Hermes `profile.rename` operation implemented in Step 4 for supported named profiles.

### Authority and isolation

- Profiles continues to use the authenticated shared `FrameworkContext`.
- Inventory, capabilities, dry-runs, executions, and refreshes target the exact selected framework.
- Mutation targets contain `owner=hermes`, `kind=profile`, the native source ID, and the selected framework ID.
- No Agency or local fallback writer exists.
- Request generations prevent late inventory responses from an old framework replacing the current framework state.
- Pagination results and mutation responses are discarded after a framework switch.
- Opening work is reset when the selected framework changes.

### Role and capability gates

Rename controls require both:

1. the authenticated `profiles.manage` permission; and
2. Hermes capability `profiles.execute=supported`.

The application shell now passes the real named-user permission instead of hard-coding Profiles to read-only. Unsupported, unavailable, forbidden, and role-read-only states remain explicit.

### Rename workflow

For supported named profiles the UI provides:

1. a per-profile **Rename** action;
2. strict local Hermes profile-ID validation;
3. exact framework, source ID, and ownership evidence;
4. an explicit impact acknowledgement;
5. a governed **Validate and dry-run** request;
6. execution disabled until the matching dry-run verifies;
7. an optimistic `expectedSourceVersion` pinned from authoritative profile truth;
8. a governed execute request;
9. success only when the returned operation state is `verified`;
10. authoritative inventory refresh after success;
11. explicit replay messaging when Hermes reports the rename was already completed.

Changing the destination invalidates the prior dry-run and creates new idempotency keys.

### Retry semantics

Dry-run and execute use separate idempotency keys. A failed Gateway operation is immutable, so an uncertain execute retry creates a new governed operation rather than falsely treating a failed operation replay as success. Step 4's native source/destination verification makes that retry safe: source absent plus destination present is a successful native replay. The UI rejects any returned operation whose state is not `verified`.

### Built-in default profile

Current Hermes explicitly rejects renaming its built-in `default` profile. The UI therefore:

- disables Rename for `default`;
- explains the native Hermes limitation;
- does not emulate the operation with filesystem moves or cloning.

Named profiles remain fully manageable. Production `default → alica` and `default → herman` migrations remain blocked on a supported Hermes built-in-default migration contract.

## Regression coverage

Tests prove:

- exact Herman framework targeting with Alica present in the same registry;
- no mutation request is sent to Alica;
- exact source version and native profile target in the dry-run body;
- explicit confirmation;
- execute remains disabled until dry-run succeeds;
- destination conflict fails closed;
- uncertain execution can retry through a new governed operation and surface safe replay;
- dry-run and execute idempotency keys are distinct;
- read-only roles cannot rename;
- `profiles.manage` from the application shell enables supported named-profile actions;
- the built-in default remains visibly unsupported;
- hard Hermes outages do not expose stale fallback data;
- opaque Hermes pagination remains intact.

## Verification

Final repository gate:

```text
pnpm qa = PASS
```

This passed workspace linting, typechecking, all package tests, production builds, reproducible contract checks, standalone-runtime checks, backup-retention self-test, identity-capacity self-test, production-canary self-test, and formatting.

Focused results included:

```text
UNIUI typecheck = PASS
UNIUI tests = 48 passed, 2 expected fail
```

## Production impact

No production deployment or production profile mutation was performed during Step 5.
