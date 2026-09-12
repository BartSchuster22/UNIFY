# Stage 7.4 — licensing discovery and unresolved release gate

**BLOCKED / IN PROGRESS. Not licence clearance. No change to Stage 7.1–7.3's bounded QA verdict.**

Stage numbering follows PROJECT-ALICA's versioned rebuild master plan: 7.4 is commercial licence/source/enforcement and third-party compliance with appropriate legal review; the earlier conversational list numbered these differently.

## Executed discovery

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
| L74-02 | Stakeholder + legal reviewer | Decide first-party repository source publication and actual delivered-source rights, including modification/redistribution and SDK/application-development grants. Preserve third-party rights and mandatory source availability. Confirm licensor/rightsholder authority rather than inferring ownership from repository access. |
| L74-03 | Stakeholder + engineering | Approve enforcement design. Recommendation only: contractual compliance without mandatory central activation, telemetry, call-home or runtime kill switch; preserve independent DSH. Offline signed entitlement is an alternative with additional implementation/testing scope. No PSI commercial-service restriction is silently inherited or invented. |
| L74-04 | Engineering/compliance | Scan exact QA4 Core, independently bind/reference-scan the application image, cover host-side installer/Doghouse and all delivered code; resolve package metadata using exact upstream/distributed materials, not guessed licences. |
| L74-05 | Engineering/compliance + legal reviewer | Extract/review actual copyright/licence/NOTICE texts and corresponding-source/build/relink obligations as applicable; document every disposition; deliver legally sufficient sources/offers where required. An SBOM or upstream URL alone is not proof of compliance. |
| L74-06 | Legal reviewer + stakeholder | Review the exact proposed terms and distribution bill of materials, record reviewer/date/version/digests/scope and unresolved exceptions. Automated inventory and AI drafting cannot stand in for this approval. |
| L74-07 | Release engineering | Assemble immutable newly versioned legal materials and their manifest hashes after approval. Preserve existing archive/signatures/grants; do not silently rewrite a published release. Stage 7.5 publication and production cutover remain separate gates. |

Public QA downloads also require applicable distribution compliance; a QA label is not a legal exemption. Existing public candidate disposition requires explicit evaluation, not an automatic destructive takedown or retrospective grant amendment.

## Decisions requested

Keep the accepted private/non-commercial-free and commercial-licence-required direction. Select a first-party source/enforcement policy and supply/arrange the appropriate legal review. Suggested starting point, **not accepted terms**: full repository source remains restricted, actual shipped readable code is expressly covered by the new grant, required third-party sources remain available under their licences, and enforcement is contractual/offline. Agency/managed hosting rights and commercial licence term/unit must be made explicit before drafting final grants.

## Reproduce

From the UNIFY repository:

```sh
python3 -B dsh/rebuild/stage7/licensing/audit.py --archive /path/to/dsh-stage7-qa4-72297c3-linux-amd64.tar.gz
python3 -B -m unittest discover -s dsh/rebuild/stage7/licensing -p 'test_*.py' -v
```

Discovery writes `discovery.json` and returns zero only for completed discovery. `--check-ready` deliberately returns 2: this discovery-only tool cannot issue legal or production clearance. It is **not integrated into the production publication pipeline**, nor a completed Stage 7.4 acceptance validator. Missing inputs/hash failures abort the audit. The first run failed because Python lacked `hashlib.file_digest`; streaming SHA-256 replaced it and the full archive rerun completed, with readiness rejected as intended.

No candidate archive, existing licence, deployed service, DNS, commercial entitlement or production route was modified.
