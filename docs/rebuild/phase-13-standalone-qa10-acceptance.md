# Phase 13 — Standalone QA10 Acceptance

Date: 2026-08-05 UTC

## Decision

**PASS.** Standalone UNIFY release `18a0359fdc2aed31511e8f54c11db4f074bf53c6` passed the required functional, security, recovery, restoration, and public-exposure gates. Worker, `/CHAT`, Agency, and DMM were retired only after the gates passed.

## Corrective work discovered by acceptance

QA10 initially found that native conversation reads were unavailable for both framework instances. The production path was corrected by:

- enabling each Hermes API server only on its isolated runtime network;
- requiring separate Alica and Herman API bearer credentials;
- injecting those credentials into s6 from mounted secret files rather than container environment metadata;
- terminating private API TLS through isolated Caddy proxies;
- adding the framework CA to adapter trust;
- keeping the API and adapter ports unpublished;
- raising the bounded gateway-to-adapter request timeout from 5 seconds to 20 seconds so valid Hermes inventory commands can complete without intermittent false `503` responses;
- updating database-backed migration assertions for migration 11.

Both production conversation-session endpoints subsequently returned HTTP 200 with current, framework-owned provenance.

## Acceptance evidence

| Gate | Result | Evidence |
|---|---|---|
| Authentication | PASS | Invalid credentials rejected/rate-limited; administrator login, `auth/me`, logout, and revoked-session rejection exercised in every production run. |
| Authorization and CSRF | PASS | Unauthenticated framework reads rejected; authenticated mutations required CSRF; PostgreSQL-backed RBAC tests passed. |
| Isolation | PASS | Independent Alica/Herman registration, credentials, TLS identity, networks, provenance, and returned framework IDs verified. |
| Idempotency | PASS | Repeated identical framework registrations remained verified; database-backed idempotency tests passed. |
| Concurrency | PASS | Twelve concurrent registry reads per production run remained consistent; database-backed concurrency tests passed. |
| Auditing | PASS | `framework.register` success records observed; audit output scanned against runtime secret values with no disclosure. |
| Replacement functions | PASS | Health, capabilities, profiles, providers, projects, boards, cronjobs, conversation sessions, and framework events returned successfully for Alica and Herman. |
| Ten consecutive runs | PASS | Runs 1–10 passed under `/opt/unify/evidence/phase13-20260805T172802Z`; logs and manifest are SHA-256 protected. |
| Container restart recovery | PASS | Database, Core, adapters, private API proxies, Alica, and Herman were restarted; readiness and a complete QA10 run passed afterward. |
| Host reboot recovery | PASS | Boot ID changed from `9a2f2be9-931c-4f0f-a37f-27dd90657a2d` to `64929b62-a429-41aa-b01f-b9d0f6a9d4ac`; all required containers recovered and post-reboot QA10 passed. |
| Backup and restoration | PASS | Fresh encrypted backup created; isolated restoration passed with 26 application tables and 7 migrations. |
| Public exposure | PASS | Only TCP 80/443 reachable; 5432, 8080, 8642, 18080, 28082, and 2019 closed externally; HTTP redirected and HTTPS/HSTS readiness passed. |
| Full repository QA | PASS | `pnpm qa` exited 0 after lint, typecheck, tests, builds, contract reproducibility, standalone boundaries, backup retention, identity capacity, canary, and formatting checks. |
| Database-backed Core suite | PASS | Temporary PostgreSQL run: 39 tests passed, 0 failed, 0 skipped. |

## Backup and evidence locations

Production evidence:

- `/opt/unify/evidence/phase13-20260805T172802Z`
- encrypted backup: `/opt/unify/backups/unify-20260805T173504Z.dump.age`

Retired-application evidence on the former runtime host:

- pointer: `/retained/unify-phase13-current`
- resolved archive: `/retained/unify-phase13-20260805T163727Z`

The retained archive includes the Worker PostgreSQL dump, application data archives, deployment definitions, original container inspections, retired systemd units, and a verified SHA-256 manifest.

## Retirement

After all gates passed:

- Worker web, server, and database containers were removed;
- `/CHAT`, Agency, and DMM containers were removed;
- their empty Compose networks were removed;
- `/CHAT` bridge and relay units were removed;
- DMM helper/backup units were removed;
- Agency backup units were removed;
- archived data and deployment evidence were retained and checksum-verified;
- no legacy volumes or retained archives were destroyed.

The standalone UNIFY runtime and the independent Alica/Herman framework runtimes remain active. No legacy application is a runtime dependency of UNIFY.
