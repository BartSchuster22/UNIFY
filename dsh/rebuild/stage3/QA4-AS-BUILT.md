# Stage 3 — external reference integration: QA4 as-built

**Bounded engineering gate: PASS. Production/GA approval: false.**

Observed on 2026-09-10 in the isolated Linux amd64 QA4 installation. This closes
Stage 3 rows 3.1–3.7 only. It does not authorize or qualify Stages 4–7, a customer
cutover, unrestricted semantic learning, sustained autonomous work, or disaster recovery.

## Installed artifact and reproducibility

- Base: the immutable public Stage 2 bundle, release SHA-256
  `bcf5d5e2d063518923e2dc92068c7f467c57357e88ada1cc09b4b25a75581aa2`.
- Qualified QA4 release SHA-256:
  `08526a76412c37e2f203feb6bc50439b8abf68d0411da74e6586f98b83edb1a1`.
- QA4 used `build-overlays.py`, `package.py`, `configure-callbacks.py`, and the
  unchanged Stage 2 lifecycle installer. No manual replacement of running app code.
- [Machine-readable evidence](QA4-ACCEPTANCE.json) pins the component images and
  hashes the allowlisted live evidence. `qa4/collect-evidence.py` compared every
  packaged overlay file with the corresponding current build/source file.
- Stage 2 artifacts were not modified. QA2/QA3 candidates were retired through
  lifecycle uninstall with data/evidence retained, not declared physically erased.
- 69 pre-existing containers retained their identity, image, running and status
  values through QA4 installation and acceptance. This count includes stopped
  containers; it is not a count of production workloads.

The local offline QA4 package is a tested development candidate, not a publicly
signed production release. Source/schema/evidence publication is distinct from
Stage 7 binary release acceptance. Operator-specific network pins, new credentials,
TLS setup and native model setup remain installation responsibilities.

## Acceptance matrix

| Row | Installed verification |
| --- | --- |
| 3.1 | Versioned manifest/request validation, error and compatibility contract; exported schema matches gateway validators. |
| 3.2 | Real OIDC registration, scoped app credential, durable admission and native correlation; 12 concurrent same-key replays return one receipt; changed payload rejected. |
| 3.3 | Real result delivery and signed callback; exact replay preserves one effect; unsigned/tampered delivery denied; app outage recovers on delivery attempt 2 with unchanged delivery ID, native reference and admission key. Running native cancellation settles before deletion. |
| 3.4 | Independent Python/SQLite customer app owns accounts/business state. Real Chromium checks wrong password, sign-in, result rendering, correction selection and sign-out; no browser Core/native access or backend credential exposure. |
| 3.5 | Real model inference over retrieved RFC 2606 bytes; evidence evaluation and MemoryV4 promotion; follow-up answer reuses canonical knowledge and the original native evidence timestamps rather than refetching. |
| 3.6 | Refresh, exact-quote correction and supersession; changed-quote correction quarantines with visible uncertainty and unchanged canonical IDs. Customer export, cancellation, coordinated live-store erasure, cross-customer preservation and automatic retention pass. Hostile question cannot expand approved URLs and native session has no tool calls. |
| 3.7 | Customer app → Core → native Hermes → governed MemoryV4 → signed callback/display demonstrated on the installed candidate, not an echo or fabricated provider response. |

Real OIDC also denied a wrong password, required initial password change and
provided the Core identity session/native inventory. Retention inputs were explicitly
backdated timestamps; real services produced the expiry/deletion outcomes. No
wall clock, receipt state, result or deletion outcome was fabricated or rewritten.

## Defects resolved

1. **Native scheduler race:** admission begins as a non-dispatchable triage card;
   native transaction/event helpers establish a sticky restricted-executor handoff.
   The general scheduler cannot claim it. A real pinned-SDK regression interleaves
   the scheduler in the admission gap and runs 30 further sweeps.
2. **Hidden rejection:** the customer app displays bounded Core rejection codes
   without exposing raw provider errors or changing a rejection into success.
3. **Empty-record erasure:** Core explicitly opts into `allow_empty` at the Memory
   owner endpoint. Default unknown-binding denial is retained. Exact actor,
   permission, grant, scope/application/subject checks, dependency scans and atomic
   hash-only anti-recreation tombstones still apply. Absence is never inferred from
   a 403, nor is the flag a global erase bypass.

## Final verification

| Suite | Result |
| --- | --- |
| Entire gateway + Hermes control adapter suites | 314 passed across 34 files |
| MemoryV4 owner suite | 117 passed |
| Native worker unit suite | 25 passed |
| Reference app unit suite | 26 passed |
| Real pinned Hermes SDK scheduler regression | Passed; network disabled, no inference |
| Gateway/adapter no-emit typechecks | Passed |
| Targeted Memory Ruff + repository diff checks | Passed |
| Exported schema drift check | Passed |
| Installed acceptance, Chromium, privacy/retention and hostile-input checks | Passed |

Mocked unit transports remain explicitly separate from real installed tests. One
third-party Starlette/AnyIO deprecation warning remains; no test failed in the final
Memory run. QA scripts persist submission keys to avoid repeating inference.

## Privacy and operational boundaries

- Erasure means logical removal from the live app/Core/Memory/native owner stores.
  Minimal non-content deduplication tombstones remain. It does **not** erase physical
  SQLite/PostgreSQL pages or WAL, backups, replicas, downloads, retained retired
  candidates, screenshots or exported audit evidence.
- Dependencies are deleted newest/dependent first. Unresolved foreign references,
  artifacts, unknown ownership and schema drift fail closed rather than claiming
  deletion. Other customers' real knowledge/results were verified unchanged.
- Conservative correction only revalidates byte-exact quotes from the same source.
  Unverified semantic changes remain quarantined. This is deliberate policy, not
  a claim that arbitrary knowledge correction is solved.
- The browser uses an exact QA leaf SPKI pin, not global TLS bypass; Python clients
  independently verify the CA and hostname. Test browser dependencies were extracted
  into isolated tooling, not installed into the host package database.
- All QA4 fixture Core receipts, Memory records and native tasks were logically
  erased at closeout. The borrowed access-only native credential was removed via
  the native credential authority. No refresh token was transferred, and the
  coordinator's auth/config was preserved during provisioning.

## Reproduction entry points

Component checkout: `dsh/rebuild/stage3/CONTRACT-V1.md`,
`application-v1.schema.json`, `export-schema.mjs --check`,
`build-overlays.py`, `package.py`, and `qa4/`.

Run the QA4 scripts in dependency order: install, OIDC, native provisioning,
reference setup, first request, negatives, extended acceptance, browser, conflict,
privacy, retention, hostile question, closeout, evidence collection. The scripts
are operator-owned fixtures pinned to this isolated cell, not a portable customer
bootstrap command; adapt roots/hostnames/image pins only under a new reviewed
candidate. Do not rerun paid-request tests with new keys to hide a failed attempt.

No secrets, raw customer credential files, private CA keys, native provider tokens
or test virtual environments belong in the published source/evidence set.
