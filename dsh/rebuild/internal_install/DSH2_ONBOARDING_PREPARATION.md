# DSH2 separate onboarding preparation — 2026-09-15

**Latest checkpoint:** Step 2 completed; candidate prepared and authenticated on DSH2, not installed or started. See [DSH2_CANDIDATE_PREPARED.md](DSH2_CANDIDATE_PREPARED.md). The target/trust-absence statements below describe the earlier initial-preparation checkpoint.

**Host/bootstrap prepared. Runtime package subsequently built and verified on ALICA-v1; DSH2 delivery/admission and installation still pending.** See [ONBOARDING1_PACKAGE.md](ONBOARDING1_PACKAGE.md) for Step 1 completion and immutable identities. This document retains the original host-preparation evidence below.

## Separate target

- Host: DSH2, `95.216.216.143`; origin `https://dsh-next.aquiero.com` resolves correctly.
- Proposed cell: `dsh2-internal-onboarding1`.
- Reserved runtime root: `/opt/dsh2-internal-onboarding1` (deliberately absent).
- Preparation area: `/var/lib/alica/dsh2-internal-onboarding1`.
- Runtime destination: preparation area `/candidate` (deliberately absent).
- Bootstrap: `/usr/local/lib/alica-setup-onboarding1/setup.py`.
- External runtime trust directory: `/etc/alica/release-trust/onboarding1` (deliberately empty).
- Proposed new owner name: `owner`; no account/password created yet.
- Planned TLS: standalone ACME, canonical HTTPS origin, ports 80/443. Ports were free and temporarily bind-tested without listening; public firewall reachability and actual issuance remain unqualified. No firewall or DNS changes made.

The preparation area's `installation-plan.json` records these choices and blocking gates. The old licensing/QA installation is not an upgrade source.

## Verified preparation

Pinned source: `f57ed263f49f0f87a61cc69aa9ba2f1be3299f52`.

A separate detached source worktree was created on ALICA-v1. Its existing dirty development worktree was not reset or overwritten. The supported `build_kit.py` built the small preview kit on ALICA-v1; no source checkout, application build or runtime image import occurred on DSH2.

All 41 bootstrap/onboarding tests passed as root from the internal_install directory. An initial invocation from a different directory exposed the terminal test's relative-import assumption; invoking the suite from its module directory passed without source changes. The management-host unprivileged run passed with 23 root-only tests skipped; it is not the full-suite result.

Archive SHA-256: `9a1d9b15d0087aeeb00029e78ad9a35bec554e027a3735b7c777dfbde6ce3492`.

The archive and all five members were checked against the build receipt and the pinned local source before installation into root-owned, non-writable ancestry. The DSH2 CLI help smoke test passed. Verification of the absent runtime destination correctly failed; no preparation/admission success receipt was invented.

Live prerequisites: Linux x86_64, Python 3.14.4, isolated-mode cryptography import 46.0.5, OpenSSL 3.5.5, Docker 29.1.3 and Compose 2.40.3+ds1-0ubuntu1. These are observed versions, not blanket runtime qualification. Available disk after preparation: 40.889 GiB.

## Preservation

The user explicitly paused Stage 7.4 licensing for later review. Candidate, licensing evidence/tools, original bundle, original containers/images and their supporting state are protected. Hash/metadata verification covered 9,251 retained filesystem entries against the cleanup protection baseline. Eight old containers and sixteen image IDs remained present; no containers were started. No owner/provider/QA state was copied into the new namespace.

## Runtime-package gate at initial preparation

The assembly/image-verification/signing items below have since completed on ALICA-v1, as recorded in [ONBOARDING1_PACKAGE.md](ONBOARDING1_PACKAGE.md). Target prepare/verify and installation remain pending. No runtime destination or trust changes were made on DSH2 during Step 1.

The live Step 7B development manifest explicitly contains `uiUpdate.freshInstallArtifact=false` and an ALICA-v1-only/no-DSH2 scope. It cannot be treated as the new installation release. The source guide also records a corrected Caddy private-path renderer not backported into the existing dev3 bundle.

Before installation:
1. Assemble a new fresh-install candidate on ALICA-v1 from the intended runtime/source set, including the corrected renderer and verified Step 6/7A/7B changes.
2. Verify that its exported archive actually contains every pinned runtime image and consistent identity/OCI metadata; do not depend on images already installed on a development host.
3. Supply explicit new candidate provenance and fresh authenticated runtime trust/envelope metadata under the appropriate QA/internal-development scope; do not manufacture production approval or relax admission.
4. Use the supported bootstrap prepare/verify path into the still-absent candidate destination.
5. Install only after those gates. New-owner/provider authorization remains a separate interactive acceptance journey.

Preparation evidence: `dsh2-onboarding1-preparation/`. This checkpoint is not a runtime release, TLS acceptance, completed owner journey or new restore test.
