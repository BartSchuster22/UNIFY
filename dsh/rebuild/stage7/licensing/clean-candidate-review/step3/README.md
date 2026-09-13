# Step 3 — grouping complete; applicability review remains open

This is a **verified partial assessment**, not completion of user closure Step 3.
Steps 1–2 remain complete and their frozen inputs are unchanged.

## Authoritative outputs

- `STATUS.md` / `summary.json`: current counts and explicit completion flags.
- `group-obligations.csv`: spreadsheet-friendly group decisions. Text cells that
  could be interpreted as spreadsheet formulas are escaped.
- `groups.json`: full identities, licence expressions, chosen alternatives,
  conservative notice policies, contextual fingerprints, requirements and issues.
- `occurrence-to-group.json`: every frozen occurrence assigned exactly once.
- `blockers.json`: individual remaining reviews, not findings of infringement.
- `native-linking-evidence.json`: observed ELF edges and possible provider owners.
- `inputs.json`: byte hashes for input evidence, implementation and generated outputs.
- `verification-tests.txt`: actual full-suite execution output.

## Grouping and decision boundaries

Component families retain type, name, version and full package coordinate. A family
is not one universal obligation decision. Contextual groups additionally bind
retained payload bytes, notices, licence decisions, distribution category and
incoming/outgoing native-linkage fingerprints. Different versions, bytes, notices
or observed native contexts are not collapsed merely because package names match.

Every occurrence remains addressable by image and artifact ID. ELF DT_NEEDED and
SONAME observations are **not** complete loader resolution, proof of runtime use,
or proof that dlopen/static incorporation is absent. Installed static archives
are not automatically evidence that an application linked them. No inspected
payload was executed.

The requirement matrix distinguishes notices, corresponding source, build
instructions and relinking/replacement, together with named licence conditions.
`not-required` is a bounded applicability decision with a reason, not fulfilment
or release clearance. LGPL does not receive an automatic exemption just because
it is dynamically linked or packaged as a JAR. Copyleft is not spread to an entire
container merely because components share that container.

Explicit OR choices remain distinct from AND, WITH and ambiguous legacy strings.
Known additional permissive notice terms can be retained cumulatively as an
explicit conservative delivery policy; this is not an invented SPDX AND or
reassignment of every file's licence. Unresolved custom, mixed, exception and
content-specific scopes remain open. Some open items require further evidence;
others require manual applicability review of evidence already retained. These
are not all external blockers, licence violations, or newly missing metadata.

## Evidence collected

`../step3-context.json` binds package ownership and native header observations to
the frozen layer hashes and exact scanner inputs. Package-manager inventories,
dpkg file lists, installed Python records, editable source roots and npm package
roots are distinguished. Empty ownership does not by itself prove absent code.

`../step3-text-review/report.json` contains supplementary ScanCode recognition of
1,299 existing UTF-8 text documents, including matched spans and SPDX suggestions.
Recognition is **not** a decision about which installed files a clause governs.
Additional full licence texts cannot silently disappear behind a primary metadata
label. Binary/non-UTF-8 material is not claimed to have been text-recognized.
The recorded matcher version and environment are retained with the report.

`../step3-gsap/report.json` retains the exact GSAP 3.15.0 registry/archive evidence,
publisher licence page and incorporated Webflow terms. The evaluator verifies
all retained GSAP package files against that exact archive. The publisher's FAQ
expressly permits AI-generated GSAP code and commercial projects. Restrictions on
competing visual animation builders, proprietary notices and branding remain.
The standalone SDK redistribution question is flagged for a scoped legal
determination or publisher clarification; no prohibition or permission is invented.
A mutable current URL is not proof of historical contract acceptance.

## Replay and gates

From the licensing directory:

```sh
python3.11 build_step3_obligations.py --verify
python3.11 -m unittest discover -p 'test_*.py' -q
python3.11 freeze_clean_candidate.py --live
python3.11 resolve_step2_records.py --verify --require-complete
python3.11 build_step3_obligations.py --verify --require-complete
```

Ordinary replay and tests pass. The last command must return **exit 2** while
applicability reviews remain open. Do not interpret passing tests as completion
of those reviews. Offline replay uses retained evidence and does not need the
ScanCode environment or new upstream requests. Re-collecting evidence is a
separate explicit action, not part of replay.

No Step-4 obligation fulfilment, Step-5 requalification, commercial/legal approval,
new first-party grant, image rebuild, retagging or runtime activation is claimed.
