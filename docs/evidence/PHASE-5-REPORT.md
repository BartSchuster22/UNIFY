# Phase 5 Verification Report

Date: 2026-07-19

## Scope delivered

Phase 5 introduces governed owner-authoritative mutations for Hermes profiles, DMM credentials, Worker projects/tasks/crons, Chat messages/files, and allowlisted MemoryV4 records. It adds contracts, generated SDK support, UNIUI safety controls, operation/audit/evidence persistence, idempotency, confirmation, owner authentication, bounded files, and recursive evidence redaction.

This phase does not cut ownership over to UNIFY. Agency/Hermes, DMM, Worker, Chat, and MemoryV4 remain authoritative.

## Security verification

The authenticated Gateway was exercised through UNIUI's same-origin proxy with a named administrator session and CSRF token.

- all 30 operation definitions passed `validate` mode;
- missing/incorrect Worker bearer tokens returned `401`;
- an authenticated Worker mutation with an invalid payload reached native validation and returned `400` without creating a resource;
- destructive execution without confirmation was rejected while destructive dry-run remained available;
- idempotent replay returned the original verified operation;
- reusing an idempotency key with a different payload returned `409`;
- retained credential-shaped owner evidence was recursively replaced with `[REDACTED]`;
- Memory role/lifecycle combinations outside the allowlist were denied before owner execution;
- safe owner error codes were retained without copying arbitrary owner response bodies.

Worker's live Compose deployment was rebuilt with fail-closed mutation authentication. Public reads remained available, Worker web remained healthy, and the shared Worker/Gateway token was not printed or committed.

## Authenticated owner checks

| Owner | Verification | Result |
|---|---|---|
| Agency/Hermes | profile create dry-run with native model reference | verified, no profile created |
| Agency/Hermes | identity/model/runtime dry-runs | verified, no owner state changed |
| Agency/Hermes | protected profile deletion | owner policy rejected the request |
| DMM | authenticated model inventory and nonexistent-provider credential boundary | authenticated; safe `404`, no credential changed |
| Worker | public read plus missing, incorrect, and correct bearer boundaries | `200`, `401`, `401`, native `400` |
| Chat | authenticated upload, idempotent replay, constrained download | verified; 48 bytes; `private, no-store` |
| Chat | nonexistent-session message boundary | safe `404`, no message sent |
| MemoryV4 | authenticated inventory and invalid/nonexistent entity write boundaries | authenticated; no record created |

The Chat verification artifact was deliberately tiny and constrained to Chat's uploads owner. No Worker test project remained after verification. No live DMM credential was saved, replaced, or deleted. No production profile, task, cron, or Memory record was created during QA.

## Automated gates

The final delivery gate passed:

```text
pnpm contracts:generate       PASS
pnpm contracts:check          PASS
pnpm lint                     PASS
pnpm typecheck                PASS
pnpm test                     PASS (60 tests)
pnpm build                    PASS
docker compose config --quiet PASS
git diff --check              PASS
```

The test distribution was Gateway 42, UNIUI 5, TypeScript SDK 3, contracts 3, and adapter SDK 7. Focused Gateway tests cover owner routing/authentication, mutation-route CSRF and RBAC, safe owner errors, malformed base64, Chat download authentication/path/size controls, mutation policy, confirmation, Memory allowlisting, idempotent replay/conflict, lifecycle transitions, and recursive evidence redaction. SDK tests cover mutation headers/body and authenticated download behavior.

## Limits and ownership guarantees

- Mutation request body: 15 MiB on `POST /api/v1/mutations` only.
- Chat decoded upload and proxied download: 10 MiB.
- Chat download path: safe `/uploads/<name>` only.
- Worker reads remain public according to its existing contract; all mutating `/api/*` routes fail closed unless the bearer token is configured and valid.
- Profile protection and stopped-runtime deletion requirements are enforced by Agency/Hermes rather than duplicated in Gateway.
- Memory writes are restricted to `active/working`, `evidence/working`, and `evidence/live`.
- Credentials and tokens never appear in this report, retained evidence, or committed configuration.

## Conclusion

Phase 5 is accepted when the final automated gates pass, the repository is committed and pushed, and local `HEAD` exactly equals `origin/main` with a clean working tree.
