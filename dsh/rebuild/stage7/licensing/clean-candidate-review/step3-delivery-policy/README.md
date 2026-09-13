# Approved conservative third-party delivery policy

The user approved conservative source/build provision for ordinary mixed OS/runtime bundles, with targeted exact review where over-delivery cannot resolve an issue.

## Implemented decision

Every frozen assessment group has a delivery route. The original legal-assessment records, licence expressions, evidence, blockers and group identities are unchanged. Policy measures are **not reclassified as proven legal duties**.

| Route | Groups |
|---|---:|
| Conservative third-party bundle | 538 |
| Follow existing assessment | 2,440 |
| Follow existing assessment, retain targeted holds | 191 |
| First-party source protected | 3 |
| Proven zero-payload descriptor | 1 |

All **3,352 occurrences / 3,173 groups** are covered. Conservative provision applies to **631 occurrences**. Counts are reproducible in `summary.json`.

For conservative bundles, plan exact third-party component source, downstream patches, build/install/control material and complete scoped notices. Where covered library replacement may be required, demonstrate a suitable replacement route or supply the applicable relink material. An ELF dependency list is not a replacement test. Any implication for proprietary application material must be escalated, not published automatically. Installation-information applicability is not presumed absent.

Non-ordinary bundles retain their existing decisions and targeted review requirements. Existing Apache, advertising, network-source, content and other specific requirements remain in the records and action list. No whole-container source dump is authorized.

## What is not completed

This is a delivery **plan**, not source fulfilment or legal clearance. No source package has been acquired, rebuilt, delivered or published by this operation. No images or production configuration were changed.

The underlying Step 3 assessment still has **660 open occurrences / 590 groups**. The plan does not turn those into cleared legal assessments. Full-file minimum-source analysis is no longer needed to justify *extra policy provision*, but valid grants, restrictions, ownership and actual combination compatibility still require evidence.

`targeted-holds.json` contains per-group questions with component/version, occurrence and notice-hash references. It additionally surfaces existing compatibility and first-party-authority acceptance requirements. **776 groups** have a hold or acceptance prerequisite; this larger number is not a new infringement count or a replacement for the original 590 open assessment groups. Categories overlap.

No policy can cure a missing redistribution grant, an incompatible combination, an inapplicable exception, content restrictions or missing ownership proof. Both binary and proposed source delivery require appropriate rights. GSAP’s standalone-bundle permission question remains held.

## Evidence and use

- `delivery-ledger.csv`: human-readable delivery routes, legal source applicability, extra policy measures and holds.
- `delivery-decisions.json`: complete per-group decisions, unchanged legal requirements and original blockers.
- `policy.json`: scope and authorization limits.
- `targeted-holds.json`: remaining questions and acceptance prerequisites.
- `receipt.json`: hashes binding the entire original assessment, policy implementation, tests and generated outputs.
- `verification-tests.txt`: **249 passing tests**, including 14 policy tests.

Offline regeneration/replay:

```sh
python3.11 build_step3_delivery_policy.py
python3.11 build_step3_delivery_policy.py --verify
python3.11 build_step3_delivery_policy.py --verify --require-clearance
```

The last command must return **2**: assignment completeness is not distribution authorization. Tests check exact membership, unchanged legal duties/blockers, protected proprietary code, descriptor handling, GSAP/content/ownership holds, replacement proof status, deterministic replay, output tampering and fail-closed clearance.

Live freeze verification also passed for all eight images, with original QA unchanged; steps 1–2 still pass their completeness gate.
