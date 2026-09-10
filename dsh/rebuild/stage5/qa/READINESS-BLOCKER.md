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

Next requires an appropriate QA execution environment: an operator-assisted bounded tuning attempt on the existing VM, or approved hardware-accelerated/dedicated QA capacity. No Stage 5 PASS is published.
