# Hermes Source-of-Truth Task 9 Canary Evidence

Date: 2026-07-22
Status: **stable window active — not yet eligible for completion**

## Acceptance policy

The binding rebuild plan requires:

- one Hermes capability family canaried at a time;
- monitoring for errors, latency, replay gaps, drift, and duplication;
- rollback rehearsal before and during canary;
- zero production UNIFY calls to legacy APIs for accepted domains;
- at least 14 stable days per domain unless a separately approved stricter policy exists.

No shorter policy has been approved. This report therefore does not claim that elapsed time has passed when it has not.

Tracked policy: `config/production-canary-policy.json`

- interval: 15 minutes;
- stable duration: 14 uninterrupted days;
- error rate: 0;
- replay gaps: 0;
- duplicate event IDs: 0;
- external-session leaks: 0;
- legacy runtime calls: 0;
- normal probe latency ceiling: 5,000 ms;
- public health latency ceiling: 2,000 ms;
- pinned Hermes commit: `9e54eee44f1cbbe62247a36546e51ff8940373c6`.

## Accepted capability families

| Family | Activation evidence | Initial result |
|---|---|---:|
| `profiles.read` | `HERMES-SOT-PHASES-4-5-REPORT.md` | Pass |
| `providers.read` | `HERMES-SOT-PHASES-4-5-REPORT.md` | Pass |
| `work.read` | `HERMES-SOT-PHASE-6-REPORT.md` | Pass |
| `work.execute` | `HERMES-SOT-PHASE-6-REPORT.md` | Pass |
| `conversations.read` | `HERMES-SOT-TASK-8-REPORT.md` | Pass |
| `conversations.execute` | `HERMES-SOT-TASK-8-REPORT.md` | Pass |

Unsupported boundaries are also canaried on every run:

- `profiles.execute` → `NO_IDEMPOTENT_NONINTERACTIVE_INTERFACE`;
- `providers.credentials.execute` → `NO_IDEMPOTENT_NONINTERACTIVE_INTERFACE`;
- `conversations.delivery.execute` → `SECOND_CONSUMER_FORBIDDEN`.

## Canary implementation

Artifacts:

- `scripts/production-canary.mjs`;
- `deploy/unify-production-canary.service`;
- `deploy/unify-production-canary.timer`;
- `/var/lib/unify-production-canary/state.json`;
- `/var/lib/unify-production-canary/observations.jsonl`.

The service uses a systemd credential, authenticates through the public UNIFY boundary, performs capability probes serially, logs out, and persists sanitized observations. The state file is updated atomically. Any capability failure resets only that capability's stable-window start.

The timer is enabled and runs every 15 minutes. The service has filesystem, privilege, kernel, and control-group hardening and cannot write outside its state directory.

## Initial production canary

Stable window start: `2026-07-22T13:02:12.105Z`

A post-rehearsal production run returned:

```json
{
  "passed": true,
  "probes": 41,
  "passedProbes": 41,
  "failedProbes": 0,
  "errorRate": 0,
  "maxLatencyMs": 840,
  "p95LatencyMs": 618,
  "logoutStatus": 204
}
```

The run verified:

- public readiness and authenticated framework health;
- exact Hermes framework ID and pinned commit;
- supported and intentionally unsupported capabilities;
- profile and provider inventory;
- project, board, and cron inventory;
- internal session and message history;
- external-session exclusion;
- durable work and conversation events;
- zero replay-gap event markers;
- zero duplicate event IDs;
- active Work and Chat acceptance references;
- migration-only legacy readers disabled in the deployed Gateway configuration.

The live release remained `unify-task8-internal-conversations` and readiness remained HTTP `200` after rehearsal and restoration.

## Rollback rehearsal

Rollback was rehearsed independently for each accepted execute family before resetting the stable-window clock.

| Family | Read during rollback | Execute during rollback | Result |
|---|---:|---:|---|
| `work.execute` | HTTP `200` | HTTP `403` / `MUTATION_DOMAIN_DISABLED` | Pass |
| `conversations.execute` | HTTP `200` | HTTP `403` / `MUTATION_DOMAIN_DISABLED` | Pass |

Each rehearsal removed only the affected native mutation domain through a temporary Compose override, recreated Gateway, verified read continuity and execute containment, then restored the tracked production configuration. Neither rehearsal mutated Hermes, restored a legacy writer, or enabled an external-channel consumer.

## Repository QA

After the canary tooling, policy, service, timer, and runbook were added, full `pnpm qa` passed. This included lint, workspace and Hermes source-of-truth guards, typechecks, 142 automated tests across tested packages, production builds, generated-contract reproducibility, legacy-route checks, the canary state-machine self-test, and formatting.

## Stable-window status

Required completion instant, assuming no reset:

`2026-08-05T13:02:12.105Z`

Current status at report creation:

- all six families passing;
- zero stable-window failures after the final reset;
- timer active;
- overall `complete=false`, correctly, because 14 days have not elapsed.

Task 9 may be marked complete only after the retained state reports every family `complete=true`, the observation history contains no post-reset failures, production readiness remains healthy, final QA passes, and this report is finalized.
