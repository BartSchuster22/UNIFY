# Development project selectors — delivery and verification

## Delivered scope

Work → Add new → Project and existing Project details now select approved workspace paths, a manager profile, and multiple worker profiles from the selected Hermes framework. Task assignment uses the same profile inventory. Inventory refresh and a new-tab Agents link preserve the current draft. Unavailable selections are shown explicitly and block saving; no typed ID/path fallback is substituted.

Workspace is a filesystem execution location, **not a MemoryV4 scope**. The adapter enumerates bounded, writable, non-symlink directories under approved runtime roots (default `$HERMES_HOME/workspace`). Project folders/primary workspace and board default workdir use native Hermes commands. Manager/worker associations are persistent DSH-owned configuration at `$HERMES_HOME/state/unify-project-settings/<project>.json`, explicitly labelled `dsh-hermes-adapter`. This is not a claim that upstream Hermes natively enforces project team membership. Save and Start still explicitly creates the PM planning task; Save alone starts nothing.

Project updates use governed `work.project.configure`, framework-local validation, source-version checks and serialized project mutations. Identity, archived status and setup remain project-owned when combined with board summaries. Initial URL project selection and native worker-array readback are preserved.

## Verification actually performed

- Adapter: **94 tests passed**; gateway: **253 passed**; Work UI: **22 passed**.
- Contracts, adapter and gateway builds, UI TypeScript check and production build passed.
- Real Chromium owner sign-in and live inventories verified.
- Selected the actual runtime workspace, manager, and **two real profile IDs** in the multi-select. Save returned HTTP 201, operation `verified`, native result `completed`.
- Reopened the exact project; changed workspace, manager and workers; Save project setup returned 201. Reload and authoritative API readback agreed with the selections.
- Reused an observed old revision with a new idempotency key: **409**. Unapproved `/etc` workspace and nonexistent/foreign worker: **400** each. Durable project fields were unchanged after rejection.
- Archived-state API/UI readback passed; archived setup Save is disabled. No browser page errors in final verification.
- Native boards contained **zero tasks**. No model-backed task or schedule was started.
- Two explicitly named QA project records and their empty boards were archived. The temporary `qa-selectors-worker` profile and empty QA directory were removed. The default profile's pre-test config/SOUL fingerprints still match.
- All **seven development services healthy**, broker ownership verified. Critical deployed gateway/adapter files and UI entrypoint matched the tested build by SHA-256.

## Live-test repairs included

1. Create/configure exceeded the original 20-second HTTP deadline despite completing natively. Those two operations now have a bounded 120-second allowance; task-run timing is unchanged.
2. Initial framework loading discarded the URL-selected project; the UI also read workers from an obsolete field. Regression coverage now exercises reopen with persisted settings and project-owned naming.
3. Installed Hermes emits `(archived)` in the project detail header, not only `[archived]` in the list. The adapter now recognizes that actual format, with regression coverage.

## Development deployment record

Only development UI, gateway and Hermes **adapter** code changed. Native Hermes Python source, DSH2 and existing agent configuration were not modified. Native project/Kanban backups preceded QA. The initial runtime-identity mismatch rolled back automatically; the corrected guard permits only the expected `HERMES_RUNTIME_IMAGE` environment-pin change when replacing the adapter image. Subsequent updates retained ownership checks and rollback protection.

Final verified development manifest: `ab4e2f446274fff33d5f86d343e2afe63ea8359d323ea744404713094ddef9e3`.
Final bundle: `/var/lib/alica-dsh-internal/dev3-work-selectors-6/bundle`.
Build/runtime layer definitions accompany this document. The build definition depends on the existing internal `alica-session-fix:build` image; it is a development overlay, not a new clean-install release. Live verification and guarded updater scripts are retained in the operator staging directory `/home/deploy/alica-internal-tls/`; local browser evidence is under `/home/herman/alica-internal-tls/` (credentials/session state remain private and are not committed).

This closes **delivery step 1 only**. Rich agent identity/instruction/memory editing, model/fallback/tool/skill management, and broader installation/workload/lifecycle qualification are not declared complete.
