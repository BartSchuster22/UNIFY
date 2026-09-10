# Stage 4 bounded recurring-work contract v1

Status: IMPLEMENTING / NOT YET QUALIFIED. Stage 3 pins remain immutable.

## Ownership and entry points

- Native Hermes Cron owns wake-ups and overlap claims. A trusted, fixed no-agent
  script calls the restricted coordinator; scripts never create more cron jobs.
- Native Kanban owns each workflow card and its checkpoint/event history. Admission
  starts in triage, then a sticky capability block reserves the card for the
  restricted coordinator. General workers must not claim it.
- The reference app issues a revocable, expiring, customer-scoped recurring grant
  under its existing authenticated/CSRF-protected API. It fixes the question and
  operation, max admissions and minimum admission interval. A separate bearer
  capability permits only that grant's admission, observation and cancellation.
- Core still owns each real receipt, native dispatch/reconciliation, signed delivery
  and governed knowledge promotion. The native workflow does not hold Core service
  credentials, run an LLM, maintain a parallel app database, or choose providers/tools.
- Operator/native-owner CLI: `workflow.py create|status|tick|event|cancel`, JSON stdin.
  This bounded stage does not introduce browser workflow management or a new public
  multi-tenant orchestration API. One installation administrative trust domain applies.

## Scheduling, waiting and effects

The supported recurrence is an integer multiple of 60 elapsed seconds, up to a day.
Native Cron supplies one-minute wake-ups. Logical occurrences are anchored UTC slots
in native card state. IANA timezone is explicit for display; absolute start timestamps
must carry an offset. There is no naive local-clock or calendar-cron interpretation.
DST fold instants have distinct UTC keys. Clock regression fails closed.

Missed slots coalesce to the latest due occurrence; there is no catch-up burst.
One active occurrence per workflow, at most eight live workflow cards per native
home, and the existing restricted inference mutex remain enforced. Explicit native
owner events use stable deduplication keys and do not bypass admission limits.

An exclusive kernel lock owns each checkpoint mutation; process loss releases it.
Native SQL compare-and-swap versions fence stale writes. Checkpoint and estimated
budget reservation precede dispatch. App grant/event reservation and a deterministic
application idempotency key repair lost responses, including a crash after submission.
The app's existing durable queue and Core/native receipt retain business-effect
idempotency. Unknown execution is reconciled, never blindly resubmitted as a new job.

Same-scope native workflow dependencies wait without routine approval prompts.
Transport retries use bounded exponential backoff. No-progress timeouts apply to
active/dependency/recovery waits, not a healthy long interval waiting for its due time.
Cancellation stops new admissions and requests existing owner-side cancellation/
erasure. Unsettled outcomes remain explicit exceptions rather than fake success.
Grant revocation stops new admissions; already-admitted requests remain observable
and cancellable by that capability. Account deletion revokes and scrubs grant payloads.

## Limits and learning

Hard run-count and interval limits apply at the app authority. Native estimated-cost
reservations add another admission bound; they are labelled estimates. Provider cost
is null when billing evidence is unavailable, never reported as measured zero.
Each restricted child retains the Stage 3 model iteration/token, runtime, source,
output and zero-tool bounds. General tool execution and arbitrary external business
side effects are outside this contract.

Repeated answer/research/refresh uses the qualified Core/Memory governance path.
Models cannot edit workflow policy, capabilities, schedule, platform configuration,
security or code. Promotion remains validated-evidence/candidate-only at the native
boundary; Core/Memory own canonical decisions. Semantic corrections quarantine.

## Acceptance required before closure

1. Native SDK and app tests: ownership, replay/drift, lost-response repair, cancellation,
   dependency wait/denial, budgets, expiry/revocation, timezone/DST, missed-run coalescing,
   overlap and no-progress outcomes. Mocked transports must be labelled as such.
2. Fresh isolated packaged installation and real native Cron/app/Core/Memory flow.
3. At least three successful real recurring outcomes across at least six minutes
   of measured wall/monotonic elapsed time; no advancing clocks or editing outcomes.
   Demonstrate restart/checkpoint recovery and inspect authoritative native/app data
   for duplicate effects. Supplemental fault/clock tests do not impersonate this run.
4. Verify real governed knowledge reuse and admission/cancellation boundaries;
   preserve existing workloads, remove borrowed QA inference credentials and retain
   sanitized evidence. Secret audit, source/image consistency, commits/pushes and
   PROJECT-ALICA closure follow only after these gates pass.

This is a short bounded recurring acceptance, not a day/week endurance or Stage 7
production approval. Physical/WAL/backups/replicas/export erasure remains outside the
logical owner-store lifecycle claim. Later operations and backup stages remain separate.

## Native references

Current Hermes documentation: https://hermes-agent.nousresearch.com/docs/user-guide/features/cron/
Pinned installed implementation inspected: `cron/jobs.py`, `cron/scheduler.py`,
`hermes_cli/kanban_db.py`, native project APIs, and Stage 3 restricted worker.
The upstream scheduler constrains scripts to native `scripts/`, sanitizes subprocess
secrets and owns its job claims. No source/configuration in another live profile is
modified by this implementation.
