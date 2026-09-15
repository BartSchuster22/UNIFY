# Onboarding1 fresh-install package — Step 1 completed

**Current deployment checkpoint:** [Step 3 installation completed](DSH2_INSTALLED.md); all seven services and public HTTPS verified. Private owner/provider onboarding remains pending. Below is the original packaging checkpoint.

**Subsequent checkpoint:** Step 2 delivery and bootstrap admission on DSH2 have now completed; see [DSH2_CANDIDATE_PREPARED.md](DSH2_CANDIDATE_PREPARED.md). The scope/next-boundary statements below record the Step 1 checkpoint. Installation and service startup are still pending.

Built and verified on ALICA-v1 on 2026-09-15. No DSH2 transfer, installation,
service start, public distribution, or licensing review was performed.

## Artifact and immutable identities

- Build source: `599b70981c30779b3383dc5e625b97775723994b` (clean isolated worktree).
- Runtime package directory: `/var/lib/alica-dsh-internal/onboarding1-runtime` on ALICA-v1.
- Archive: `internal-onboarding1-599b7098-linux-amd64.tar.gz` (1,649,300,836 bytes).
- Archive SHA-256: `37ac2bbf89ef0b37bfd80b92d14e013b5b7b6244d8b0cdf44f42c3873c4dcaf0`.
- Release SHA-256: `8fecaecb87f92a47a9ea427965f79525095f9b9567e92dedf6d03d403147b204`.
- Trust SHA-256: `ac6d836bb5cd3efa6ab15832e574f1b5455aabff4273bc99331dfa7f43b5e1ac`.
- Scope: **qa**, fresh predecessor zero, sequence 1. This is internal engineering
  admission, not production trust or licensing approval.
- Signature expires **2026-09-22 13:28:37 UTC**. Respect expiry: do not change
  target clocks, scope, or verifier checks. Later admission needs a properly
  reissued envelope and another verification.

## Actual execution evidence

- All **52 tests passed** as root on ALICA-v1 (no skips). Includes eleven new
  export/budget tests using explicit fixtures, plus existing bootstrap/onboarding tests.
- Real Docker export of exactly seven current healthy dev3 image IDs: 4,118,730,752 bytes.
- Every exported config and ordered layer diffID verified; OCI manifest descriptors
  derived from exported bytes, not inherited from outdated metadata.
- Twenty archive members verified by complete compressed readback.
- Actual bootstrap extracted the real archive; independent admission accepted
  all twenty extracted artifacts with the pinned external verifier and QA trust.
- Tampered-envelope and production-scope attempts both rejected.
- Packaged Python members compile; known QA identity/topology markers absent
  from template/framework configuration. No mounted state was exported.
- All **99 existing container identities, image assignments, running flags,
  start timestamps, and restart counters** matched before and after the whole run.
- ALICA-v1 final free space: **8.111 GiB**. The extra verification extraction left
  **4.267 GiB free** when checked, above the 3 GiB reserve. That temporary extracted
  copy was removed after verification; the original bundle and archive remain.

See `onboarding1-package-evidence/` for actual build/independent verification
receipts and signed envelope. Large image/archive bytes stay on ALICA-v1, not
in Git. Signing material is separate in a root-only publisher directory, not in
this bundle, archive, Git, or DSH2.

## Verification-path issue caught and resolved

The bootstrap initially rejected the verifier in the source worktree because
`/srv/alica-dsh-development` is not wholly root-owned. This was a correct denial.
The exact verifier bytes (SHA-256
`62f39860a259a76721068b23140eca846def5acca5b728fbab26518576722547`)
were placed in the root-owned publisher directory outside the extraction.
The same completed extraction then passed admission. No permission guard was
weakened, no development-parent ownership changed, and no invalid package was
admitted. Future target admission must use the prepared root-owned bootstrap and
separately provisioned, independently pinned public trust.

## Limits and next boundary

The package is mechanically complete and authenticated for fresh-install
engineering **testing**, not accepted as a working fresh installation. Registry
availability, image-build reproducibility, schema compatibility, end-to-end
owner/provider onboarding, public TLS, licensing and production acceptance are
not implied by its signature.

Step 2 remains: securely deliver the archive and envelope to the separate DSH2
namespace, provision only public QA trust through an authenticated operator
channel, then run supported bootstrap admission. Never copy the private signing
key or use trust bundled inside the runtime candidate as its own authority.
The bootstrap uses HTTPS prepare; its authenticated delivery route must be
arranged without disabling TLS or signature checks. Installation/start and human
onboarding remain separate subsequent work.

Stage 7.4 licensing candidate, evidence and required originals remain protected.
