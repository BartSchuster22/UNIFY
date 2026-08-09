# MemoryV4 Phase 14 production acceptance evidence

Date: 2026-08-09 UTC
Production release: `phase-18.3-8367fd0`

## Result

UNIFY is the sole governed application/framework gateway to the authoritative MemoryV4
Tier-3 service.

- `unify-core` and `memory-v4-memory-v4-1` are the only containers on
  `unify_memory-private`.
- Alica and Herman have no direct MemoryV4 network path or MemoryV4 credential.
- Both framework runtimes successfully executed `unify_memory_search` through UNIFY.
- Their embedded tool inventory exposes search, context, get, remember, and update only.
- Candidate creation is forced to active/working/author-only; canonical promotion is not
  exposed.
- Authenticated UNIUI production Chromium verification opened the authoritative MemoryV4
  view, governed editor, and evidence surface with no console, page, or HTTP failures.
- Anonymous Memory status returned HTTP 401.
- Live production QA10 passed registration replay, governed reads, concurrency, audit,
  logout, and secret scanning.
- Full repository `pnpm qa` passed.

## Acceptance defect and correction

The QA10 registration payload contained only control scopes. Because registration is a
truthful replacement, running QA10 removed `memory:read` and `memory:write` from Alica and
Herman. Phase 14 framework search correctly failed with `FRAMEWORK_SCOPE_DENIED`; the gate
was not waived.

The payload now preserves:

```text
control:read
control:execute
control:events
control:secrets
memory:read
memory:write
```

`verify-five-service-installer.mjs` statically requires the three previously omitted
security/governance scopes. The corrected QA10 runner was installed in production, replayed
successfully, and live Alica/Herman searches then passed with governed results.

MemoryV4 data/recovery/cutover evidence is maintained by the MemoryV4 repository in
`docs/PRODUCTION_ACCEPTANCE.md` and `docs/CUTOVER.md`.
