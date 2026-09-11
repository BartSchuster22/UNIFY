# Historical Stage 5 attempts

Superseded by ../README.md and the QA5 evidence. The following is the previous status document, preserved verbatim as historical evidence, not the current verdict.

# Stage 5 operations candidate — NOT ACCEPTED

Source implements a bounded host broker and unprivileged observer from
Doghouse `5320831dbbdf9bfc62de1718bce97014ecc60cd8`, maintenance/lifecycle
coordination, persistent incidents and authenticated read-only Core/UNIUI status.
No Stage 5 live acceptance or production readiness is claimed.

Latest continuation (2026-09-11): the existing TCG guest rebooted successfully,
but retained QA3 again failed the unchanged SQL-readiness deadline. A separate,
longer-deadline SQL diagnostic passed without modifying product configuration;
it is not an installation pass. All 65 re-executed readiness/lifecycle/broker
regressions passed. Live acceptance now requires suitable approved isolated QA
capacity. See [the current blocker and recorded evidence](qa/READINESS-BLOCKER.md).

## Verified before live installation

- Doghouse policy and broker tests: 32 passed.
- Core gateway regression suite: 234 passed, including eight operations tests.
- Capacity policy tests: eight passed.
- Core and UNIUI type checks and builds passed.
- Candidate overlay images and self-contained archive built successfully.
- Candidate release SHA-256:
  `4cd6454621983c5fe3904f52877d7dac3369497817697042a58e6836593e2a20`.
- Candidate resides on ALICA-v1 at
  `/srv/alica-dsh-development/stage5-qa-vm/share/stage5-package-qa1`.

## Actual installation attempt: refused by memory preflight

On 2026-09-10 the candidate was invoked inside the existing disposable QEMU
VM, not on the shared host. Guest kernel: `6.8.0-138-generic`; Docker:
`29.1.3`; Compose: `2.40.3`. The installer exited 1 in `Installer.plan()`:

```
transaction.TransactionError: Less than 4 GiB available memory
```

The fixture was configured with `-m 4096`; the guest reported 3914 MiB total
and 3477 MiB available at the subsequent inspection. A 4 GiB-total VM cannot
satisfy the unchanged 4 GiB-available preflight. This is a QA fixture sizing
error, not a successful installation or evidence that the product fits that
resource envelope. Guest Docker listed no images or container objects after
this attempt. No preflight bypass or application installation was performed.

## Subsequent live attempts on 2026-09-10

- The operator manually shut down the guest. It was relaunched with 5120 MiB
  guest RAM, a 4608 MiB host cgroup RAM cap and a 128 MiB swap cap. The guest
  reported 4516 MiB available; cloud-init completed and the read-only share
  mounted after boot. The original memory preflight was not weakened.
- The native installation failed during image import and recorded rollback.
  A separately checksum-verified image preload also hit its 1200-second limit.
- Six images became visible in the guest's containerd store, using OCI
  manifest identities rather than the config identities pinned for the
  classic Docker backend. The build host uses classic `overlay2`.
- With zero guest containers and volumes verified, the six failed-candidate
  image records were removed and the guest was switched to classic `overlay2`.
  Two specifically identified orphaned import leases were removed through
  containerd's API; the retired store then occupied 1 MiB. Installed data and
  the failed-install owner journal were not deleted.
- A new, bounded 1800-second preload followed by installation and host tests
  was launched. It did NOT complete: at journal time 16:34:08 the VM cgroup
  was OOM-killed (4.5 GiB RAM peak, 128 MiB swap peak). No live host-suite pass
  or successful installed candidate is claimed.
- Releasing clean guest page cache temporarily restored host RAM headroom,
  but was insufficient to prevent the VM OOM. At that point the VM was stopped. Ordinary
  host monitoring passed; admission of another QA run then failed the
  12 GiB free-disk floor. The physical host has a roughly 2 GiB zram swap
  device, not a large disk-backed swap reserve.
- Doghouse's source branch was pushed and remotely verified at the revision
  above. Browser dependencies installed successfully and Chromium launched;
  this is NOT an installed UNIUI acceptance test.
- The bounded QA provider transport was exercised from the guest over an SSH
  Unix-socket tunnel, preserving end-to-end public TLS validation. The actual
  unauthenticated HEAD request returned HTTP 405. This proves transport only,
  not provider authentication, a model run, or business-effect recovery.

The initial seed mount issue and initial RAM-preflight issue are resolved.
Application installation and application reboot recovery remain unaccepted.
See the subsequent capacity/import and readiness results below.
The command-runner poweroff/reboot restriction still
applies; neither the operator's earlier tooling-only reboot nor the VM OOM
counts as passing Stage 5 recovery acceptance.

The full live acceptance suite has not run successfully. Only the explicitly
reported readiness regression below is complete; other preparations are not
completed acceptance evidence.

## Subsequent import and PostgreSQL readiness regression

Approved archive compression and verified QCOW compaction reclaimed capacity.
With bounded emulator overhead and temporary disk-backed swap, image preload
completed in 1186.49 seconds and verified all seven config-ID pins. Installation
then failed at migrations. PostgreSQL logs showed interrupted initialization;
the retained cluster lacked the `unify` database and completed network-auth
initialization. `pg_isready` nevertheless returned success. The transaction
remained rolled back; it was not manually marked installed.

Stage 5 packaging now replaces that listener-only probe with a password-file
backed TCP `psql` connection as `unify_bootstrap` to database `unify`, executing
`SELECT 1` with `ON_ERROR_STOP`. It disables password prompts and psql startup
files, bounds connection time, and suppresses command output. Existing health
interval/timeout/retries, network isolation, and authentication policy are not
loosened. The frozen original candidate is NOT rewritten: this correction is
applied when generating the next checksummed Stage 5 package.

Verification:

- Four readiness unit tests passed, including SQL failure, missing secret,
  exact query/identity and preserved security/time budgets.
- Four existing Stage 2 installer preparation/security regressions passed.
- `qa/readiness_live.py` executed inside `dsh-stage5-disposable`, with the
  existing seven images; no image import was repeated.
- Retained partial cluster: old probe exit 0, corrected probe exit 2.
- Fresh, isolated, tmpfs-backed PostgreSQL: corrected Docker health check
  reached healthy with the unchanged 3-second timeout and SCRAM host auth.
- Missing database: old probe exit 0, corrected probe exit 2.
- Wrong password: corrected probe exit 2.
- Temporary probe container removed; retained PostgreSQL stopped; owner,
  transaction and Compose file hashes unchanged. No retained database was
  repaired, reset, or manually populated by this regression.

Machine-readable live results: `qa/readiness-live-result.json`.
The VM and temporary swap remain allocated; this is not final QA cleanup.
Repackaging, safe handling of the retained partial cluster, successful full
installation, and the remaining Stage 5 acceptance tests are still required.

## Remaining acceptance

- Package the readiness correction and install within verified host capacity.
- Exercise actual broker services and installed Core/UNIUI status.
- Test lifecycle coordination, interruption, dependency, provider, callback,
  storage-pressure, uncertain-effect and bounded recovery behavior.
- Verify real guest reboot and Docker daemon failure, without shared-host disruption.
- Verify native ownership, deduplicated business effects, scope/security and
  final shared-workload preservation.
- Publish live evidence and a truthful final verdict. Unit tests and built
  images do not replace these gates.

The Stage 2 installer remains the pinned underlying lifecycle driver;
`ops.py` is the candidate operations-aware wrapper. Privileged operations are
local root-operator actions, never arbitrary commands from Core or UNIUI.
