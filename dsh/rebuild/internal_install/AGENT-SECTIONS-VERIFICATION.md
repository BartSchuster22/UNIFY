# Shared Agent Create/Edit: identity, instructions and memory

## Delivered scope

Agents → Create Agent and Edit share `AgentEditorSections`. Identity comprises the native Agent ID and profile description; existing IDs continue to use the separate governed Rename action. Instructions edit `SOUL.md`; persistent memory edits `memories/MEMORY.md` and `memories/USER.md`. Names/roles/behavior belong in the instructions rather than an invented native configuration field.

This is native profile memory, not conversation history or MemoryV4 Tier-3 scope management. Provider/model/fallback, tools, skills and further Agent sections are separate work. No automatic session restart, agent run, or model request is performed by Save. Existing sessions can retain their frozen memory snapshot; fresh sessions load the updated files.

## Authoritative behavior and safety

- The adapter reads the selected profile's actual files. The installed default/named profile layout was checked against the native Hermes resolver.
- Configuration reads through Core require `profiles.manage`. UI creation requires the explicit `profiles.configuration` capability; unavailable configuration cannot silently become blank editable fields.
- Both forms use the governed dry-run/execute path. Editing an input invalidates approval and rotates idempotency keys. Exact file revision and profile inventory version are sent with updates.
- Revision checks occur with the editor lock and Hermes-compatible native memory file locks held. Competing saves and intervening native memory updates reject stale state rather than overwrite it. Arbitrary external tools that ignore locks are not claimed to be transactionally coordinated.
- Save enforces configured native memory limits, normalizes the native § entry delimiter, rejects invalid IDs/linked files and directories, and confines edits to fixed filenames under the selected profile.
- Private backups precede atomic replacements in `state/dsh-agent-edit-backups/` inside the profile. Previously written fields are restored on a failed write when their content still matches this operation's write. Configuration/model/credential files are not rewritten.
- Errors remain visible inside the dialog; failed saves retain the draft and invalidate approval. Explicit Reload warns before discarding unsaved edits.
- Native Hermes Python and container runtime configuration were preserved. The bridge uses the runtime's existing Python 3 and PyYAML; it passes document content over stdin, not command-line arguments.

## Verification performed

Build and test gates passed:

| Gate | Result |
|---|---|
| Adapter suite | 98 passed |
| Gateway suite | 253 passed |
| Work and Agent UI suites | 33 passed |
| TypeScript and production build | Passed |

The final real-browser pass on `https://dsh-dev.aquiero.com` created a disposable profile through the shared form. Dry-run created no agent. Create, direct configuration read-back, native `load_soul_md()` and native `MemoryStore` loading all verified the saved content. The native checks ran as the actual agent UID, 10000.

While the Edit dialog held a reviewed draft, the native Hermes memory tool added an entry. Save returned 409 and retained the draft. Explicit reload showed the native addition; merge/edit/save and browser reload verified the new content. An over-limit request returned 400 without changing the saved fields/revision. An unauthenticated configuration request returned 401. No JavaScript errors occurred. The machine-readable browser proof accompanies this document.

An initial diagnostic used root and created root-owned files/directories in its disposable profile. Those QA-only permissions were corrected before cleanup; the final complete pass used the actual agent UID. Both disposable profiles were removed using the native CLI. No existing agent was edited, no task/schedule was started, and no model-backed workload was claimed.

Final checks verified all seven development services healthy, broker identity, the existing agent-file hashes against the pre-change private backup, continued absence of previously absent default memory files, and removal of both QA profiles. Deployed Core/adapter files and UI assets matched the tested build. DSH2 was untouched.

## Development deployment record

- Guarded bundle: `/var/lib/alica-dsh-internal/dev3-agent-sections-1/bundle`
- Manifest pin: `5c96d01a4e2386085391e12222b1997b0c1656bfb27ceb30c7d4851146fd4f1d`
- Existing-agent backup: `/var/lib/alica-dsh-internal/agent-sections-backup-1`
- Operator browser evidence and screenshot: `/home/herman/alica-internal-tls/agent-sections-*`
- A retired selector archive was losslessly compressed, SHA-256 checked, with recovery paths recorded; no runtime data was deleted to reclaim disk space.

This closes the requested shared identity/instructions/native-memory sections. It is not a release freeze or broader qualification claim: OIDC recovery, provider expiry/reauthorization, model-backed workload and lifecycle/day-scale acceptance remain separately pending.
