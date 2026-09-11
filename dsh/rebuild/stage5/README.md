# Stage 5 — accepted on DSH2 (QA5)

Stage 5 isolated-host acceptance is complete for the checksummed QA5 candidate.
This is not a general production/fleet certification or a claim that the earlier
resource-constrained TCG fixture passed. Development/builds remained on ALICA-v1;
destructive fault injection and the real host reboot ran on dedicated DSH2.

## Accepted artifact

- Cell: `dsh2-stage5-qa5`, DSH2 `95.216.216.143`.
- Release SHA-256: `1fde4fdfeea219bbad1e61e6bcce8046b2a7f9d880218d95a660624be08cd4f6`.
- Build artifact: ALICA-v1 `/srv/alica-dsh-development/stage5-qa-vm/share/stage5-package-qa5`.
- Installed bundle: DSH2 `/srv/alica-dsh-qa/stage5-package-qa5`.
- Fresh installation: **180.249 seconds**. Existing framework images were reused;
  the two corrected overlay images were imported. This was not an all-images-cold run.
- Post-reboot inspection verified the release hash, exact Core/UI image IDs and
  active lifecycle, broker and observer units.
- Doghouse broker source: `5320831dbbdf9bfc62de1718bce97014ecc60cd8`.

## Verified acceptance

All links below are actual collected results, not generated service responses.

| Gate | Result | Evidence |
|---|---|---|
| Fresh install and operations enrollment | Passed | [Installation](qa/evidence/dsh2-qa5/dsh2-install.json) |
| Broker scope, denial/redaction, maintenance and exactly-one recovery | Six cases passed | [Host suite](qa/evidence/dsh2-qa5/host-operations.json) |
| Dependency, actual Docker outage, real storage probe pressure, interrupted broker | Four cases passed | [Extended suite](qa/evidence/dsh2-qa5/extended-host.json) |
| Real OIDC, wrong-password denial and required initial password change | Passed; fresh OIDC login also passed after reboot | [Initial OIDC](qa/evidence/dsh2-qa5/oidc-first-login.json), [post-boot login](qa/evidence/dsh2-qa5/oidc-result.json) |
| Installed operations API | Anonymous denied, owner read allowed, no mutation route, actual installation secrets absent | [API](qa/evidence/dsh2-qa5/operations-api.json) |
| Actual installed browser UI | Authenticated seven-service panel, billing provenance, real observer outage shown unknown/stale and restored | [Browser](qa/evidence/dsh2-qa5/ui-result.json), [healthy](qa/evidence/dsh2-qa5/operations-healthy.png), [stale](qa/evidence/dsh2-qa5/operations-stale.png) |
| Real application/native/provider/callback flow | Result-ready in 33.64 seconds, callback delivered, customer isolation and idempotency passed | [End-to-end](qa/evidence/dsh2-qa5/first-acceptance.json) |
| Callback receiver outage | Delivery recovered; one native task, one business effect, same-key deduplication | [Business faults](qa/evidence/dsh2-qa5/business-faults.json) |
| Actual provider HTTPS-egress rejection | Explicit failure; one native task, zero business effects; no runtime/broker restart | [Business faults](qa/evidence/dsh2-qa5/business-faults.json) |
| Real DSH2 host reboot | Boot ID changed; all seven services recovered automatically with identical container IDs | [Reboot](qa/evidence/dsh2-qa5/reboot-result.json) |
| Post-reboot preservation | Owner, transaction, Compose and secret hashes unchanged; three native tasks and completed receipt preserved | [Reboot](qa/evidence/dsh2-qa5/reboot-result.json) |
| Post-reboot business effects | First request = 1, callback test = 1, provider failure = 0 | [Business preservation](qa/evidence/dsh2-qa5/post-boot-business.json) |
| Shared ALICA-v1 workloads | 69 baseline workloads unchanged | [Shared preservation](qa/evidence/dsh2-qa5/shared-preservation.json) |
| Current Stage 5 regression suite | 24 passed | [Unit tests](qa/evidence/dsh2-qa5/unit-tests.json) |

Browser and application clients verified TLS. No browser route mocks, fabricated
provider responses, injected broker database rows, relaxed readiness deadlines,
or filled data filesystem were used. Storage pressure used an isolated 16 MiB
tmpfs while preserving the original minimum-free-space threshold.

## Defects and test corrections retained in the record

1. Real Docker-outage testing exposed missing Docker-return lifecycle wiring.
   `ops.py` now enables the cell under both `multi-user.target` and `docker.service`,
   and starts the lifecycle unit at enrollment.
2. Installed UI testing exposed overlay copies into unused paths. The packager
   now checks the base runtime entrypoint/working directory and copies Core to
   `/app/dist`, UI to `/app/public`. QA5 is a new immutable candidate; earlier
   candidates were not silently rewritten.
3. Snapshot polling now treats only the known lifecycle transaction-lock response
   as transient within its existing deadline. QA4's failed attempt is retained.
4. Repeated deliberate observer restarts hit its three-starts-per-five-minutes
   limit. The QA5 failed attempt is retained; the operator explicitly cleared
   test-induced systemd limit state before rerunning the remaining two cases.
   Production restart limits were not increased or disabled.
5. The initial post-reboot verifier reached SSH before the ordered broker startup.
   It was corrected to observe socket readiness within a bounded wait. No manual
   start of any of the seven cell services was used to obtain the reboot pass.
6. After fault-induced Core restarts, the fixture authenticated again through real
   OIDC rather than bypassing the resulting 401. The API redaction test was corrected
   to inspect actual secret files, not assume secret values lived in `.env`.

See [historical attempts](qa/HISTORICAL-ATTEMPTS.md), and the retained
[QA3](qa/evidence/dsh2-qa3/) and [QA4](qa/evidence/dsh2-qa4/) evidence.
Individual component reports deliberately retain `wholeStage5Accepted: false`:
no single test grants overall acceptance. The aggregate review below does.

## Evidence review and reproduction

```sh
python3 -m unittest discover -s dsh/rebuild/stage5 -p 'test_*.py'
python3 dsh/rebuild/stage5/qa/review_evidence.py
```

The reviewer checks all acceptance gates, artifact hash and image pins, and emits
[the aggregate verdict and evidence SHA-256 index](qa/evidence/dsh2-qa5/acceptance.json).
Live scripts require explicitly enrolled QA authority and the correct cell selector.
Do not execute destructive tests on shared ALICA-v1. `reboot_check.py snapshot`
records the precondition, the operator separately issues the real DSH2 reboot,
and `reboot_check.py verify` observes recovery without starting services.

## Retention and scope

QA4 retirement retained five data volumes, installation secrets and reference-app
files; see [retirement](qa/evidence/dsh2-qa4/retirement-summary.json).
The superseded TCG QA VM was stopped and its disk retained. No image/volume pruning
or production workload reset was performed. Borrowed QA provider access was imported
through native authority without a refresh token; credentials, cookies, owner
passwords and private keys are excluded from published evidence.

The seven-service cell does not own arbitrary third-party application containers.
The external reference fixture's process lifecycle is not part of the cell's
automatic reboot-recovery claim; its durable business ledger was verified directly.
The Stage 2 installer remains the pinned lifecycle driver, with `ops.py` providing
maintenance-aware coordination. Core/UNIUI expose authenticated read-only status,
not arbitrary privileged host commands.
