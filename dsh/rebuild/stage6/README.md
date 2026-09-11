# Stage 6 — qualified QA recovery, update and migration

**Accepted on 2026-09-11 for the declared Stage5 QA5 scope. Production is not accepted.**

Authoritative verdict: [stage6-acceptance.json](evidence/stage6-acceptance.json). Operational instructions and limitations: [RUNBOOK.md](RUNBOOK.md). The [earlier incomplete checkpoint](HISTORICAL-CHECKPOINT.md) is historical; its false whole-stage flags have not been rewritten.

| Gate | Actual evidence |
|---|---|
| Backup/custody | Two off-host encrypted copies reauthenticated; 9,513 entries per host; separate protected recovery keys and explicit retention/RPO/RTO policy |
| Fresh OS | Actual provider rebuild, pinned SSH/sudo bootstrap, changed boot, absent old installation and empty Docker before restore |
| State restoration | Owner/core secrets, original customers and isolation, native tasks/session bindings and disabled schedule; seven logical databases matched the original archive |
| Delivery | Existing receipt read through backend; original request deduplicated; exact original delivery resent over authenticated TLS without new task/effect or logical database change |
| Trusted materials | QA signatures and anti-replay checks; eight SPDX image SBOMs and a signed 13-artifact observed-materials statement, independently checked against live images |
| Updates/recovery | Committed signed update; real health rejection, process interruption and existing-database schema failure; eight cold code/data paths restored byte-for-byte; final lock-held recovery also passed |
| Migration | Exact QA5 predecessor to canonical host-operations identity/v2; preserve-only identity/delivery-channel/schedule mappings; ten read-only negative cases |
| CLI/UI | Actual owner/anonymous API checks and real browser UI: seven service rows, genuine observer-outage stale/unknown state, restored live observations; no mocks or TLS bypass |

The Stage6 suite passed **67 tests**; Doghouse passed **49 tests**. Observed human-assisted RTO was **6,388.655 seconds / 106.478 minutes**, including correction work, not an established production SLA. The active signed release is `c0b66e1dafae9ed16c70e2b60733a0de613900634b3f7bb1992421a0d1ca8e8e`, installed sequence 5; failed attempts remain consumed through sequence 6.

## Qualification boundary

Ubuntu 26.04/x86_64, Docker 29.1.3/overlay2, Compose 2.40.3, exact frozen QA5 images and source manifest. Only host-operations code changes and in-place preserve mappings are qualified. Foreign installations, renamed/rebound identities or channels, enabled schedules, runtime image changes and database upgrades are denied. General production ingress draining and arbitrary power-cut local-update recovery are not claimed. Cold code **and data** recovery is required; an image downgrade is not a schema rollback.

The provenance statement authenticates **observed image/material/SBOM bindings**. Original source labels are declarations, not an assertion of reproducible builds, upstream builder attestations, SLSA level, vulnerability clearance or licence clearance. The materials descriptor is non-installable. QA signatures do not authorize production.

The original application credential expired legitimately; it was renewed through the existing owner's API for the same application. Neither the clock nor the old credential's expiry was changed. Expired browser sessions were renewed through normal OIDC.

Temporary provider-token revocation remains an operator Console action. Production ALICA-v1 routing/workloads were not switched. Independent production release acceptance belongs to Stage7.

## Evidence and reproducibility

- `evidence/provider-fresh-os.json`, `offhost-final-recheck.json`, `live-restore/`
- `evidence/qualification/`: restoration, update fault journals, migration, actual UI screenshots and direct delivery replay
- `evidence/materials-attestation/`, `materials-envelope.json`, `qa-release-public-trust.json`
- `archive.py`, `provider_rebuild.py`, `restore_dsh2.py`, `reference_restore.py`
- `compatibility.py`, `migration_contract.py`, `migration_check.py`, `update_ops.py`
- `qa_update_faults.py`, `qa_final_recovery.py`, `check_live_restore.py`, `qa_delivery_replay.py`, `qa_lifecycle_ui.cjs`
- `close_stage6.py` rechecks receipt assertions, signature/material integrity and local tests; it does not manufacture remote results. Admission signatures expire and must not be bypassed for a future deployment.

Do not rerun destructive scripts or the consumed rebuild plan just to reproduce a report. Review a new target, backup, signing sequence and recovery plan first. Raw scanner duplicates are staging-only; canonical signed SPDX copies are tracked once.
