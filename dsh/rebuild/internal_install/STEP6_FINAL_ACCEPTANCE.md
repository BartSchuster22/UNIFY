# Step 6 — final acceptance

**Verdict: PASS on the development installation, 2026-09-15.**

Target: `https://dsh-dev.aquiero.com`, ALICA-v1 development only. DSH2 was not modified. This closes Step 6; it does not claim acceptance of subsequent installation/product steps.

## Acceptance evidence

All final records and screenshots are in [`step6-final-evidence/`](step6-final-evidence/). The earlier failed run remains documented in [`STEP6_BROWSER_ACCEPTANCE.md`](STEP6_BROWSER_ACCEPTANCE.md).

| Requirement | Executed result |
| --- | --- |
| Browser-owned creation and native dispatch | Browser-created project/task, assigned disposable profile `qa-browser-work-6764edb3`, and promoted task `t_d7ae00e8`. Native dispatcher recorded exactly one run. |
| Native project/workspace binding | `workspace_kind=dir`, `workspace_path=/opt/data/workspace/qa-browser-work-6764edb3`, `project_id=p_cce9dfdd`. These are native task fields, not merely copied prompt text. |
| Actual model/tool execution | Native session `20260915_072917_ca94a1`, source `kanban`, model `gpt-5.6-sol`, provider `openai-codex`: seven tool calls and eight API calls. |
| Real artifact and instructions | JSON independently checked against the CSV: **1195 cents**, alpha/beta/gamma rows, and all four expected instruction/memory/user-memory/enabled-skill codes. Disabled skill remained disabled for the file acceptance. |
| Visible native result | Browser expanded the native execution-history disclosure by clicking it. Exact native summary, session ID and artifact paths were visible. They remained available after reload. |
| No duplicate execution | Reloads and refreshes left the file task with one completed run. All four disposable tasks had one run each at cleanup; separate test tasks were not retries of the same dispatch. |
| Read failure/recovery | Injected a failed task read into the test browser only. Error was visible, last-observed cards/results remained visible, mutation controls were unavailable, and refresh recovered after removing the fault. No JavaScript errors. |
| Controlled task failure | Browser-created `t_6fea3b3b` attempted the deliberately missing file and ended blocked with `STEP6-MISSING-INPUT`; exact native error summary was visible. Missing file remained absent. |
| Browser in-flight cancellation | Browser created `t_cba03315` and accepted the destructive confirmation for its exact run ID. A real foreground command had written its start marker and was sleeping. Mutation returned `verified`. Worker PID 8550 and matching child PIDs 8731/8733 were present before cancellation and absent afterward. The finish marker was not written. |
| Native cancellation history/no redispatch | Native run outcome `cancelled`, task `blocked`, worker/current-run pointers cleared. Repeated reads over 40 seconds plus browser reload retained one cancelled run and the exact termination-verified summary. Sticky-block event prevents automatic readiness recomputation. |
| Isolated negative cancellation cases | Real-process test under runtime UID 10000: stale run rejected, validation did not signal, worker/child terminated, unrelated process preserved, replay accepted, and native dispatcher did not redispatch. This test uses a temporary DB, not the development board DB. |
| Cleanup | Project archived through a verified browser mutation. Four tasks archived and board recoverably archived through native CLI. Disposable profile/credentials and workspace removed; no disposable worker remained. |
| Owner/protection | Protected owner config/profile/instructions/memory/credential contents and recorded absences unchanged. Seven services healthy. Owner browser session and Work refresh still worked with only the default profile present. |
| Deployed build identity | Verified tested-file hashes against running containers: core 336 files, adapter 108, UI 3. Installer plan state `installed`. |

The preserved `result.json` is byte-identical to the independently inspected runtime artifact:

`sha256:5c7e6e70445ed8dea33e580db54b973c73aa22ebb2afb7445e92d9bb039f10f4`

## Implementation and deployment

- Project creation/addition uses the native project/workspace flags.
- Task snapshots expose native run outcomes, summaries, session IDs, artifacts and unavailable-detail state; running-task cancellation is distinct from blocking or manual completion.
- UI read refresh is bounded/non-overlapping and fails closed without discarding the last observation.
- Native project/task collection reads use pinned Python APIs rather than per-row CLI startup. A live parallel project/task read measured 1913 ms, versus 11289 ms for the earlier project-only CLI-fanout read. Failures are not hidden by success-shaped fallback data.
- Cancellation validates task/run/claim/board process identity, uses pidfds for signalling, verifies termination, and writes native run outcome plus sticky-block events in one transaction.
- Missing legacy builder image was not replaced with an invented build. Tested local JavaScript outputs were packaged as overlays of the exact existing runtime bases; dependencies, native Hermes and runtime configuration were retained. `package_step6_overlay.py` records build hashes and optional immutable base-image IDs.
- Deployment used the rollback-protected updater and reported `verified`. Current bundle: `/var/lib/alica-dsh-internal/dev3-step6-2/bundle`.
- Release pin: `9fada00ddd15fbaf19638ad532072c15ce336587399fbb31ba2f07f1f06a5382`.
- Adapter image: `sha256:47c317f5f06af9d730e68e4539b30622541135af12bba639d83065f10ee51d90`.
- Core image: `sha256:3a41a231e143445c53ac971ba7ccab7730ecebbf804d49a02fd133e2e756f0e3`.
- UI image: `sha256:e0dfbd47f3a5fc5567994ade5dbfb4761f79c3bd5ee6d6a833eb46019c291a1d`.

## Regression checks

Contracts build; adapter, gateway and UI typechecks; **109 adapter tests**, **253 gateway tests**, and **36 Work/Agents UI tests** passed. UI production build also passed before deployment. `step6-routing.test.ts` includes the pinned native fixture and bulk-read/no-CLI-fanout regression. `verify_step6_cancellation.py` is the isolated native process test; extract `cancellationBridge` from the adapter source into `/tmp/step6-cancellation-bridge.py` in the pinned runtime before running it as the runtime owner.

## Failed attempts retained, not counted as passes

- Earlier CLI-fanout 503s led to the deployed bulk-read repair.
- The first final-browser attempt used an expired session; owner login was refreshed.
- Visibility initially failed because history was collapsed. The harness now clicks the disclosure; it does not alter UI state through injected JavaScript. A subsequent harness locator bug used shifting `nth()` positions while opening multiple disclosures; observing the existing task with a stable first-closed-disclosure loop passed without redispatch.
- The first cancellation probe (`t_90b70a12`) was **not accepted**. The harness inspected `/proc` as container root, which lacked permission to read runtime-owner process environments. Its bounded sleep finished; the native agent correctly blocked the task and explicitly refused to claim cancellation. The corrected harness ran its read-only process probe as UID 10000 and used a separate task and separate marker filenames for the passing cancellation. No production cancellation code change was needed for this harness correction.
- Terminal was disabled during the file acceptance and enabled only on the disposable profile for the bounded cancellation probe. That profile and its credentials were subsequently removed.

No browser acceptance script promoted an existing task a second time. No claim is made that cancellation rolls back prior filesystem or external side effects. Artifact paths in archived native history are historical after disposable-workspace cleanup; the verified artifact is preserved here.
