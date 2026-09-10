# DSH bounded capacity and retention

Scope: DSH development/QA only. No authority over active tenants, other Hermes
profiles, shared images/volumes, Docker daemon or host reboot.

## Limits and admission

- At most **one running DSH QA cell**. Stop completed cells via their pinned
  installer `stop` command and separately stop their labelled reference app.
- Retain qualified Stage1 current lock/archive, Stage2-v7, Stage3-QA4 and
  Stage4-QA4 packages, source, evidence, secrets, stopped containers and volumes.
- Before creating the next QA cell run `python3 capacity_guard.py --admission`
  on the target. It requires **12 GiB disk available, 3 GiB RAM available, zero
  running DSH QA cells**, and no superseded Stage1 archives. This is a separate
  preflight command, not yet wired into every historical installer/build entrypoint.
  A pass is NOT authorization for shared-host disruption and is NOT a guarantee
  that a particular VM/build fits; account for its peak demand separately.
- Read-only monitoring flags **disk below 8 GiB**, **available RAM below 1.5 GiB**,
  multiple running DSH QA cells and reaccumulated superseded Stage1 archives.
- Monitor failure is reported, never treated as a healthy host. No automatic
  pruning, process killing, QA stopping, daemon restart or reboot is performed.

## Retention / cleanup procedure

1. Preserve a protected-container snapshot (IDs, image, start time, restart count,
   running state and mounts). Normalize mount order when comparing Docker output.
2. Close native work first. Lifecycle-stop the completed QA cell. Keep data and
   evidence; qualification does not require indefinitely running the installation.
3. Candidate archives must be outside the current release/lock, have verified
   content hashes, no active file descriptors and no additional hard links.
   Record hashes, sizes and reasons before removal. Rehash the retained archive.
4. Do not delete release directories wholesale. Do not prune shared Docker
   images/builders/caches/volumes indiscriminately. Current build cache and older
   stopped cells remain retained pending a separate ownership/pin classification.
5. For each future stage retain one qualified package and one rollback package;
   never auto-delete earlier required release gates. Failed attempts retain small
   source/evidence records; bulky exports require explicit pinning or retirement
   after their reference/ownership audit. No unbounded archive-per-attempt default.
6. Retire abandoned language servers only after confirming a deleted worktree,
   language-server command, no listening endpoint, and PID/start identity. Never
   kill an agent service or process group. Use pidfd-bound TERM, not blind PID kill.
7. Reverify protected resources and retained release file hashes; publish the
   resulting capacity instead of guessing reclaimed memory from summed RSS.

## Installed checks

`check_hosts.py` checks the existing agent host and the designated development
host over the existing SSH identity. Its sibling `capacity_guard.py` is required.
It is silent when both checks pass; findings/access failures produce an alert.
The existing hourly, script-only Hermes storage/backup check invokes this installed
pair after its original checks (including when an original check errors). No second
scheduled job was added; there is no LLM loop, destructive automation or new host allocation.

Unit tests: `python3 -m unittest discover -s dsh/rebuild/operations -p 'test_*.py'`.
