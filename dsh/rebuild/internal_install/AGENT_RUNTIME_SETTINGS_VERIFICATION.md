# Per-profile models, fallbacks, tools and skills

## Delivered scope

Agents → Edit now exposes the selected profile's native runtime settings:

- Primary provider/model from Hermes's profile-scoped model picker inventory. No invented model IDs or credential copying.
- Ordered fallback routes with add/remove/reorder. Existing advanced route fields remain server-side and are preserved through opaque references. Native primary-model assignment semantics clear inappropriate model-specific endpoint/credential overrides when switching providers; provider credential stores are not edited.
- Configurable native toolsets, their configuration platform, prerequisite status, and resolved tool names. Native tool configuration helpers preserve unrelated platform settings and MCP entries, including `no_mcp`.
- Installed skills discovered by the native loader. Toggles change the profile's native global disabled list; platform restrictions and unknown/uninstalled disabled entries remain intact. This does not install/delete skills or edit skill content.

Create an agent first, then Edit it: inventory is obtained from a real profile, not guessed from the default profile. Missing runtime inventory fails closed without replacing settings. Save is configuration-only; it does not start agents, make completion requests, or restart sessions. Existing sessions/explicit session overrides may retain their own settings.

## Authority and write protection

The adapter uses the installed, pinned Hermes helpers: model picker context and catalog, native primary-model assignment, fallback-chain normalization, native configurable toolset discovery/platform resolution/save semantics, and native skill discovery/disabled-list semantics. No Hermes Python source was modified.

`config.yaml` participates in the configuration revision and private before-write backup. Each runtime edit invalidates UI approval. Fresh dry-run and execute revalidate the real inventory. Unknown models/toolsets/skills and duplicate fallback routes are rejected. Native config co-editing triggers a conflict rather than stale replacement. Unchanged identity/instruction/memory bytes and missing files are preserved; unrelated configuration keys remain intact.

## Verification

- 99 adapter tests, 253 gateway tests, 34 combined Agent/Work UI tests passed; production build passed.
- Disposable development profile exposed 10 native model choices, 28 configurable toolsets and 67 loader-visible skills. These are observed profile-specific counts, not hard-coded limits.
- Browser model selection, fallback ordering, tool and skill toggles, save/reopen passed.
- Native loaders confirmed primary model, fallback order, toolset resolution and skill discovery.
- Dry-run did not change config. Native config edit between review/save caused HTTP 409 and preserved the runtime draft. Reload/merge/save retained the native addition.
- Changed runtime settings invalidated approval. Unknown model, toolset, skill and duplicate fallback submissions returned HTTP 400 without changing revision. Anonymous read returned HTTP 401. No JavaScript errors.
- Disposable QA removed. Existing owner config, profile metadata, instructions, memory, `.env` and `auth.json` bytes/absence were unchanged. Seven development services healthy; DSH2 untouched.
- All tested gateway/adapter/UI build files matched deployment; SHA256 reference inventories retained privately before removing unused compiler cache. Runtime images and rollback archives retained.

Machine-readable browser evidence: `agent-runtime-browser-proof.json`.
Development bundle: `/var/lib/alica-dsh-internal/dev3-agent-runtime-settings-1/bundle`.
Deployment pin: `d78fed98eaa04b5aeffe499135331cba782e2d9a8529c1fcce2a7ca38db61bfb`.

## Operational closure

The installer capacity gate now passes with its unchanged 8 GiB minimum-free-disk guard. Final closure observed 12.02 GiB free and installer plan state `installed`. Cleanup removed 11 failed, unmounted development compiler containers and 152 unused compiler-image records (including intermediate records), reclaiming 4,547,833,856 bytes. Candidates were restricted to small `/workspace` compiler images with pnpm/Aquiero build history, no image volumes or repository digests, and no tags except the two historical development build tags. Removal used no force; running container identities, images and start times were verified unchanged. Runtime images, volumes, owner files and release/rollback archives were preserved.

Final closure again verified all seven development services healthy, disposable QA absent, protected owner file hashes/absences unchanged, and every tested gateway/adapter/UI build file matching deployment. Previously reclaimed zero-filled archive extents had SHA256, size, inode and hardlink count verified unchanged; no archive content was discarded.

Provider expiry/reauthorization, actual model-backed failover and broader lifecycle/day-scale release qualification are not established by this configuration test. Release freeze remains withheld.
