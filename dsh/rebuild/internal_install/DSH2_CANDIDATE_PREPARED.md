# DSH2 onboarding candidate — Step 2 completed (2026-09-15)

**Subsequent checkpoint:** [Step 3 installation completed](DSH2_INSTALLED.md): seven services healthy and public standalone HTTPS verified. The root-absence and unchanged-bootstrap statements below record Step 2; Step 3 includes a documented bootstrap bytecode fix. Private owner onboarding remains pending.

**Prepared and authenticated; NOT installed or started.** Scope explicitly stops
before installation, image import, service startup and human owner/provider setup.

## Isolated layout

- Prepared candidate: `/var/lib/alica/dsh2-internal-onboarding1/candidate`.
- Unmodified staged bootstrap: `/usr/local/lib/alica-setup-onboarding1/setup.py`.
- Independently pinned external public trust: `/etc/alica/release-trust/onboarding1/candidate-trust.json`.
- Planned runtime root `/opt/dsh2-internal-onboarding1` remains absent.
- Neither the protected Stage 7.4 licensing tree nor `/srv/alica-temporary-storage`
  is used as the candidate, transfer or trust area.

## Transport and real bootstrap execution

The 1,649,300,836-byte archive was streamed over strictly host-verified SSH from
ALICA-v1 into the onboarding namespace's root-only `incoming` directory. DSH2
readback matched the independently recorded archive SHA-256. Only the public
Ed25519 QA trust was provisioned, with its separately pinned SHA-256. The release
signing private key remained on ALICA-v1.

Because the existing bootstrap accepts HTTPS prepare, the SSH-delivered archive
and envelope were exposed briefly on **127.0.0.1 only** using a dedicated ephemeral
HTTPS server. Only the two exact files were served. A short-lived private CA and
localhost/IP-SAN server certificate provided actual TLS/hostname verification;
`SSL_CERT_FILE` scoped trust to the bootstrap child process. No system CA change,
TLS-verification bypass, public listener, production web-service change, bootstrap
patch or signature bypass occurred.

The staged bootstrap's actual CLI `prepare` completed and authenticated all 20
files. The HTTPS listener was then shut down, its closure checked, and the
transient server private-key file removed. The CA signing private key was never
written to disk. A separate CLI `verify` succeeded **offline**, after the endpoint
was gone and without the process-local TLS trust setting.

The historical loopback `releaseBase` in `preparation.json` records how delivery
occurred; it is not a persistent package service. Subsequent `verify` and `install`
use the authenticated local candidate and external public release trust.

## Immutable pins

- Archive: `internal-onboarding1-599b7098-linux-amd64.tar.gz`.
- Archive SHA-256: `37ac2bbf89ef0b37bfd80b92d14e013b5b7b6244d8b0cdf44f42c3873c4dcaf0`.
- Release SHA-256: `8fecaecb87f92a47a9ea427965f79525095f9b9567e92dedf6d03d403147b204`.
- Public trust SHA-256: `ac6d836bb5cd3efa6ab15832e574f1b5455aabff4273bc99331dfa7f43b5e1ac`.
- Verifier SHA-256: `62f39860a259a76721068b23140eca846def5acca5b728fbab26518576722547`.
- Staged bootstrap SHA-256: `4f442e513e43d94c3a945edce9f13c4deaf8dae0c11707cb4f309989ca6959cc`.
- Scope **qa**. Admission expires **2026-09-22 13:28:37 UTC**; do not bypass expiry.

## Preservation and capacity results

- 9,251 protected entries matched the licensing-preserving baseline before and
  after preparation, including content hashes, file size/mtime, ownership and modes.
- Eight old containers retained their full captured state, image identity and
  restart counters. No running containers; all sixteen existing image IDs unchanged.
- All three relocated archive hashes reverified in their retained destinations.
- No image imports, runtime root, owner account, provider state or service starts.
- Final free space: **32.595 GiB**.
- Only the newly transferred duplicate incoming archive was removed after full
  admission and prepared-archive readback. The prepared archive/bundle remain.
- The preparation area's installation plan now truthfully says
  `CANDIDATE_PREPARED_NOT_INSTALLED`; its previous version is retained.

Actual receipts are under `dsh2-candidate-evidence/` and on DSH2 in the preparation
area. No image/archive payloads or private key material are committed to Git.

## Operator verification — read-only

```sh
sudo python3 /usr/local/lib/alica-setup-onboarding1/setup.py verify \
  --destination /var/lib/alica/dsh2-internal-onboarding1/candidate
```

Next is a separately authorized install into the reserved root, followed by
service/TLS qualification and private owner/provider onboarding. QA signature
admission does not imply schema compatibility, provenance/licensing completion,
production approval or fresh-install acceptance.
