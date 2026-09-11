# Stage 5 continuation: NOT ACCEPTED

## Verified progress

- SQL readiness requires a password-backed query against the required database.
- Compose in the QA VM returned exit 0 while the required database was still starting. The Stage 5 wrapper now independently rejects missing, stopped, starting, or unhealthy required services after `up --wait`.
- Nine readiness regression tests passed. The false-success guard was also exercised against real Compose and PostgreSQL; see compose-wait-guard-result.json.
- QA2 cold installation failed and its data remains retained.
- QA3 package SHA-256: dc83fe85b6d768e186fa1c520558da82d096a0bf81724ecad99ea06250ffc4db. Its images are unchanged; no image import was repeated.

## Current blocker

QA3 used explicitly staged initialization, NOT a cold one-shot installation pass. PostgreSQL completed initialization on persistent storage. Nevertheless, the unchanged package CPU quota (NanoCpus 250000000), 3-second Docker health timeout, and 2-second connection timeout did not yield readiness in the TCG guest. TCP connection succeeded, but both the required network SQL probe and a diagnostic localhost SQL probe timed out. See bounded-sql-diagnostic-result.json. No CPU limits or timeouts were enlarged.

The earlier positive disposable PostgreSQL regression fixture used a 384m memory limit and did not set the package CPU quota. It establishes probe functionality, not acceptance under the full package resource envelope.

Neither the development host nor coordinator exposes /dev/kvm or hardware virtualization CPU flags. This is an execution-environment blocker; the current observations do not justify claiming that a particular VM tuning change will resolve it.

## Staging and preservation

The staging helper initially inherited a restrictive umask that prevented runtime files from being read. The helper was corrected and affected QA3 modes restored to native defaults. Owner password and CA key remain 0400; protected directories remain 0700; credential values were not changed.

Staging was intentionally interrupted after persistent readiness timeouts, and scoped cleanup completed. Final verification found no running guest containers. QA1 and QA2 remain rolled-back; QA3 remains prepared with no completed checkpoints injected. The initialized QA3 database is retained. The VM and temporary swap remain allocated; host capacity admission passed.

## Outstanding acceptance

- Successfully installed/enrolled candidate under unchanged product limits.
- Live host failure/recovery suite, provider/callback cases, and reboot validation.
- Installed UI and complete preservation/security acceptance.

Chromium was installed and launched successfully on the coordinator, but the installed UI was NOT tested. QA3 namespace/client adaptations are preparatory code, not evidence that those scenarios passed.

## Bounded continuation on 2026-09-11

The existing guest disk was relaunched after capacity admission, with the saved
5120 MiB guest allocation, 3584 MiB QEMU physical-memory cap, 2560 MiB QEMU swap
cap, 200% host CPU quota, bounded TCG translation cache, and free-page reporting.
Guest Docker and the read-only share became ready; guest available memory was
4491 MiB at the readiness check. This is a tooling boot, not installed application
reboot acceptance.

The retained QA3 database was started without reinitialization or image import.
The unchanged package CPU quota remained 250000000 NanoCpus; the Docker health
timeout remained 3 seconds. During a bounded 180-second observation, health
never became healthy. The exact required authenticated SQL probe returned exit
2 after 9.784 seconds. Container counters recorded 1312 throttled periods out
of 1570 and no OOM events. This retry did not resolve the execution blocker.

A separate diagnostic then used the same identity, database, query, and CPU
quota but allowed its client a 20-second connection deadline. It returned exit
0 after 15.173 seconds. **That diagnostic is not acceptance, and the product
health check/configuration was not modified.** It demonstrates successful SQL
access with additional time, supporting a timing bottleneck in this environment;
it does not prove performance on a suitable target or justify weakening limits.

Both checks stopped the candidate afterward, verified no running guest
containers, and verified the captured preservation hashes. QA3 remains prepared,
not installed; the prior owner, transaction, and Compose files were not rewritten.
The host capacity guard still passed; QEMU remained active with no cgroup swap
usage at the recorded final sample. The guest and temporary swap are retained,
not final-cleaned. The host still exposes neither `/dev/kvm` nor VMX/SVM CPU flags.
Shared-host application services were not restarted or reconfigured by this run.
A guarded guest poweroff was subsequently attempted, but the agent command runner
unconditionally blocked shutdown/reboot commands before execution. No alternative
shutdown mechanism was used. Operator shutdown is needed to release the VM now;
otherwise its existing six-hour supervisor runtime limit still applies.

Re-executed regressions: 9 Stage 5 readiness tests, 24 Stage 2 lifecycle/security
tests, and 32 Doghouse broker/policy tests passed. They do not replace live gates.

Evidence and executable diagnostic sources:

- `resume_readiness.py`, `resume-readiness-result.json`
- `sql_timing_diagnostic.py`, `sql-timing-diagnostic-result.json`
- `resume-environment-result.json`
- `resume-regressions-result.json`

**Next requires approved, suitable isolated QA capacity**, preferably reclaimed
existing hardware-accelerated or dedicated capacity rather than another identical
TCG retry. Host/guest-reboot and Docker-daemon fault testing must not run against
shared workloads. No new host was provisioned, product limit relaxed, installation
checkpoint forged, or Stage 5 PASS published. The remaining live acceptance gates
above are still blocked by the absence of a successfully installed candidate.
