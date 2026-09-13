# Hash-bound scope reviews

This continuation resolves three specific component/version cases, represented by six frozen occurrences. It does not mark Step 3 complete. Current counts are authoritative in `summary.json` and `STATUS.md`.

| Component | Selected treatment | Source/build/relink duty under this grant |
|---|---|---|
| target-lexicon 0.13.5 | Comply with Apache conditions, retain the LLVM exception text, and do not exercise the optional notice or GPLv2-conflict waivers. | Not required; no conclusion about unrelated combined-work grants. |
| webpki-root-certs 1.0.6 | The embedded root certificates are shared Data. Provide CDLA-Permissive-2.0 with them under section 2.1. Do not apply the section 3 Results exemption to distribution of the data itself. | Not required by the data agreement. |
| libbz2-rs-sys 0.2.2 | Notice explicitly covers the Rust translation. Retain source notices when source is supplied, preserve origin, mark altered source, and avoid unapproved endorsement. Documentation acknowledgement is appreciated, not mandatory. | Not required by the supplied grant. |

`review_step3_scoped_cases.py` records the exact document hashes, component versions, declarations, reasoning and required conditions. It verifies actual notice bytes before applying a decision; changed notice sets, changed declarations and other versions are not accepted. Unrelated blockers are retained. Frozen occurrence membership, payload and linking-context checks still execute in the main builder.

The full suite passed **235 tests**, including eight scoped-review tests. Deterministic replay passed. The resulting ledger reports **2,692 decided occurrences and 660 open occurrences across 590 groups**. No fulfilment, full-stack, legal or production clearance is issued.
