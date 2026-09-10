# Stage 5 operations candidate — NOT ACCEPTED

Source implements a bounded host broker and unprivileged observer from
Doghouse `5320831dbbdf9bfc62de1718bce97014ecc60cd8`, maintenance/lifecycle
coordination, persistent incidents and authenticated read-only Core/UNIUI status.
No Stage 5 live acceptance or production readiness is claimed.

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
  but was insufficient to prevent the VM OOM. The VM is now stopped. Ordinary
  host monitoring passes; admission of another QA run currently fails the
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
Safe sustained fixture capacity, application installation and application
reboot recovery are not. The command-runner poweroff/reboot restriction still
applies; neither the operator's earlier tooling-only reboot nor the VM OOM
counts as passing Stage 5 recovery acceptance.

The scripts under `qa/` are test preparations; their live acceptance suite has
not run successfully. They must not be presented as completed evidence.

## Remaining acceptance

- Correct fixture sizing within safe existing-host capacity; install candidate.
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
