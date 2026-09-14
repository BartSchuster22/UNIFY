# ALICA-v1 TLS and fresh-owner checkpoint (2026-09-14)

**Engineering candidate, not frozen, signed, qualified, or approved for distribution.**
ALICA-v1 only. DSH2, its hostname, credentials, services, and storage were not changed.

## Observed result

- Public development origin: https://dsh-dev.aquiero.com.
- Shared Caddy edge retained its pinned image, read-only root filesystem, user,
  existing sites, ports and data volumes. Only that edge was replaced/restarted.
- Browser-trusted Let's Encrypt issuance and existing public health endpoints
  were exercised. Public renewal is Caddy-managed; elapsed-time renewal has not
  been observed. Caddy 2.10.2 does NOT implement SIGUSR1 reload (verified from logs).
  Do not treat documentation for newer versions as evidence of this capability.
- Candidate `dsh2-internal-dev3`, root `/opt/dsh2-internal-dev3`, has seven healthy
  services and an active ownership-verifying Doghouse broker and observer.
- A real `force-renew-tls` invocation completed successfully, with the candidate
  stopped under maintenance and then jointly healthy. Existing live application
  containers were not part of that operation.
- Real Chromium login accepted the generated first-owner password, required and
  accepted its replacement, then requested the owner's email/first/last name.
  No invented personal profile was entered. The OIDC callback/session is NOT
  accepted yet. Provider/workload acceptance is also NOT complete.

## TLS contracts

Installation requests optionally support `tls_mode`: `engineering` (legacy),
`acme` (standalone public ports 80/443), or `proxy` (a separate, operator-managed
TLS edge). Managed modes require canonical HTTPS port 443. `proxy` additionally
requires a dedicated, operator-provisioned `dsh2-*-edge` Docker network. The
candidate publishes no host ports in proxy mode and only its Caddy joins that
network. The outer edge must preserve the canonical Host; the inner edge sets
HTTPS forwarding metadata for Keycloak/Core. Never attach Core/Hermes/databases
directly to the shared public edge network.

The bootstrap exposes `--tls-mode` and `--edge-network`; legacy invocations retain
the old request shape. Only a newly authenticated bundle containing the TLS
implementation may be used. No change to signature/trust admission is implied.
Standalone ACME rendering is unit-tested; the actual deployment tested here uses
proxy mode, not standalone ACME.

Private framework certificates: 90-day leaves, daily renewal timer, renewal at
30 days remaining; a 10-year private CA is rotated when insufficient CA lifetime
remains. Renewal is a maintenance operation with bounded candidate downtime,
not a live rewrite while frameworks are serving. Files retain bind-mounted inodes.
A stopped-state backup supports rollback on failed startup; interrupted renewal
blocks ordinary boot until explicit recovery. If restored certificates are
expired, recovery fails closed; operator intervention is required.

Use the authenticated lifecycle executable with the same bundle, root, request,
and release SHA for `renew-tls`, `force-renew-tls`, and `recover-tls`. Do not run
raw Compose to bypass locks/maintenance. Timer/services are per-cell. Preserve
`secrets/.tls-renewal-recovery` if present; it contains private keys and must never
be attached to tickets, logs, Git, or chat.

## Engineering packaging and namespace changes

`assemble_dev.py` is a host-specific, refuse-overwrite engineering assembler,
not a published installer. It verifies every predecessor file before reuse and
never hard-links mutable predecessor metadata. Runtime images are unchanged;
that does not transfer their earlier QA acceptance to this candidate.

The previous QA template used a fixed application subnet and a fixture-only
callback exception. The internal candidate removes both; it does not modify or
reuse retained QA networks or seed restored user/provider/project state.

`internal_operations.py` adapts exactly two QA-only namespace validators to the
installer's existing dedicated `dsh2-` namespace and additionally checks that the
broker root basename matches its configured cell. It retains protected root
ancestry, owner hash, full service set, image, runtime signature, mount, label,
peer authorization and fixed-command checks. The patched archive is explicitly
included in the candidate manifest; no admitted bundle was edited in place.

Failed trial 1 remains stopped with diagnostics/data. Trial 2 was stopped through
its lifecycle entrypoint and its per-cell units disabled. Neither is a release.

## Shared edge persistence and rollback

Host path `/opt/alica-dev-edge/Caddyfile` is mounted read-only into Caddy. Deployment
must retain `/opt/alica-dev-edge/override.json` alongside the original Compose
file. Omitting the override on a future deployment removes the development route.
The original config, container identities, and pinned image are retained under
`/opt/alica-dev-edge`. `edge_change.py` records the initial controlled transition;
it refuses to overwrite its rollback directory. It is not an idempotent installer.
Its initial route was trial 2; the live persisted config subsequently targets
`dsh2-internal-dev3-edge:8080`. Use the live persisted configuration for future
maintenance, not the historical initial route in that script.

Do not assume atomic pathname replacement updates an existing file bind mount.
Validate a staged config first, preserve the mounted inode, then perform a scoped
Caddy restart with public health checks. This Caddy build has its admin API off.

## Gates before freeze/qualification

- Complete owner profile with real operator-supplied details, OIDC return, fresh
  re-login/logout and supported owner-recovery acceptance.
- Authorize the selected provider through its supported UI/OAuth consent; test
  expiry/reauthorization. No coordinator token or provider credential was copied.
- Create a disposable project/application through supported UI/API, then prove a
  real model-backed task and its state/output. No private QA seeding scripts.
- Freeze exact source/artifact/trust identities and build the installable internal
  candidate; current dev bundles intentionally carry unqualified/dirty provenance.
- Qualify exact-candidate lifecycle/recovery and day-scale operation. No host reboot
  or daemon restart is approved on this shared host. Do not transfer QA evidence.

Unit suites observed passing: stage2 installer/PKI (32), internal bootstrap/TLS
request boundaries (27), stage5 lifecycle contracts (24). These tests are not a
substitute for the pending human/provider/application acceptance above.
