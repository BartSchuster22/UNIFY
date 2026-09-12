# Stage 7.1–7.3 — independently qualified QA4

**PASS for the predeclared QA scope only. No production approval.**

Candidate `72297c3`, archive SHA-256 `26f98d6ffc8ecc576628b061a9851b8cd40e1e917f070a8567b9fb48ee969553`; release manifest `1486b3aa2dccb7a21941140508280b5125d816452e708e13c7640ea120a2e66c`.
Provider action `654896619716720` rebuilt DSH2 before installation. The previous QA4 state was absent, Docker was empty, and the clean installation boot ID matches the fresh-OS receipt. No database, checkpoint or prior PASS was imported into that clean installation.

## Measured results

| Gate | Result |
|---|---|
| Anonymous published-archive download, strict signature and inventory, clean install | PASS |
| Owner OIDC/recovery, Chromium owner/customer UI, strict hostname TLS probes | PASS |
| Credential expiry/revocation, CSRF/transport and project/customer isolation | PASS |
| Real research, reuse, refresh, correction and export | PASS |
| Four-fact reuse regression | PASS: 68852 source bytes exceed the unchanged 65,536-byte plan limit; all four canonical IDs and complete provenance preserved |
| Real native recurrence | PASS: eight unique governed results over 1852.97 seconds, native restart/checkpoint continuity, terminal Cron/capability cleanup |
| Host/process/daemon/storage/broker and callback/provider faults | PASS; no duplicate business effect or blind uncertain-action replay |
| Hostile input boundary | PASS for this real attempt and positive control; not universal prompt-injection resistance |
| Real reboot and authenticated cold restore | PASS; reboot preserved identities; cold restore recreated seven containers, preserved native task/session links and was independently verified on both backup hosts |
| Signed operations-only v2-to-v2 update | PASS: undeclared payload denial, health/schema rollback, interrupted recovery, replay denial, committed sequence 5 |
| Coordinated live-store privacy deletion | PASS; native cancellation, customer erasure and other-customer preservation; performed after recovery tests |

The host reported 4 CPUs and 7.56 GiB RAM. Installation took 201.094 seconds; measured peak host non-available memory during installation was 1.67 GiB. Container limits and OOM observations are in the evidence. These measurements do not establish a smaller-host minimum or general concurrency ceiling. Provider cost was not measured.

The unchanged gateway source also passed typechecking and 238 unit tests across 29 test files. Those labelled-mock unit tests are supplementary regression evidence, not substitutes for the live qualification.

## Failure and contradiction disposition

22 failed attempts remain in `failure-ledger.json`; their private log hashes are retained. QA1/QA2 and all QA3/cleaned-host QA4 results are excluded from this verdict. The cleaned-host QA4 run is diagnostic evidence, not fresh-OS acceptance. Its post-privacy state, including operations high-water counters, was encrypted and independently verified on both backup hosts before the provider rebuild.

Earlier packaging trials remain rejected: `4273c86` failed PostgreSQL secret readability; `ed2f09b` reached seven healthy containers but failed observer import. The historical preparation README preserves those disclosures. Neither container-only health nor publication is acceptance.

QA3 exposed the oversized knowledge-finalization plan. The Core correction interns duplicated excerpts in the persisted plan without increasing the limit or replacing native outcomes. The earlier QA4 ordering, response-envelope and empty-customer assumptions were harness errors; their failures remain recorded. The final result uses newly executed gates on the fresh OS, not those earlier PASS flags. Subreports saying `wholeStage7Accepted=false` were truthful at their individual checkpoints; only this final reconciliation grants the scoped verdict.

## Explicit exclusions

- production approval
- Stages 7.4–7.6
- licensing/SBOM closure
- general OS/runtime-image/schema updates
- physical backup erasure
- elapsed day/week retention
- day/week soak
- measured provider cost
- smaller-host minimums or unmeasured capacity
- other framework adapters

QA signatures are not production trust. The browser uses a QA self-signed exception, separately checked by strict CA/hostname TLS probes. Storage pressure was an isolated real tmpfs probe, not a filled data filesystem. Starting the external `restart=no` reference fixture is not claimed as recovery of a DSH-owned service. Backup archives may retain synthetic deleted-customer data under operator-managed retention; physical backup erasure was not tested.

Private credentials, keys, cookies, screenshots and raw customer/native logs are not publication artifacts. Public evidence contains bounded assertions, identifiers, hashes and synthetic QA metadata. The immutable candidate was not replaced during qualification.

## Post-acceptance state

After the healthy acceptance snapshot, the fresh run was encrypted with its recovery/update working state and anti-replay counters. Both backup hosts independently authenticated and verified all archived entries. DSH2 was then left quiesced with its operation units disabled, rather than leaving accepted QA live. No production deployment was made.

The initial release README and original pending/false flags are historical publication-time checkpoints, not the current scoped verdict. The immutable candidate archive and initial assets remain unchanged. The fresh run's initial OIDC attempt stopped at the dedicated-host guard before authentication; enrollment was subsequently bound to the verified provider identity, and the genuine OIDC test passed without reinstalling or replacing business outcomes.
