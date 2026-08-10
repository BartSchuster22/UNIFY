# Functionality QA10 — Step 10 production acceptance

## Result

**PASS — accepted on ALICA-v1 on 2026-08-10 UTC.**

Step 10 migrates the authoritative base-agent display name without pretending that Hermes' immutable native profile identifier changed. Both framework runtimes retain native profile ID `default`; UNIFY presents that base profile as `Alica` for `hermes-alica` and `Herman` for `hermes-herman`.

No secret value, token, password, connection string, cookie, or private key is recorded here.

## Source and releases

| Attribute | Accepted value |
|---|---|
| Implementation commit | `fcb3cbf26d93c3b351dab80e40c65203952f5e9f` |
| Production configuration commit | `fbbb4d0ba3d706b425c14f2e05c57fe6586fb65e` |
| Source branch | `feature/unify-functionality-qa10` |
| Platform release | `phase-19.0-fbbb4d0` |
| Previous platform release | `phase-18.4-a5368aa` |
| ALICA-v1 host | `167.233.135.142` |
| Public UI | `https://uniui.aquiero.com` |
| Hermes runtime image | `localhost:5000/unify/hermes-runtime@sha256:74e415d606d88b5224f05978ad578d521dff6ea6156f7c8721e29075de9190b1` |
| Web image | `localhost:5000/unify/web@sha256:a09dbf17f425d987928155819d1d89b490f78db34a2b3772f9ad6b26ecfd67ad` |

The unchanged Core and Caddy images remained digest-pinned. The separately managed `unify-web` project was advanced to the same Step 10 source release while retaining its prior release through `/opt/unify-web/previous`.

## Production configuration

The authoritative five-service deployment now supplies:

```text
hermes-alica  HERMES_BASE_PROFILE_DISPLAY_NAME=Alica
hermes-herman HERMES_BASE_PROFILE_DISPLAY_NAME=Herman
```

The adapter validates the configured display name. The native filesystem/profile identifier remains `default`; no unsupported Hermes profile-directory rename was performed.

## Backup and rollback protection

The managed installer created and verified its normal pre-upgrade protection and accepted a verified encrypted post-upgrade backup:

```text
path=/opt/unify/backups/gateway-20260810T082016Z.tar.enc
sha256=cf0a1436a2736d6900152a631e3eb30b32cba15c10f8ad1e94cb3df1e67bd5d0
verified=true
```

The installer retained `phase-18.4-a5368aa` as the previous platform release. UNIFY Web retained its prior release as the `previous` symlink. Images, release definitions, data, secrets, and installer manifests were not destructively pruned.

## Verification

Fresh repository verification after the production Compose correction passed:

```text
corepack pnpm qa = PASS (exit 0)
```

This included lint, boundaries, production static image contracts, five-service installer acceptance, type checks, workspace tests, production builds, reproducible contracts, backup retention, capacity, canary, and formatting. The UniUI suite reported `62 passed, 1 expected fail`; the remaining expected failure is unrelated to Step 10.

The production installer accepted the upgrade and then verified it idempotently:

```json
{"schemaVersion":"unify-installer-result/v1","mode":"upgrade","releaseId":"phase-19.0-fbbb4d0","changed":true,"project":"unify","status":"PASS"}
{"schemaVersion":"unify-installer-result/v1","mode":"verify","releaseId":"phase-19.0-fbbb4d0","changed":false,"project":"unify","status":"PASS"}
```

Authenticated public identity acceptance returned:

```text
hermes-alica  native_id=default  display_name=Alica   owner=hermes  PASS
hermes-herman native_id=default  display_name=Herman  owner=hermes  PASS
```

For both results, metadata reported the exact framework ID, `owner=hermes`, and `freshness=current`.

Full authenticated production QA10 passed before restart and again after restart:

```text
qa10_run=passed
```

The suite covered authentication, registration, health, capabilities, profiles, providers, Work projects/boards/cronjobs, conversations, events, concurrency, and audit for both frameworks.

## Restart and convergence

The changed workloads were explicitly restarted one at a time:

1. `unify-alica-1`
2. `unify-herman-1`
3. `unify-web-unify-web-1`

Each returned to `healthy`; after each restart, public Web health and Core readiness passed. Final authenticated identity checks and full QA10 then passed again.

Final production state:

| Workload | State |
|---|---|
| Alica runtime | healthy |
| Herman runtime | healthy |
| UNIFY Core | healthy |
| PostgreSQL | healthy |
| Caddy | healthy |
| UNIFY Web | healthy |
| Public UI | HTTP 200 |
| Public Core readiness | HTTP 200 |

## Evidence log integrity

The operator-side logs used for this acceptance had these SHA-256 hashes at completion:

```text
49d7f1c4b3e9f3d411bdd31b9ad1f15a75ceee6d221fc9728a28f8219aa19ef1  unify-step10-final-qa.log
e5c76c3978da7f051995b1403d77ad03c942e5e24de6b5e3aaf6ddbe6710681b  unify-step10-production-build.log
7b617e18f4e629bb587ac00b28b4f41b3b9e028e4857d3da3656320a041e7d8b  unify-step10-production-install.log
4a1883d170c0bd423cc944b8716e29252d019cc6157a08002662114fbd740014  unify-step10-production-qa10-pre-restart.log
b9dfb00b1a27c2541c353aecf5627aa9d76bf4149480b7afeb2698fdc321f332  unify-step10-web-deploy.log
447f22be048978d7e37a99890f53ffc54fdfa687d8b754f1931c01e89d64e056  unify-step10-production-final-acceptance.log
```

## Acceptance decision

Step 10 is complete. ALICA-v1 now exposes truthful framework-specific base-agent display names while preserving Hermes-native identity and ownership boundaries, and the migration is backed by immutable images, managed rollback, encrypted backup, authenticated QA10, and restart/convergence evidence.
