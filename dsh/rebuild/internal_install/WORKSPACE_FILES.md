# Workspace files — internal maintenance scope

Work & Kanban now offers **Browse / Create workspace · Upload files** alongside the inventory selector. The native Hermes workspace is the source of truth; MemoryV4 is opt-in derived knowledge, not raw working-file storage.

## Behavior

- Browse approved runtime roots, create visible subfolders, explicitly select an inventory-eligible workspace. Deeper subfolders remain upload destinations; they are not silently registered as selectable workspaces.
- The native browser picker selects local source files. The modal displays the server destination separately.
- Upload up to ten distinct filenames sequentially, at most 8 MiB each. Transfer progress is distinguished from server acknowledgement. The browser and adapter compare SHA-256 checksums.
- Exact-version confirmation is required for overwrites. Prior content is retained under private `.dsh-file-versions` storage; concurrent file creation is never blindly replaced. Version restoration is an operator task, not a UI feature in this release.
- No automatic agent execution, archive extraction, or memory ingestion.
- Explicit project-memory import accepts regular UTF-8 text up to 256 KiB. A saved native project must own the chosen workspace. Other formats remain working files; automatic PDF/Office extraction is not implemented.
- Memory records use project/framework scopes, evidence/working classification, author-only write policy, a source reference/checksum, and idempotency. Importing does not promote canonical memory.

## Boundaries

- Browser session, CSRF, `work.read`/`work.manage`, adapter scopes, and audit availability are enforced. Memory import additionally requires `memory.write`.
- File bytes are not written into governance audit entries. The actor, action, outcome and source hash/target metadata are audited.
- Linux directory descriptors and no-follow opens confine operations to approved roots. Traversal, linked file imports/overwrites, hidden paths and reserved directories are refused.
- Directory listings are bounded to 1,000 entries; browsing depth to 32 segments; retained versions to 256 per destination; uploads preserve a 512 MiB free-space floor. These limits are not a per-tenant storage quota.
- This is endpoint confinement, not an OS sandbox against a separate process with the same host privileges.

## Verification before packaging

Gateway and native adapter route tests exercise permissions, CSRF, confirmation and audit denials. Native filesystem tests exercise actual writes, full-size uploads, competing writes, preserved originals, symlink/hardlink/traversal denials and bounded text reads. UI tests exercise selection, creation, upload acknowledgements, overwrite confirmation and separate memory confirmation. The existing production-build Chromium navigation regression also passes.

Live deployment/acceptance is recorded separately; this document alone is not a deployment receipt.
