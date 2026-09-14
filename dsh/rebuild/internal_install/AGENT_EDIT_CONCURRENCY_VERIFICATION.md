# Step 4: browser persistence and concurrent-edit acceptance

## Result

Passed on DSH development against the deployed Step 3 build (`a8a49568`). No application changes or service restarts were needed. Two fresh disposable-profile runs passed; the published evidence is from the rerun of the checked-in, parameterized harness.

- Create dry-run creates no profile. Browser Create → save → reopen preserves identity description, instructions, agent memory and user memory.
- Edit → save → reopen verifies those fields plus the primary model, fallback selection, native toolset toggle and installed-skill toggle. Choices come from that disposable profile's live inventory.
- Native loaders independently read profile description, SOUL.md, both memory stores, primary model, ordered fallback configuration, toolset enablement and skill disabled-list state, initially and after conflict recovery.
- Two open browser editors submit **overlapping execute requests** from the same reviewed revision. Event timestamps assert request overlap. Exactly one gets HTTP 201 and one HTTP 409. The losing draft remains visible, Save is invalidated, and explicit reload/merge/new review/save preserves both intended instruction edits.
- A real Hermes `memory_tool(add)` call holds its native memory-file lock while the browser submits Save. The harness wraps the native lock only to coordinate a stdin barrier; the native memory operation still performs the actual write. After release, the browser gets HTTP 409, its memory draft survives, and the native addition remains saved. Reload/merge/save preserves both additions.
- A native `load_config`/`save_config` edit made after browser review yields HTTP 409 and preserves the browser's model draft. Reload/merge/save retains the unrelated native config addition.
- No JavaScript errors. Each disposable profile is deleted through the native profile deletion helper in `finally`; deletion is asserted.

## Closure

Final live closure checks passed after the checked-in harness run:

- Seven development services healthy.
- Protected owner config, metadata, instructions, memory, `.env` and `auth.json` hashes/absences unchanged.
- Tested-build hashes match all deployed gateway (336), adapter (92) and UI (3) files.
- Installer plan state remains `installed`; no disk guard bypass.
- No runtime image, production/DSH2 configuration, or owner profile edits were made for this verification.

Evidence: `agent-edit-concurrency-proof.json`. The screenshot stays in the private QA output directory.

## Reproduce (development only)

`verify_agent_edit_concurrency.py` is intentionally pinned to `https://dsh-dev.aquiero.com`, framework `hermes-alica`, the development Hermes container, `/opt/data/profiles`, and runtime UID 10000. It creates a unique `qa-edit-concurrency-*` profile and never selects an existing owner profile for editing. Review those assumptions if the development installation changes.

Prerequisites: Python with Playwright and Chromium installed; approved owner login; SSH access with non-interactive sudo for Docker on the development host. Provide these environment variables rather than embedding credentials:

- `DSH_QA_PASSWORD_FILE`: private owner-password file (contents are not printed).
- `DSH_QA_SSH_KEY`: SSH private-key path.
- `DSH_QA_SSH_HOST`: development `user@host`.
- `DSH_QA_OUTPUT_DIR`: private report/screenshot directory.

Run with the Playwright-enabled Python:

```sh
python dsh/rebuild/internal_install/verify_agent_edit_concurrency.py
```

The harness exits nonzero on assertion failure. Success evidence is written only after verification and cleanup; an earlier report in a reused output directory is not evidence of a later failed run. Owner-file/deployment closure checks are installation-specific and were run separately, with their actual results included under `closure` in the published JSON.

## Scope and limits

This establishes the tested browser persistence and concurrency behavior, not model inference or failover. The native memory tool is called directly in the pinned runtime without starting a model-backed agent task. Browser editors are two independent tabs using the same authorized owner session, not two separately authenticated users.

The native config case tests a co-edit completed after review and before Save. It does not establish atomicity against arbitrary writers that ignore the editor's locks or a write forced between the final revision comparison and replacement. The coordinated simultaneous native-write case specifically exercises the shared native memory lock. Existing agent sessions may retain loaded snapshots; read-back uses fresh native loader instances.

Provider expiry/reauthorization, OIDC recovery and lifecycle/day-scale release qualification remain separate. Release freeze is not approved by this step.
