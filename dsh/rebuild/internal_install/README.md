# Clean-user installation bootstrap — development preview

## Current development acceptance checkpoints

- [Step 6 — real native execution and browser cancellation: PASS](STEP6_FINAL_ACCEPTANCE.md).
- [Step 7A — supported cell restart and interrupted-run recovery: PASS](STEP7A_FINAL_ACCEPTANCE.md), under an explicit per-task no-retry policy.

These are bounded development acceptance results, not fresh-install, recovery/restore, day-scale or release-freeze qualification. Earlier failed checkpoint reports remain historical evidence.

This is the first implementation checkpoint of internal-user installation readiness,
not a completed internal release. ALICA-v1 develops/builds; DSH2 is the clean user
installation target; ElioHermes coordinates. No restored QA state or coordinator
provider credentials belong in the new installation.

## Owner credential handoff

See [ONBOARDING.md](ONBOARDING.md). Successful installation now prints the URL,
chosen username, and exact local commands for initial-password retrieval and
explicit owner recovery. `setup.py onboarding` checks live identity state;
`--reveal-initial-password` requires terminal confirmation and never prints a
password to ordinary stdout/JSON. `setup.py recover-owner` requires explicit
confirmation before invoking the authenticated lifecycle recovery operation.
These commands do not enable public registration or complete provider/workload
acceptance. They are included in the updated preview kit, not old published kits.

## Scope and status

`setup.py` downloads and verifies a pinned archive, rejects unsafe extraction,
revalidates admission before invoking the existing `alicactl`, and leaves owner,
provider and workload acceptance explicitly incomplete. It never edits Docker or
native framework configuration itself. Only `alicactl` owns installation/lifecycle.

The existing QA4 archive is a mechanism-test input, NOT the newly accepted internal
release. Its QA trust stays QA. No production key, new runtime publication,
distribution approval, TLS-renewal acceptance or generic upgrade support is granted.

Remaining before accepting an internal candidate:
- Decide/freeze runtime candidate and applicable internal-use conditions. Cleaned
  images require their own qualification; earlier QA4 PASS cannot be transferred.
- Complete sustainable external and framework-internal TLS certificate management.
  Current engineering certificates are not a completed renewal solution.
- Exercise new-owner login/recovery and provider setup using the supported UI,
  including the chosen provider's expiry/reauthorization path, not token injection.
- Prove project/application onboarding without private QA provisioning scripts.
- Verify DSH2 identity and backups, rebuild cleanly, install the exact final candidate,
  then run full critical-path and day-scale acceptance.

## Prerequisites

The qualified predecessor environment is Linux amd64 (Ubuntu 26.04). Its recorded
hardware/runtime versions are in `../stage7/FINAL-QA4.md`; other platforms are not
implicitly qualified. Install Python 3 with `cryptography`, OpenSSL, CA certificates,
and Docker Engine with Compose v2 using supported OS/vendor instructions. Python's
system interpreter must import `cryptography` with isolated mode (`python3 -I`).

For a fresh target, retain the predecessor's planning allowance of 8 GiB RAM and
30 GiB free disk. Preparation has separate bounded disk checks; it does not prove
sufficient space for Docker import and sustained operation. Root access is required.

Do not install development prerequisites or rebuild application images on DSH2.
Docker and OS prerequisites are legitimate operator steps; a source checkout is not.

## Bootstrap trust

The builder emits a small setup kit with `setup.py`, the existing release verifier,
and this guide. Obtain its exact SHA-256 and source identity via an authenticated
channel separate from an arbitrary candidate. There is no new public release of
this kit yet. Do not use a mutable `latest` URL as a trust pin.

Before executing the bootstrap or verifier, verify their supplied checksums and put
them under root-owned, non-writable ancestry, for example `/usr/local/lib/alica-setup`.
Keep the externally pinned release trust under `/etc/alica/release-trust`. A normal
user-owned home/development directory fails the protection check even if a file
inside it is owned by root. Do not weaken the guard to work around that failure.

Trust is external to the preparation directory. A public key from an arbitrary
candidate is not an independent trust anchor. TLS verification is never disabled.
Expired envelopes require a newly authenticated envelope from the publisher, not
clock changes, `--insecure`, or a made-up production scope.

## Download and prepare

The following is the tested **historical QA4 mechanism example**, not a production
installation recommendation. For an approved internal candidate, substitute its
explicit release URL, archive identity and independently provided trust pins.

Download `candidate-trust.json` and `release_trust.py` from the immutable release:
https://github.com/BartSchuster22/Alica-DSH/releases/tag/dsh-stage7-qa4-72297c3

Independently retained SHA-256 pins:
- trust: `5af48e80bffa12df7921c2c688f4f2f2249c68032d04e6f7e10621668d264034`
- verifier: `62f39860a259a76721068b23140eca846def5acca5b728fbab26518576722547`

With the trusted bootstrap and external trust in the protected paths:

```sh
sudo python3 /usr/local/lib/alica-setup/setup.py prepare \
  --destination /var/lib/alica/download-qa4 \
  --release-base https://github.com/BartSchuster22/Alica-DSH/releases/download/dsh-stage7-qa4-72297c3 \
  --archive-name dsh-stage7-qa4-72297c3-linux-amd64.tar.gz \
  --archive-sha256 26f98d6ffc8ecc576628b061a9851b8cd40e1e917f070a8567b9fb48ee969553 \
  --trust /etc/alica/release-trust/candidate-trust.json \
  --trust-sha256 5af48e80bffa12df7921c2c688f4f2f2249c68032d04e6f7e10621668d264034 \
  --verifier /usr/local/lib/alica-setup/release_trust.py \
  --verifier-sha256 62f39860a259a76721068b23140eca846def5acca5b728fbab26518576722547 \
  --scope qa
```

Create the protected parent directories first. The destination itself must be new.
A failure retains diagnostics/downloads but never creates a successful preparation
receipt. Inspect failures and use a new destination; do not overwrite failed state
or add an integrity bypass. Preparation does not start or import containers.

Recheck signature time, external pins and every extracted byte:

```sh
sudo python3 /usr/local/lib/alica-setup/setup.py verify \
  --destination /var/lib/alica/download-qa4
```

## Fresh installation command (after candidate approval)

Replace the example hostname with an operator-owned hostname. Configure its actual
DNS and supported TLS arrangement first. Loopback is the safe default; binding all
interfaces must be deliberate and protected by the operator's network policy.

```sh
sudo python3 /usr/local/lib/alica-setup/setup.py install \
  --destination /var/lib/alica/download-INTERNAL-CANDIDATE \
  --root /opt/dsh2-internal --cell dsh2-internal \
  --origin https://dsh.example.com --owner owner --port 443 --bind 0.0.0.0
```

`dsh2-` is currently the installer's namespace contract, not a hostname guard.
The host itself need not be named DSH2. Existing roots are rejected by this fresh
entrypoint so a zero-predecessor release cannot be presented as an upgrade.

A zero installer exit does not complete onboarding. No passwords are printed by
the bootstrap. Retrieve the temporary owner password locally as root from the
reported `secrets/owner-password` file; never paste it into chat, logs or a browser
application's source. Follow the identity login and mandatory password change.

## Owner, provider and first-workload acceptance

1. Visit the real HTTPS origin without a browser certificate exception. Complete
   genuine owner login and password change. Confirm logout and recovery.
2. Configure a provider/model through the Hermes-owned interface exposed by DSH.
   Use the operator's own authorization. Device/OAuth consent is a human action;
   importing ElioHermes credentials or writing a QA credential fixture is not a substitute.
3. Create/register the first project/application through its supported product path.
   Keep application credentials in its backend, never in browser code.
4. Execute a real task; verify its durable result and project-isolated knowledge.
5. Restart through the supported lifecycle, verify continuity, then exercise
   scheduling and credential expiry/reauthorization appropriate to that provider.
6. Create and verify an encrypted off-host backup and isolated restore. Record the
   retained identity/recovery/update state without exposing private materials.

These are acceptance gates, not claims that the present bootstrap completes them.
If a private SQL/script intervention is necessary, fix the product/guide on ALICA-v1
and retest a newly frozen candidate instead of quietly repairing DSH2.

## Failure recovery and operator lifecycle

Keep the prepared bundle, request and release identity. The existing lifecycle API
accepts the following shared arguments:

```sh
sudo /var/lib/alica/download-INTERNAL-CANDIDATE/bundle/alicactl ACTION \
  --bundle /var/lib/alica/download-INTERNAL-CANDIDATE/bundle \
  --release-sha256 EXACT_RELEASE_JSON_SHA256 \
  --root /opt/dsh2-internal \
  --request /var/lib/alica/download-INTERNAL-CANDIDATE/request.json
```

Use `status`, `stop`, `start`, or `recover-owner` as applicable. After a failed fresh
installation, inspect retained diagnostics and reverify the preparation, then use
this same pinned `alicactl install` invocation for its existing journalled retry
contract. Do not use a different bundle/request or pass a virgin installation as an
upgrade. Stop/uninstall retain owned data; they are not a clean OS rebuild.

General runtime-image/schema updates are not covered by the historical operations-
only update acceptance. No global Docker prune, unverified volume deletion, automatic
OS reset, certificate verification bypass or signature downgrade is part of setup.

## Development verification

On ALICA-v1, in this directory:

```sh
sudo python3 -m unittest -v test_setup
```

Unit archives are intentionally small synthetic fixtures. Their Ed25519 signatures
are real, but they are never represented as DSH runtime/workload acceptance. Separate
real-download evidence records the actual published archive and full inventory.
