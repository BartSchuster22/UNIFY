# Step 7B — bounded scheduling acceptance

**PASS on development, 2026-09-15**, for the scope below. This is not a blanket acceptance of every cron/recovery mode.

Target: `dsh-dev.aquiero.com`, ALICA-v1 cell `dsh2-internal-dev3`. DSH2 was not modified.

## Exercised behavior

| Check | Real result |
|---|---|
| Browser creation and pause | Governed native mutations verified; one disposable job, local delivery. |
| Script-only binding | Supported native CLI; relative script under `/opt/data/scripts/`, disposable workspace, `no_agent=true`, repeat limit one. No owner-agent/model execution. |
| Paused restart | Supported full-cell stop/start; all seven services returned healthy. Native paused definition remained identical and no invocation occurred, including the subsequent 70-second observation. |
| Active-pending restart | Rescheduled to three minutes, resumed through the browser, verified enabled with zero attempts, then performed a second supported full-cell stop/start. |
| Automatic execution | Scheduler invoked the script once after the restarted Hermes container's actual start time. No manual `run`/`tick` was used. |
| Native completion | `state=completed`, `last_status=ok`, disabled, no next run, repeat completed once. Native execution history and local output retained in evidence. |
| Duplicate protection | One append-only invocation witness; unchanged native completed record and witness after more than 70 additional seconds. |
| Fresh access | Fresh owner login after both restarts and again for final UI verification. |
| Cleanup | Browser removal verified; native job inventory empty again; disposable workspace and script removed. |
| Protection | Owner files, existing boards/runs and unrelated containers unchanged; seven healthy services, broker identity verified, maintenance cleared, broker/observer active. |

The paused job's cached `next_run_at` remained its previous value while paused, even after native schedule editing. Resume recomputed the future deadline from the edited schedule. The retained native records show this behavior; the harness does not invent a different next-run value.

## Defect found, implemented and deployed

A real completed job was incorrectly counted and included in **Active**, despite the native record and displayed status both being completed. The old predicate meant “not paused and not failed.”

`WorkView.tsx` now positively identifies `active`, `scheduled` and `running` states. The shared predicate is used by the overview count, Cronjobs count and Active filter. Terminal/unknown states remain available in All without being advertised as active.

Added a regression covering active, scheduled, running, completed, disabled and unknown states. Verified the deployed fix against the **same real completed job**, before its removal:

- All **1**, Active **0**;
- completed job absent under Active and present under All;
- overview **0 active**;
- correct counts after reload.

Only the UniUI container/image changed during the fix deployment. The other six cell containers and unrelated containers retained their identities. The existing guarded, rollback-capable engineering updater verified a single permitted public-assets layer, unchanged runtime configuration/mounts and broker identity.

- UI image: `sha256:71d742c1e536641821bf0c6404a5912ae94fc5385e0a72ac07aef55b8112cd63`
- Current bundle: `/var/lib/alica-dsh-internal/dev3-step7b-ui/bundle`
- Current manifest SHA-256: `8e78bf1a13ba4d9c874bcb20cc903cf04c6ba7dbfc8f30e9910fcc49d47bdce0`

## Validation and retained evidence

- WorkView tests: **25 passed**; typecheck and production build passed.
- Full UniUI suite: **15 files passed; 118 tests passed, one existing expected-failure test**.
- The full-suite first run exposed a stale legacy-login assertion. Its fixture rejects identity discovery with HTTP 401, so its test now checks the existing accessible fail-closed DSH sign-in state and absence of password fallback. No login implementation was changed. Real owner OIDC access was independently exercised in the browser.
- Step 7A and Step 7B offline evidence verifiers passed.

```sh
python3 dsh/rebuild/internal_install/verify_step7a_evidence.py
python3 dsh/rebuild/internal_install/verify_step7b_evidence.py
```

`step7b-evidence/` contains native records, lifecycle receipts, browser mutation receipts, before/after UI proof, screenshots, output, regression log, as-run helper sources and a SHA-256 manifest. Private login state, passwords, auth files and private keys are not included. Harness files are deployment-specific historical evidence, not a generic installer or permission to replay destructive actions on another cell.

## Non-passing attempts and harness corrections

- Initial browser locators targeted a hidden segmented-control input and exact required-label text. Corrected against the live DOM before job creation.
- Native CLI rejected an absolute script path but returned exit code zero. A postcondition caught the unchanged binding. The job stayed paused and did not run. The rejected result is retained; the corrected binding uses a relative script shim and verifies native state.
- Python 3.10 rejected Docker's nanosecond timestamp string after the scheduled job had completed. Normalizing fractional precision allowed comparison with the genuine invocation timestamp; no second job/run was created.
- BuildKit treated a local image ID as a registry reference. Building from the already-installed image with `DOCKER_BUILDKIT=0` succeeded; the guarded updater independently verified the resulting layer/configuration.
- Final protection initially referenced the old manifest pin after the UI update. Corrected to the verified update receipt's pin and reran protection successfully; no rollback or extra restart was needed.

## Still outside this checkpoint

Recurring cadence, timezone/DST behavior, model-backed cron, in-flight cron crash recovery, provider reauthorization, password recovery and isolated backup restore are not claimed as tested here. This is not a universal exactly-once guarantee or a full-host/power-loss test.
