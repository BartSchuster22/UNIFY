# Clean candidate 1 — frozen; initial 34 metadata findings resolved

## Approved conservative delivery policy — implemented, not fulfilled

The [approved conservative delivery ledger](step3-delivery-policy/README.md)
assigns every frozen occurrence a delivery route, separating extra policy
material from unchanged legal-assessment requirements. It preserves permission,
compatibility, ownership, content and first-party authority holds. No source
publication, image change or distribution clearance is authorized by the policy.
The underlying Step 3 scope assessment remains open.

## Step 3 continuation — still open

The [Step 3 evidence and obligation review](step3/README.md) now accounts for every
frozen occurrence and records bounded decisions plus explicit remaining reviews.
Its [generated status](step3/STATUS.md) is authoritative for Step 3. Grouping and
passing tests do not mean applicability review or engineering compliance is done.
Steps 1–2 below remain complete; their frozen metadata evidence is unchanged.

## Authoritative current status

**Only closure steps 1 and 2 are complete. Stage 7.4 engineering, legal acceptance,
and full-stack requalification are NOT complete. No production release is approved.**

- Candidate: eight cleaned Linux/amd64 images on DSH2,
  `/srv/alica-stage74-clean-candidate1`.
- Write-once content lock: [steps12/candidate-lock.json](steps12/candidate-lock.json).
- Lock SHA-256: `3262d4a212d2edbd336c25bdb189ed03c31c8af207b9e301ebd6ca4a675ad58d`.
- Current metadata verdict: [steps12/current-metadata-status.json](steps12/current-metadata-status.json).
- Per-record decisions: [steps12/INDIVIDUAL-RECORDS.md](steps12/INDIVIDUAL-RECORDS.md)
  and [steps12/individual-records.json](steps12/individual-records.json).
- Actual notice/metadata evidence: `steps12/metadata-evidence.tar`, with per-document
  SHA-256 references in each decision. Inputs and derived-output hashes are in
  `steps12/resolution-inputs.json`.

The original `candidate-metadata-gaps.json` (34), `candidate-summary.json`, and
`candidate-package-evidence.json` are the **pre-Step-2 baseline**, retained rather
than rewritten. The scanner's raw missing-declaration count is also historical
input, not the current manually evidenced metadata count. Downstream obligation
assessment must consume the frozen baseline **plus the individual-records overlay**;
it must not treat the baseline's 34 as current, or the overlay as obligation approval.

## Bounded acceptance checklist

- [x] Step 1: freeze the exact eight image IDs, archive/layer hashes, transformations,
  build receipt and all-layer inventory. Creation refuses to overwrite a lock.
- [x] Live verification: candidate files, image tags/configurations and layers still
  match; original QA container state unchanged before and after verification.
- [x] Step 2: all **34** initial metadata findings have individual evidence-backed
  dispositions; **0** remain unidentified in that scope.
- [x] Full licensing test suite: **200 tests passed**. Actual output is retained in
  `steps12/verification-tests.txt`.
- [x] Deterministic Step-2 replay passes; tests reject changed locks, changed findings,
  changed source notice bytes, altered binary identity and forged completion flags.
- [ ] Step 3: determine component/linking/distribution-specific obligations, grouping
  repeated components only where their situations genuinely match.
- [ ] Step 4: close applicable requirements against delivered materials; justify N/A.
- [ ] Step 5: complete required change-impact integration/regression qualification.
- [ ] Full Stage 7.4: engineering closure plus finalized terms and appropriate legal review.

Publishing this bounded evidence checkpoint does not mean later closure steps or
Stage 7.5 production publication have been performed.

## How the records were resolved

The individual table is exhaustive. Important distinctions:

- Go dependency notices are tied to their exact module archives; archive `h1`
  checksums are checked against compiler metadata in the frozen Caddy executable.
  Multi-licence documents are not collapsed to their first licence block.
- Caddy's generated main-module/pseudo-version record is identified as the Caddy
  2.10.2 distribution using compiled module identity and the vendor declaration.
- All three Node occurrences match exact upstream release executable bytes. Complete
  Node licence bundles are retained, not a blanket MIT-only claim. TLS/vendor hashes
  were checked; detached-signature verification is **not** claimed.
- Hindsight installed client payload matches both the exact published wheel and
  tagged source tree. The release omitted wheel licence metadata; its matching
  source supplies the MIT declaration.
- Docker CLI and JRT filesystem records are tied to the installed package manager's
  owning packages by matching file digests. Conditional OpenJDK exceptions are
  preserved, **not automatically granted to every file or linking situation**.
- CPython retains its complete licence/history bundle. PostgreSQL version/header
  evidence is paired with the exact release copyright. Gosu matches its release binary.
- The Quarkus launcher is proved manifest-only; the apk runtime-dependency record is
  proved zero-payload and owns no files. Neither classification exempts dependencies.
- Four Aquiero occurrences are first-party restricted packages. Their manifests match
  the repository and its existing proprietary declaration. This is not SPDX Unlicense,
  a new grant, or proof of exact rebuild-source correspondence. Hermes' WhatsApp bridge
  instead carries the shipped Hermes repository's MIT scope.

`LicenseRef-*` runtime entries name the supplied complete distribution terms, with
raw bytes and scope in the individual records. They are **not unknown placeholders**,
a declaration that all embedded code has one licence, or a completed applicability
assessment. The per-file/mixed/conditional requirements remain for Steps 3–4.

**Retained legal hold:** the historical first-party notice names ALICA Ltd. Its
existence/authority is not validated by this review. Final licensor wording must be
corrected/finalized separately; no licence activation, owner substitution, or change
to existing grants has been made.

## Replay

From `dsh/rebuild/stage7/licensing`:

```sh
python3.11 freeze_clean_candidate.py
python3.11 resolve_step2_records.py --verify --require-complete
python3.11 -m unittest discover -p 'test_*.py' -q
```

`--require-complete` on the Step-2 resolver checks **only these two steps**, not full
7.4. The output explicitly leaves engineering, legal and full-stack acceptance false.

On the authorized workstation, live read-only pin/preservation verification is:

```sh
python3.11 freeze_clean_candidate.py --live
```

Acquisition scripts document the real extraction/download paths. Upstream full Node,
wheel/sdist, gosu and compress downloads are cached outside Git; relevant statements,
file identities and acquisition receipts are retained here. Exact image archives and
large Debian source materials remain on the QA host; this directory does not publish
private container inspection files or production credentials.
