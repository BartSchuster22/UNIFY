# Stage 4 — bounded durable and recurring work

Status: **QA4 bounded Stage 4 engineering gate PASS**. Production-ready remains false.

The persisted native completion window was **862.113 seconds**, with four certain,
governed recurring answers and distinct app/Core receipts. The original harness's
final browser read encountered session expiry after execution completed. The
reauthenticated closeout and `recover-final-read.py` verified the retained outcomes
without rerunning or editing work. The duration is explicitly derived from the
persisted native completion timestamp and saved run-start wall clock, not a
reconstructed monotonic measurement. All control/cleanup checks passed; all 77
pre-existing workloads and older qualified artifact bytes remained unchanged.

## Ownership and boundaries

- Native Hermes Kanban owns the workflow checkpoint/card and inference leaf work.
  Native Cron supplies wake-ups. General native workers cannot claim the restricted
  coordinator card. There is no new central queue, cron daemon, or execution ledger.
- The external reference app owns immutable, customer-scoped recurring grants,
  per-event idempotency and request records. Core owns governed receipts, authority,
  delivery and erasure; MemoryV4 owns governed knowledge lifecycle.
- Operator-owned TLS origin/address policy binds the narrow native transport. A
  capability cannot select an arbitrary URL, operation, project, subject or payload.
- Occurrences are elapsed-time minute intervals with explicit timezone validation,
  skip/coalesce-latest missed-slot policy, non-overlap, checkpoints, dependency waits,
  event deduplication, bounded backoff/no-progress handling and truthful cancellation.
- `maxEstimatedCostMicros` is an admission estimate, not provider-billed cost proof.
  The model cannot modify prompts, tools, platform configuration, source or policy.

See [CONTRACT-V1](CONTRACT-V1.md) and Alica-DSH's
`docs/stage4-recurring-work.md` for the supported operator contract and limits.

## Reproducible qualification

`build-overlays.py` builds source-snapshotted, immutable component overlays.
`package.py` assembles a new release from the SHA-pinned Stage 2 v7 base and verifies
OCI descriptors. The outer Docker-save archive is gzip-compressed without changing
image bytes. Callback configuration produces another explicitly pinned release.
Older Stage 2/3 artifact bytes are not rewritten.

The `qa4/` harness installs an isolated candidate, tests real OIDC, sets an explicitly
bounded access-only native test credential through the native authority, provisions
the external reference app, and exercises real inference and source research.
`recurring-soak.py` requires four separate recurring results over actual elapsed
wall time, native restart/checkpoint survival, distinct Core receipts and app
requests, completion pause/capability removal, AND certain governed answers.
`recurring-closeout.py` additionally verifies governed knowledge reuse against native
result/provenance evidence, replay/budget/scope denial, dependency failure, explicit
event deduplication, real cancellation and terminal fixture revocation.
`final-preservation.py` checks settled native ownership, removes the borrowed test
credential, compares pre-existing workloads and rehashes older qualified artifacts.

The 81 regression tests are separately labelled: 27 restricted-worker tests and
38 reference-app tests use mocks; 16 workflow tests use the real packaged native
SDK with mocked transport. These are not claimed as elapsed-time acceptance or
live model calls. Live acceptance is a separate installed-stack evidence set.

## Failed attempts are not release acceptance

QA1/QA2 were unqualified candidates; QA2 hit the unchanged 8-GiB disk guard. QA3
passed delivery/restart but failed usable governed knowledge: its native reader
lost the canonical quote and proposed fragments from a full source page. Core
correctly quarantined those proposals. That run is NOT learning acceptance.

The native reader now evaluates complete governed quotes while preserving original
source evidence, and rejects subquotes represented as canonical facts. Regression
coverage and a fresh QA4 installation—not relabelled QA3 results—qualify the fix.
Historical unused fixture sources are retained outside the publication worktree.
QA3 was retired using lifecycle stop/uninstall; its audit/data volumes and verified
cold image archive remain retained. `retire-unqualified-qa3.py` and the retirement
record document the bounded cleanup. No shared image/volume/cache pruning occurred.

## Evidence and release scope

`evidence/qa4/` contains the allowlisted, secret-audited acceptance records and image/
release metadata. No credentials, cookies, private native homes, raw customer inputs,
or Docker archive bytes belong in Git. The assembled offline candidate is on the
development host under `/srv/alica-dsh-development/stage4-package-qa4`.

This is the bounded Stage 4 engineering gate only. It is not production-ready, a
long-haul/chaos proof, complete audit-history erasure, unrestricted autonomous
self-modification, measured billing enforcement, or completion of Stages 5–7.
Browser/build tooling cold archives remain available on the coordinator for restore;
this host's tight disk budget is not hidden by deleting shared runtime resources.
