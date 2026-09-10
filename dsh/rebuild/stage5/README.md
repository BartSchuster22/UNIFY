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

The VM has no configured memory hotplug slots. Correcting its configuration
requires a guest shutdown and relaunch. The agent command runner explicitly
prohibits poweroff/reboot commands, including inside this guest. That boundary
must not be bypassed. A manual operator shutdown is required; safe capacity
must be reassessed before relaunch. No additional machine is presumed.

The first cloud-init seed also had a malformed mount argument. The read-only
QA share was mounted explicitly and added to guest fstab during tooling setup;
fresh boot acceptance is still outstanding.

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
