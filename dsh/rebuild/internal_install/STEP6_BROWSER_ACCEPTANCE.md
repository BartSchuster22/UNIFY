# Step 6 — browser dispatch and execution-feedback acceptance

## Verdict: NOT QUALIFIED — implementation gaps found

The development acceptance run exercised two real browser-created Kanban tasks. It did not satisfy all Step 6 criteria. Do not treat this report as a completion/freeze approval. No application code or running service was changed to hide the failures.

## Verified live

Disposable project/profile: `qa-browser-work-0db5b665`.

### Successful workload

The browser created the project, selected its workspace and manager/worker profile, then created and promoted `t_aba997f6` (Step 6 browser file acceptance). The existing native gateway dispatcher — not a manually invoked CLI worker — claimed and spawned it.

Native evidence:

- One created task and exactly one run: `ready → running → done`, outcome `completed`.
- Native session `20260914_215917_654218`, source `kanban`, profile `qa-browser-work-0db5b665`, model `gpt-5.6-sol`, billing provider `openai-codex`, seven API calls and six tool calls.
- The worker read the CSV fixture, loaded the enabled skill, wrote and reread the actual JSON artifact. Native completion metadata contains the summary and artifact path.
- Independent Python recomputation confirms `total_cents = 1195`, expected row order, and all four instruction/memory/skill codes.
- Artifact SHA256: `5c7e6e70445ed8dea33e580db54b973c73aa22ebb2afb7445e92d9bb039f10f4`.
- A later browser reopen showed the same task under Done. Native history still contained one run, not a duplicate.

### Controlled failure

The browser created/promoted `t_bacfcc56` (Step 6 controlled missing input). Its prompt required a real read of an intentionally absent fixture and explicitly prohibited substitution/fabrication.

- Observed native/API status sequence: `ready → running → blocked`.
- Native session `20260914_220712_eab436`, source `kanban`, same selected profile/model/provider, five API calls and four tool calls.
- The missing file was not created. The task was not falsely marked done.
- The browser reopened the board with the failed task present. Native attempt history retains the reason; the card does not render that native reason separately.

## Failed or unqualified criteria

### 1. Selected project workspace does not reach native task creation

Both task records contain `workspace_kind=scratch`, a task-specific scratch path, and `project_id=null`, even though browser/native project setup correctly stores the selected workspace and team.

`HermesNativeSource.createTask` passes board, body, assignee, priority and idempotency key, but not the native workspace/project arguments. Pinned `hermes kanban create --help` confirms the supported `--workspace dir:<path>` and `--project` inputs.

The successful task wrote to the intended persistent directory only because its prompt supplied an absolute path. That must not be credited as correct project-workspace dispatch. Session `cwd` is null; no claim is made about an observed OS cwd beyond the task's native workspace metadata.

### 2. Native results exist but are absent from the browser card

Native `kanban show`/run history contains the real summary, artifact metadata and worker session ID. The legacy task `result` field is null, which does not mean the native run has no result.

The adapter's `tasks()` mapping retains only ID, board, title, status, body, assignee, priority and optional updatedAt. `TaskCard` renders title/assignee/prompt and transition buttons, not native runs, summaries, tool activity, errors or artifacts.

The string `result.json` appears in the browser because it is in the **user prompt**. It is not evidence of a displayed generated result. The retained observation explicitly corrects that possible false positive.

### 3. Refresh/reopen stability did not pass

During the first live browser run, a project read exceeded Playwright's 30-second request timeout. The harness was corrected to use the existing 120-second acceptance budget and resume the exact already-created QA project rather than duplicate it.

After task creation/promotion, the subsequent board load displayed `Hermes framework is unavailable` and zero cards, causing the visibility assertion to fail. A later independent browser reopen recovered and returned all requested collections successfully, displaying the correct done card.

This proves eventual recovery, not reliable refresh during execution. Serial per-project CLI detail reads in `projects()` are a candidate bottleneck; root-cause attribution and repair remain to be tested. WorkView also loads on navigation/manual refresh rather than polling task execution.

### 4. Safe browser cancellation is absent

No Cancel action exists in `TaskCard` or the governed Work task operations inspected. Existing Block must not be relabeled as Cancel:

- Native `block_task` transitions state and clears claim/worker fields without invoking worker termination.
- Native `reclaim_task` does terminate the claimed worker, but returns the task to **ready**, allowing redispatch. A naive reclaim-then-block sequence would introduce a dispatch race.

An in-flight browser cancellation test was therefore withheld rather than intentionally creating an orphaned/requeued worker. Cleanup's absence of active workers is not cancellation acceptance.

## Required implementation before rerunning Step 6

1. Propagate the approved project's native workspace/project binding when creating tasks; validate the mapping through real dispatcher execution.
2. Expose native attempt/session/result/artifact/error evidence through the adapter and governed UI, including bounded progress refresh and stable task identity.
3. Diagnose and repair the intermittent inventory/board-read failure under active execution; retest reload without duplicate dispatch.
4. Implement a run-scoped native stop-and-park/archive contract with process-termination verification and no ready/redispatch race. Keep block/manual completion distinct from execution outcomes.
5. Rerun happy-path, controlled failure, in-flight reload and real cancellation with disposable resources.

These are product/runtime integration changes, not QA-harness adjustments. No partial repair was deployed or claimed in this acceptance report.

## Cleanup and safety

- Verified no active QA worker processes; both native run histories had no worker PID before cleanup.
- Browser archived the disposable project. Native CLI archived its two tasks and its board.
- Removed the disposable agent, private copied QA authorization, sessions/skills and workspace after exporting sanitized evidence.
- ElioHermes protected config/metadata/instructions/memory/credential files and absences unchanged.
- Seven development services healthy; tested deployed files still match; installer plan remains `installed`. DSH2 was not modified.
- Browser observation reported no JavaScript errors; this does not erase the earlier framework-availability failure.

## Evidence

`step6-evidence/` contains browser setup/observation, controlled-failure mutations and status observations, native task/run/session evidence, the actual input/output files, and cleanup/health evidence. No browser cookies, authorization values or passwords are published.

Run `python dsh/rebuild/internal_install/verify_step6_evidence.py` to check retained evidence consistency. It intentionally reports `qualified: false`; it does not rerun live tasks.
