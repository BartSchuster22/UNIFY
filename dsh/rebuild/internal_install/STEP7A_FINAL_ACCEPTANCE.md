# Step 7A — restart continuity and interrupted-execution recovery

**Verdict: PASS for the bounded development-cell scope, 2026-09-15.**

Target: `dsh-dev.aquiero.com`, cell `dsh2-internal-dev3` on ALICA-v1. Tested application base: `93569a4f81b3dfcf3f111babab3b53743e9b0557` (Step 6). No application/runtime patch or image replacement was needed. DSH2 was not accessed or modified.

## Scope and policy

This acceptance exercises the existing, pinned installation's supported `ops.py stop` / `ops.py start` lifecycle twice. It is **not** a host reboot, Docker-daemon failure, power-loss simulation, backup/restore qualification, fresh-install qualification or release freeze.

Native Hermes ordinarily permits retries of crashed tasks. The interrupted test explicitly used native `--max-retries 1` (block on the first recorded failure), `--max-runtime 420`, and a terminal command bounded to a 240-second sleep with a 300-second tool timeout. Its successful safety property is **no automatic second attempt under that explicit policy**, not generic exactly-once execution or rollback of side effects.

## 1. Restart continuity — PASS

Before restart, the disposable project contained:

- A browser-created/promoted task that genuinely executed against the selected workspace, instructions, memory, user memory and enabled skill. Its generated JSON was independently verified against the CSV: **1,195 cents**.
- A separately browser-cancelled task whose worker and two child processes were stopped during a sleep. Its native outcome was `cancelled`, with no completion marker or second run.

The supported lifecycle stopped all seven owned containers, retaining data, then started them and returned runtime health `healthy`. The measured stop/start/verification cycle took **105.85 seconds**; this is harness duration, not a measured user-visible outage SLA.

After restart and a 70-second observation interval, exact before/after comparisons passed for both tasks and run histories, their native session records, the disposable profile's configuration/instruction/memory/skill hashes, workspace hashes and result artifact hash. Both tasks retained one run. Fresh owner authentication succeeded. Browser checks verified retained project/workspace/team bindings, model/memory/tools/skills and visible task/run feedback.

Evidence: `step7a-continuity-{before,after,lifecycle,browser}.json`, corresponding board/agent screenshots, and the actual CSV/JSON artifact files.

## 2. Interrupted execution — PASS

Accepted task: `t_64f83dc6`, created through native CLI in **blocked** state, with the explicit no-retry failure policy, then explicitly promoted through native CLI. The harness tracked its immutable ID.

Before interrupting, the harness verified that the actual terminal command had written the start marker and exactly one attempt line, had not written its finish marker, and was still running:

| Observation | Before stop | After start and recovery | After another 70 seconds |
|---|---|---|---|
| Worker PID | 3328 | absent | absent |
| Matching live processes | 3328, 3467, 3469 | none | none |
| Attempt lines | 1 | 1 | 1 |
| Finish marker | absent | absent | absent |
| Native task/run | running, one attempt | blocked / `crashed`, one attempt | blocked / `crashed`, one attempt |

The second supported stop/start/verification cycle took **105.94 seconds**. Native recovery was already visible at the first successful post-start observation. The current-run pointer and worker PID were cleared. No owner cancellation, direct database status rewrite, forced completion or manual reclaim was used to manufacture this recovery.

The already settled tasks, profile hashes and pre-existing artifact hashes remained unchanged. Fresh owner login and browser-visible task titles, native error/summary feedback and one run per task passed after this restart too.

Evidence: `step7a-interruption-verified-create.json`, `step7a-interruption-promote.json`, `step7a-interruption-{before,after,final,lifecycle,proof,browser}.json`, screenshots and the persisted attempt/start markers.

## Non-passing harness attempts, retained for traceability

- An initial continuity assertion expected native run outcome `done`; native uses task status `done` and run outcome `completed`. Corrected before any lifecycle action.
- The broker identity preflight initially received unordered Docker inspection rows. The broker requires its declared service order. Corrected before any lifecycle action; this was not a deployed identity mismatch.
- Initial interruption task `t_903a737c` was placed in native **triage**, incorrectly treated by the harness as a holding state awaiting a UI promotion button. Native specification refined its title and dispatched it. The original-title locator then failed; the command completed normally before a valid interruption could be made. This task is **not counted as an interruption pass**. Its original create record, final native history and workspace hashes are retained. An obsolete local waiting harness was stopped; that stop is not native-worker cancellation evidence.
- The accepted replacement used initial `blocked` state, explicit native promotion, distinct marker files and immutable-ID tracking. The first task and its completed run were not erased or relabelled.

## Protection and closure

A private owner-file backup and native/unrelated-container baseline were captured before preparation. Restart guards rejected unrelated active work. Both cycles and final closure checked protected owner-file hashes, pre-existing board/task/run records, unrelated container identities/images/start times/running state, installer state and broker identity signatures.

After evidence capture, the disposable project was archived through the browser. All four disposable tasks and the board were recoverably archived through native controls. The disposable profile, copied credentials and workspace were removed. Cleanup required one run per task and no live disposable worker. The final browser check verified that only the owner profile remained, the project was archived, and Work loading/refresh worked without JavaScript errors or the disposable agent. All seven services were healthy, broker/observer active and maintenance cleared.

Private authorization material, browser storage state and owner backup contents are **not** included in the repository.

## Retained evidence and verification

- [Evidence directory](step7a-evidence/): raw native/browser/lifecycle results, actual artifacts, screenshots and SHA-256 manifest.
- [Offline verifier](verify_step7a_evidence.py): checks retained lifecycle, state, artifact and cleanup assertions without contacting a live installation.
- `step7a-evidence/harness/`: final as-run helper sources. These are deliberately cell/QA-scoped acceptance records, not a portable production restart utility. Fresh runs require fresh disposable identities, a new protected baseline and appropriate operator authorization; do not blindly replay against archived identifiers.

Run:

```sh
python3 dsh/rebuild/internal_install/verify_step7a_evidence.py
```

Step 6's application regression results remain the previously executed results; they are not represented as rerun here. Step 7A adds real lifecycle/browser/native acceptance and a separately exercised evidence validator. The lifecycle's own response continues to say `model_setup: not_evaluated` and `production_ready: false`; the independent workload/browser evidence does not turn that into a general production-ready claim.

## Still outside acceptance

Scheduling continuity, provider expiry/reauthorization, owner password recovery, encrypted isolated restore, complete clean-install packaging and day-scale operation remain separate qualification work. See the [installation guidance](README.md) and [Step 6 acceptance](STEP6_FINAL_ACCEPTANCE.md).
