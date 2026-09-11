# Historical checkpoint — superseded by Stage6 acceptance

This is the earlier incomplete checkpoint, retained as history, not the current verdict. See README.md and RUNBOOK.md.

# Stage 6 — backup and release-authentication checkpoints; NOT accepted

## Additional executed checkpoint: QA release authentication

`release_trust.py` now implements detached, domain-separated Ed25519 signatures,
strict JSON/payload parsing, externally provisioned trust with scope separation
and revocation, short validity windows, predecessor allowlisting, caller-supplied
sequence checks, and exhaustive artifact-byte verification before any execution.
Unsafe trust/key parents (including symlinked or group-writable parents) are
rejected. Private signing material is NOT in Git or on DSH2.

The real accepted QA5 release was independently matched against the recorded
release fingerprint and its declared file hashes, then copied to a separate
root-private artifact directory on DSH2. Fifteen real artifacts were signed and
verified under an explicitly QA-only trust root. No release files in the original
installation were changed and no services were started.

Six denial cases were exercised against that real envelope: signature tampering,
revocation, wrong predecessor, sequence replay, QA/production scope mismatch and
expiry. The expiry case uses an explicit test-clock override, not elapsed-time
acceptance. The final verifier was rerun on the actual artifact after hardening.
Thirty release-authentication tests passed on DSH2; the combined local archive
and authentication suite passed 49 tests.

Evidence: `evidence/qa-release-authentication.json`,
`qa-release-envelope.json`, `qa-release-public-trust.json`, and
`release-trust-unit-tests.json`. The QA signature has a one-day validity window;
it is a recorded test result, not a perpetual deployment authorization.

Important boundaries: this is a verification primitive, NOT a transactional
updater. The caller supplies installed sequence/predecessor; durable anti-replay
state and lifecycle integration are not implemented here. A successful signature
does not establish SBOM/provenance completeness, schema compatibility, rollback,
or migration safety. No production signing root was provisioned and no update,
rollback or live restore is claimed. `wholeStage6Accepted` remains false.

`qa_release.py` is a one-run qualification harness. It refuses existing signing
keys; it may reuse only a byte-identical previously staged artifact directory.
The first signing attempt was correctly rejected because the initial key's
ancestor was group-writable. A protected top-level private directory was used
instead; the unused initial key was removed. No permission check was relaxed.

## Earlier verified backup checkpoint

The user authorized reusing DSH2 and storing its backup on ElioHermes1 and
ALICA-v1. A new server is not required for this same-VPS recovery exercise.
No DSH2 reset or live restore has occurred. Original stores remain quiesced.

## Actually executed

- Cold backup of QA3, QA4 and QA5: all 15 owner-labelled Docker volumes,
  installation roots, three release bundles, private QA/application state,
  operations code/units and recovery/QA code.
- Lifecycle and operation locks held for ALL three cells; host-level brokers
  and observers stopped as well as every container. Maintenance remains set.
- age encryption with a separate recovery identity; SHA-256-pinned ciphertext
  and encrypted per-entry manifest. No plaintext export archive on DSH2.
- Both off-host copies decrypted and authenticated; all 9,513 archive entries
  verified, not just the outer file checksum.
- Full extraction on ElioHermes1 and exact file-content/POSIX metadata checks.
- Integrity checks on private copies of 22 restored SQLite databases (including
  their WAL files when present); original extracted databases were not opened
  for writing. Three native task identities/session bindings/statuses match.
- The intentionally disabled native schedule fixture is preserved, including
  its native id and paused state. Native `list_jobs()` adds a presentation-only
  `latest_execution=None`; the persisted-record comparison accounts for this.
- 19 archive regression tests pass, including wrong key/hash, authenticated
  tampering, truncation, duplicate/escaping names, devices, unsafe symlinks,
  hardlink escape, hardlink preservation, sticky-directory preservation,
  setuid-file denial, changed source, and existing destination/output refusal.
- Source inspection found zero extended-attribute-bearing paths in the captured
  sources. This does not qualify arbitrary ACL/xattr-bearing installations.

Evidence is in [evidence/](evidence/). `wholeStage6Accepted` and
`liveRestoreAccepted` remain **false**.

## Custody

Encrypted file: `dsh2-stage6-backup.age` (3,370,554,203 bytes).

SHA-256:
`151c953b147ab74d21e72886095f00af80bddabeda5817862adadd9210558818`

Copies:
- ElioHermes1: `/home/herman/dsh2-backups/dsh2-stage6-backup.age`
- ALICA-v1: `/srv/alica-dsh-development/stage6-backups/dsh2-stage6-backup.age`
- Original ciphertext also remains on DSH2 under
  `/var/lib/alica-stage6-recovery/`.

Recovery identity (never in Git, receipts, or the archive):
- ElioHermes1: `/home/herman/.config/alica-recovery/dsh2.agekey` (0600).
- ALICA-v1: `/var/lib/alica-recovery-keys/dsh2.agekey` (root-only, private parent).

These are separate from backup directories, NOT a claim of cryptographic
protection against root compromise of a host holding both key and ciphertext.
Either off-host server has recovery material if the other is lost. An additional
operator-controlled offline key copy remains recommended.

Use the hash-pinned `recovery-tools-v1` files alongside the off-host copies.
The cold archive contains an earlier reader prototype; do NOT bootstrap recovery
with that embedded prototype. The final reader handles standard tar hardlinks
only to already verified regular-file entries with identical content/metadata.
Its hashes are in `evidence/recovery-tool-hashes.json`.

The extracted plaintext verification tree on ElioHermes1 is root-owned under
`/home/herman/dsh2-backups/restore-verification`, beneath a private parent. It is
not an active installation and must not be exposed or started as one.
Retain both ciphertext copies and recovery material through live restore and
Stage 6 acceptance. No automatic deletion/expiry has been configured.

## Commands

```sh
python3 -m unittest discover -s dsh/rebuild/stage6 -p 'test_*.py'
python3 archive.py verify --archive BACKUP.age --identity PRIVATE_AGE_IDENTITY \
  --sha256 PINNED_CIPHERTEXT_SHA256
# Extraction refuses an existing destination and does not activate services:
python3 archive.py extract --archive BACKUP.age --identity PRIVATE_AGE_IDENTITY \
  --sha256 PINNED_CIPHERTEXT_SHA256 --destination NEW_PRIVATE_DIRECTORY
```

`backup_dsh2.py` is an explicitly scoped QA coordinator, not a general-purpose
production `alicactl backup` implementation. Run only on the existing identified
DSH2 source, with its frozen release checksum and owner records. Never bypass
its ownership/quiescence checks. The archive module by itself does not establish
quiescence; the coordinator does. Failed staging has no `VERIFIED` marker and
must never be activated.

## Findings retained

- Initial coordinator incorrectly assumed owner.request was an object; it is a
  fingerprint. It now uses the actual `Transaction.inspect()` ownership contract.
- Real Caddy/PostgreSQL directories use sticky permissions. Those bits are now
  preserved and tested; privilege-bearing regular-file modes remain rejected.
- Retired QA3/QA4 host observers still wrote SQLite while containers were down.
  Source-change checks rejected that attempt. All included cells are now fenced.
- Initial reader rejected standard hardlinks between shared release image tar
  files. The final reader validates their target/content/metadata and preserves
  the links; malicious targets remain rejected. No failed attempt was counted as
  a verified backup.

## Next gate / limitations

Current source OS was observed as Ubuntu 26.04.1 LTS, Linux amd64.
This is an ALICA installation/data backup, NOT a full OS/block-device image.
Provider account configuration, OS provisioning, SSH bootstrap and unrelated
host configuration are outside this archive.

A provider-level OS reinstall has not been triggered: this session has working
SSH but no configured hcloud CLI, hcloud config or provider-token environment.
Use provider-console rebuild/approved provisioning access for a genuine OS-loss
exercise. Do not replace that claim with an in-place restart or removal of only
one container. Never erase source data before checking the off-host receipts,
key availability and verified extraction.

Still required for complete Stage 6: clean-target live installation restore,
owner/auth/application/native execution and effect-preservation checks, explicit
execution-owner cutover, signed-update trust and compatibility policy, interrupted
update/rollback acceptance, and one exact qualified predecessor migration with
collision/unsupported-state denials. No release signing, production restore,
rollback, migration or whole-Stage-6 acceptance is claimed here.
