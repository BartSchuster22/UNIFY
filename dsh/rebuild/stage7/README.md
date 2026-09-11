# Stage 7.1–7.3 — independent acceptance

**IN PROGRESS. No Stage 7 acceptance or production approval.**

Authorized by the user's request to start and complete 7.1–7.3. Production routes, PSI, licences and Stage 7.4–7.6 are outside this task.

## Predeclared acceptance scope

- DSH2 only: provider server 165497729, IPv4 95.216.216.143. Verify current encrypted recovery copies on both off-host destinations before any replacement; preserve current operations state and anti-replay counters as well as application data.
- Build an immutable, publicly downloadable QA prerelease containing the assembled components, reference-application image, checksum inventory, QA signature and explicitly pinned operator trust. Existing public Stage 2/D6 artifacts are historical and do not qualify this run.
- A fresh OS, empty Docker store and new installation identity must precede installation. No application database restoration, prefilled checkpoints, target source checkout or target image build counts as clean installation.
- Record the actual host CPU/RAM/disk, enforced container limits, install duration, peak usage and OOM counters. State only measured supported ceilings; do not infer a smaller-host minimum.
- Exercise owner OIDC and recovery, credential lifecycle, transport and CSRF denials, project/customer isolation, first real inference, reference-app research/knowledge/revision/deletion, UI, and durable native identity correlation.
- Recurrence: fresh native grant/job, eight governed results with real elapsed time of at least 30 minutes, bounded deadline of two hours, verified checkpoint preservation over native restart, unique request/receipt/effect correlation, terminal paused job/capability cleanup. No clock/outcome edits; no day/week soak claim. Estimated budget is not measured provider cost.
- Repeat recovery plus authenticated off-host restore and signed update/rollback against this run's actual source identities. A stage-specific earlier PASS is not an independent rerun.
- Every blocker or conflicting historical PASS receives a traceable disposition and real rerun. Mark unexecuted/failed gates explicitly; no aggregate PASS with missing evidence.

## Prerequisites found

- The live public release listing exposes Stage 2 and historical D6 artifacts only.
- DSH2 provider identity was reverified through the live API; its accepted QA5 services remain running during preparation.
- Publication uses the existing public-repository GitHub Actions workflow pattern; no local GitHub API token is required.
- Canonical v2 host-operations identity must be enrolled by the new installer, not silently inherited from the old Stage 5 legacy enrollment.

This document is a run contract, not evidence that those checks have passed.
