# Stage 7.4 — licensing discovery and unresolved release gate

**BLOCKED / IN PROGRESS. Not licence clearance. No change to Stage 7.1–7.3's bounded QA verdict.**

Stage numbering follows PROJECT-ALICA's versioned rebuild master plan: 7.4 is commercial licence/source/enforcement and third-party compliance with appropriate legal review; the earlier conversational list numbered these differently.

## Current engineering continuation — original QA4 reinspection

**Current missing metadata: 91. Engineering remains incomplete.** The earlier SSH blocker below is historical and resolved: the existing `/home/herman/.alica-provider-access/dsh2-stage7-known-hosts` record verifies DSH2 under strict checking. Do not use the outdated `.ssh/dsh2_known_hosts` file for Stage7.

- `original-review/inspection.json`: read-only, repeated inspection of the exact original candidate archive and every unpacked bundle member; release identity, eight image identities and all **125 layer digests** checked. **98 requested original file records** retained, including bounded nested JAR metadata. Non-regular locations remain unresolved, not silently dereferenced through the host. All eight QA containers remained stopped with identical IDs/images/start/finish/restart/mount state. No remote files were created, no workload started, no recovery material changed.
- `bind_original_maven.py`: **33** Java occurrences have byte-identical upstream JARs and replayable exact-coordinate POM/parent declarations. The original scanner PURL is preserved; corrected coordinates appear separately as `verifiedMavenPurl`. Filename-derived coordinates are only lookup candidates until the entire upstream JAR's SHA-256 and size match every original occurrence. Embedded shaded dependency POMs are not substituted for the enclosing JAR identity. Binary JARs are streamed for comparison, not added to this repository; POM sources and matching receipts are retained. `--verify-live` repeats the upstream binary comparisons; offline verification replays retained declarations and receipts.
- `match_original_bsd.py`: **17** additional Go metadata occurrences have full-body BSD text observations from already hash-verified exact-coordinate upstream archives. Only whitespace/list markers, conventional copyright headers, HOLDER/OWNER disclaimer wording, and the explicit Google LLC/Google Inc. non-endorsement name variants are tolerated. Additional or changed clauses fail. This does not prove binary/source equivalence or infer a module-wide AND/OR expression.
- `original-bsd-review/` is the latest queue, summary and per-occurrence gap list. Remaining: **34 binary, 28 Go, 18 npm, 6 Debian, 2 Java, 2 Python, 1 APK**. Original npm manifests inspected here lack licence declarations; `private`, test/example location, or a colliding public package name does not supply permission. Java `jrt-fs` and `quarkus-run` are not normal repository-named Maven libraries and were not force-mapped.
- `review-handoff-v3/` uses this latest queue; historical handoffs remain replayable. Engineering blockers are separated from legal identity/review, which remains outside this engineering task.

**85 tests pass with Python 3.11** (the system Python 3.10 cannot import the existing TOML collector). Full original replay, live Maven byte checks, derived evidence and old/new handoff replays pass. Actual verification output is retained in `verification-original-review.txt`.

Reproduce from this directory:

```sh
python3.11 -m unittest discover -s . -p 'test_*.py' -v
python3.11 bind_original_maven.py --verify-live
python3.11 match_original_bsd.py --verify
python3.11 build_review_handoff.py review-handoff-v3 --original-review --verify
# New local output only; remote inspection never writes or executes image contents.
python3.11 run_original_inspection.py /tmp/stage74-original-reinspection.json --compare original-review/inspection.json
```

**Not completed:** the 91 enumerated metadata gaps; package-specific complete notices/corresponding-source/build/relink evidence and delivery dispositions across the shipped inventory. Metadata observations do not complete these duties. `engineeringComplete`, `stage74Accepted` and production-distribution clearance remain false. This task did not rebuild/repackage the qualified candidate or alter its licence policy.

## Historical engineering-only continuation — 2026-09-12, 22:41:15 UTC

Legal identity/reviewer selection is explicitly outside this requested engineering scope. `shipped-python-review/` binds two `agent-client-protocol` occurrences to an exact Apache licence text in their shipped `.dist-info` directory and authenticated layer, including the exported image-local hardlink resolution. Missing metadata: **141**. The matcher checks distribution name/version, image/layer membership, path boundaries and text hashes. **63 tests pass**, full exported-evidence/shipped-text replay passes, and an asserted `engineeringComplete=true` is rejected. Actual output: `verification-shipped-python.txt`.

```sh
python3.11 -B dsh/rebuild/stage7/licensing/match_shipped_python.py dsh/rebuild/stage7/licensing/shipped-python-review --verify
```

**Engineering is not complete.** Original-artifact reinspection and remaining package-specific provenance/notice/source/build/relink dispositions remain outstanding. On this continuation strict SSH to QA `95.216.216.143` using `/home/herman/.ssh/dsh2_known_hosts` failed (exit 255): the endpoint presented ED25519 fingerprint `SHA256:tmJYI0gPITiGFQ9vRcEbacVu5jBsh24YtJic/1ICiFg`, which does not match that file or the other available test-host trust record. This is an observed, **not authenticated**, fingerprint. No host-key bypass, trust-record replacement, remote writes or workload changes occurred. The prior fresh-OS trusted connection described in historical records has not been re-established in this continuation. A verified console fingerprint or verified original release archive is needed for that access path; offline evidence recovery is not a substitute for original-artifact inspection.

## Preceding continuation — 2026-09-12, 22:24:28 UTC

`go-text-review/` adds conservative exact normalized text matching against retained, hash-bound SPDX MIT/Apache-2.0 templates. Apache requires whole-text equality; MIT permits customary copyright/title header variation and requires exact normalized grant/conditions/disclaimer text. Added restrictions, changed bodies and headings alone are rejected. **88 additional inventory records now have observed upstream licence-text metadata; 143 remain missing metadata.** No module-wide AND/OR expression, binary equality or legal clearance is inferred; nested exceptions and obligations remain unreviewed.

`review-handoff-v2/` uses this later queue. The original review handoff remains reproducible without the new flag. All **54 tests pass** on Python 3.11; exact-text verifier and both handoff replays pass. Actual output: `verification-go-text.txt`.

```sh
python3.11 -B dsh/rebuild/stage7/licensing/match_go_licence_texts.py dsh/rebuild/stage7/licensing/go-text-review --verify
python3.11 -B dsh/rebuild/stage7/licensing/build_review_handoff.py dsh/rebuild/stage7/licensing/review-handoff-v2 --go-text --verify
```

Stage 7.4 is not accepted. Engineering dispositions, final legal identity/contact and appropriate legal review remain outstanding. No runtime or existing-grant mutation.

## Preceding continuation — 2026-09-12, 22:13:05 UTC

- `uv-workspace-review/`: 68 retained sources at upstream commit `65950801cc3c609b65be34938bb407ab6e30a9fe` (observed tag `0.11.6`). Exact crate name/version and workspace/direct declarations recovered for **122 records**. Current missing metadata: **231**. `uv-pep440` and `uv-pep508` declare `Apache-2.0 OR BSD-2-Clause`, not the workspace's `MIT OR Apache-2.0`; their local texts are retained and tested.
- `go-notice-review/`: 133 exact coordinates assessed; 127 full upstream archives retained with 150 notice candidates. Three archives exceed the bounded 8 MiB collector limit; three coordinates are missing versions/non-public. No guessed coordinate substitution. Filename-based candidates do not reduce the metadata gap or prove distribution compliance.
- `review-handoff/`: reproducible 3,689-record pending-disposition worksheet, Go notice candidates, status and integrity manifest. This is **not** an approved product NOTICE/source bundle or release gate clearance. Local npm/workspace names are not mapped to public name collisions. Shipped identity, complete source/build/relink requirements and legal review remain open.
- Verification: **45 tests pass on Python 3.11**, all three offline replays pass, and actual handoff CSV tampering is rejected. Output: `verification-continuation.txt`. The initial full-suite run on system Python 3.10 failed on the existing Rust collector's `tomllib` import; rerunning with installed Python 3.11 succeeded. The uv collector's initial inheritance-only assumption failed closed on the two crate overrides; explicit declarations and local texts were then supported and regression-tested.
- No QA-host access, runtime mutation, existing grant change or Stage 7.5 publication. Personal ownership and prospective institutional succession are addressed in PROJECT-ALICA's substantive review draft; no future institution is represented as an existing owner.

```sh
python3.11 -B -m unittest discover -s dsh/rebuild/stage7/licensing -p 'test_*.py' -v
python3.11 -B dsh/rebuild/stage7/licensing/collect_go_notices.py dsh/rebuild/stage7/licensing/go-notice-review --verify
python3.11 -B dsh/rebuild/stage7/licensing/collect_uv_workspace.py dsh/rebuild/stage7/licensing/uv-workspace-review --verify
python3.11 -B dsh/rebuild/stage7/licensing/build_review_handoff.py dsh/rebuild/stage7/licensing/review-handoff --verify
```

Earlier counts below are historical. Stage 7.4 remains unaccepted, not merely waiting for an institutional body to exist.

## Preceding registry continuation — 2026-09-12

`registry-review-v2/` supersedes the first registry attempt (`registry-review/`, retained for comparison), not the immutable image/Rust collection below. It queried 187 exact Maven/PyPI coordinates and recovered upstream declarations for **164 additional software records**, leaving **353** without metadata. Maven parent chains and PyPI responses are retained verbatim with URL/content hashes. Ten parser and real-evidence negative tests passed; offline verification rehashed 201 responses, replayed 152 successful/no-declaration results and checked the entire derived queue against the prior input.

The first attempt exposed namespace-free Maven POMs and a concurrent content-cache rewrite hazard; both were corrected before a fresh run. Unresolvable/scanner-derived Maven coordinates remain explicit, not guessed. Registry declarations do not prove equality with shipped binaries, complete source delivery or legal clearance. First-party/local packages were not silently mapped to public packages. No QA-host access or runtime mutation was required for this continuation.

```sh
python3 -B dsh/rebuild/stage7/licensing/verify_registry_metadata.py dsh/rebuild/stage7/licensing/registry-review-v2
python3 -B -m unittest discover -s dsh/rebuild/stage7/licensing -p test_registry_metadata.py -v
```

Stage 7.4 remains unaccepted: technical obligations, exact commercial terms/rightsholder authority, appropriate legal review and a new approved assembly remain required. The earlier counts below describe the preceding collection, not the latest unresolved count.

## Current verified collection

`current-qa4/summary.json` is the current technical observation, backed by two digest-bound archives and `verification.txt`:

- Fresh SPDX SBOMs for **all eight exact QA4 images**, including Core and the reference application. All shipped layers were scanned using the retained, SHA-256-pinned Syft 1.51.1 binary. Online scanner enrichment was disabled.
- **3,697 SPDX package occurrences / 3,689 software records**. These are not globally unique dependencies; eight SPDX image-envelope records are separate from software records.
- **125 shipped layers**, **2,057 notice candidates**, **985 unique image-notice contents**, and **267 image-specific resolved references**. The final bounded extraction found zero unresolved extraction items. Filename matching, bounded nested archives and reference resolution do **not** prove full notice coverage or fulfilment of obligations.
- **444 exact crates.io versions** fetched with public coordinates explicitly observed as registry-origin; source archives matched registry SHA-256 checksums and Cargo manifest name/version. Metadata and source/licence evidence are retained. This supplied licence metadata for **888 software occurrences**, reducing the fresh scan's missing-metadata count from **1,405 to 517**. The 122 non-registry Rust occurrences were not guessed or silently mapped to registry packages.
- **511 heuristic copyleft-review signals**, not findings of incompatibility or source obligations. OR expressions and component/build context require review; no permissive branch was silently selected.
- **13 delivered host-code files** individually hashed, with corrected complete Python import-root observations in the derived inventory. No legal grant is inferred from possession of their source.
- Twelve collector/discovery fixture tests and three real-export negative tests passed. Independent local verification rehashed exported SBOMs, image notices, upstream source archives and registry metadata. Tampered summary/archive pins and asserted legal clearance are rejected.
- Original manifest-bound bundle members and Docker container/image state were rechecked unchanged. QA remained quiesced. No candidate, EULA, entitlement, service or public route was modified.

`review-evidence.tar.gz` contains SBOMs, receipts, candidate notice texts, a per-record review queue and derived host inventory. `rust-sources.tar.gz` preserves the exact fetched upstream archives and registry responses. These are **private review evidence**, not an approved product compliance package, a complete corresponding-source delivery, or a new release assembly. Private image configuration and owner/container snapshots are deliberately excluded.

Collections were executed on DSH2 under `/var/lib/alica-stage74-licensing`: `run1`, initial `notices-run1`, refined `notices-run2`, final `notices-run3`, `rust-upstream-run1`, and `verified-run1`. Earlier attempts remain retained. Directory candidates were removed from gap accounting, larger Chromium licence text recovered, shared notice references resolved within authenticated image layers, and OCI whiteout handling fixture-tested before the final rerun.

## Historical discovery (superseded for current SBOM coverage)

`audit.py` verifies the actual retained QA4 downloadable archive, hashes every bundle member, verifies the release manifest, compares runtime images with fresh-OS evidence, preserves the accepted EULA hash, and only reuses prior observed SBOMs when both image identity and SBOM digest match. `discovery.json` is the resulting package-occurrence inventory. This is not a fresh scanner run or a legal assessment.

- Six runtime-image SBOM observations match; Core's old image differs and is rejected.
- Matching inventories contain 3,499 package occurrences, not unique dependencies. 1,388 lack usable declared/concluded licence metadata. 413 carry a heuristic copyleft review signal. Neither category proves infringement, incompatibility, or a missing source obligation; all require investigation and evidence-based disposition.
- No top-level licence/notice/SBOM file occurs in the inspected archive. Embedded image notices and any separately delivered materials have NOT been fully assessed.
- Five top-level first-party Python source members are delivered. A binary-only/confidentiality statement cannot substitute for explicit rights covering delivered readable code.
- The retained v1.0 EULA hash remains `3b172e3850816750ff7b5a7d6d4b9f311f5c745159e201f42fea647c4dad1f3c`. Its free internal-commercial grant is historical and must not be retroactively revoked by the new product direction.

## Blocking work and owners

| ID | Owner | Closure evidence |
| --- | --- | --- |
| L74-01 | Stakeholder + legal reviewer | Approve a newly versioned commercial/non-commercial definition, evaluation rules, agencies/client installations/hosting rights, licence unit/term, and transition preserving existing grants. DSH-1 already requires a commercial-use licence; exact terms remain undecided. |
| L74-02 | Stakeholder + legal reviewer | Restricted first-party repository direction is approved. Finalize actual delivered-source modification/redistribution and SDK/application-development grants, preserve third-party rights, and confirm licensor/rightsholder authority. |
| L74-03 | Stakeholder + engineering | APPROVED: contractual enforcement without mandatory activation, licensing call-home or runtime kill switch. Preserve independent DSH; no entitlement system or PSI-only hosting restriction is authorized. Integration verification remains tied to the future approved assembly. |
| L74-04 | Engineering/compliance | Exact eight-image scans, reference binding and 13-file host inventory collected. Resolve the remaining 517 missing-metadata software records and assess scanner/asset coverage limits; no claim of a legally complete distribution bill of materials. |
| L74-05 | Engineering/compliance + legal reviewer | Extract/review actual copyright/licence/NOTICE texts and corresponding-source/build/relink obligations as applicable; document every disposition; deliver legally sufficient sources/offers where required. An SBOM or upstream URL alone is not proof of compliance. |
| L74-06 | Legal reviewer + stakeholder | Review the exact proposed terms and distribution bill of materials, record reviewer/date/version/digests/scope and unresolved exceptions. Automated inventory and AI drafting cannot stand in for this approval. |
| L74-07 | Release engineering | Assemble immutable newly versioned legal materials and their manifest hashes after approval. Preserve existing archive/signatures/grants; do not silently rewrite a published release. Stage 7.5 publication and production cutover remain separate gates. |

Public QA downloads also require applicable distribution compliance; a QA label is not a legal exemption. Existing public candidate disposition requires explicit evaluation, not an automatic destructive takedown or retrospective grant amendment.

## Decisions requested

Keep the approved private/non-commercial-free and commercial-licence-required product direction, restricted first-party repository, and contractual enforcement without activation. Final agency/managed hosting rights, delivered-code permissions, licence term/unit and rightsholder authority still need explicit approval and appropriate legal review. Existing grants and third-party rights remain preserved.

## Reproduce

For the current collected evidence, from UNIFY:

```sh
python3 -B dsh/rebuild/stage7/licensing/verify_export.py dsh/rebuild/stage7/licensing/current-qa4
python3 -B -m unittest discover -s dsh/rebuild/stage7/licensing -p 'test_verify_export.py' -v
```

The Rust collector and its fixture tests require Python 3.11+ (`tomllib`); the recorded collector tests ran on DSH2's Python. Collectors are single-run, pinned QA audit recipes with fresh output directories, not production services. Do not rerun them against populated output directories or substitute an unverified SSH host key.

To reproduce the **historical predecessor comparison**, not the current scan:

```sh
python3 -B dsh/rebuild/stage7/licensing/audit.py --archive /path/to/dsh-stage7-qa4-72297c3-linux-amd64.tar.gz
python3 -B -m unittest discover -s dsh/rebuild/stage7/licensing -p 'test_*.py' -v
```

Discovery writes `discovery.json` and returns zero only for completed discovery. `--check-ready` deliberately returns 2: this discovery-only tool cannot issue legal or production clearance. It is **not integrated into the production publication pipeline**, nor a completed Stage 7.4 acceptance validator. Missing inputs/hash failures abort the audit. The first run failed because Python lacked `hashlib.file_digest`; streaming SHA-256 replaced it and the full archive rerun completed, with readiness rejected as intended.

No candidate archive, existing licence, deployed service, DNS, commercial entitlement or production route was modified.
