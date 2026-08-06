# Phase 14.1 Combined Framework Runtime Evidence

**Status:** PASS
**Date:** 2026-08-06 UTC
**Production changed:** No

## Accepted artifact

The production candidate is built from `Dockerfile.hermes-runtime` and is used unchanged for both Alica and Herman.

| Attribute | Accepted value |
|---|---|
| Local image | `unify/hermes-runtime:phase-14.1` |
| Loaded image ID | `sha256:ef30e149eaeca94ff67af1fea974f52682d38dbd0e3b674bb70cb8acd7940ba6` |
| Image size | 1,015,967,275 bytes |
| Hermes base digest | `sha256:fcbe95482353e41cd30d39ddfc0f57ba3720f6da6969a7a69cdfb0d84b045cb6` |
| Hermes release | `0.20.0` |
| Hermes commit | `b8b17b8cee50b85adb7fba6ea332dc06731b86f4` |
| Node builder digest | `sha256:9f6d5975c7dca860947d3915877f85607946403fc55349f39b4bc3688448bb6e` |
| Control adapter listener | TLS `0.0.0.0:28082` |
| Native Hermes API | HTTP loopback `127.0.0.1:8642` |

The image contains no deployment token, database URL, or framework private key. Those values are accepted only through mounted runtime secret files.

## Reproducibility

Two independent no-cache builds were exported through BuildKit's OCI exporter with:

```text
SOURCE_DATE_EPOCH=0
rewrite-timestamp=true
provenance=false
```

Both produced the same runnable OCI manifest:

```text
sha256:2f455d037f54820a55c44d3edf84320e2a2b352280b7bc538dd282eb979cfbc3
```

The enclosing OCI tar files had different archive-level hashes because tar wrapper metadata is not part of the image manifest. The image configuration and content-addressed OCI manifest were identical; acceptance is based on that immutable manifest, not the transport archive checksum.

Generated adapter output is also timestamp-normalized before it is copied into the runtime stage.

## Runtime design

The derived image leaves `/opt/hermes` unchanged and adds only UNIFY-owned adapter artifacts, initialization, supervision, and health definitions.

s6 supervises:

1. `unify-hermes-gateway`
2. `unify-control-adapter`

Both application processes run as the existing Hermes UID `10000`. The s6 init process retains only the privileges required to initialize the read-only-root container and drop to that application identity.

The native API token initialization hook reads the mounted token file into the in-memory s6 environment. The token is not printed or persisted in an image layer.

The combined health check requires:

- both s6 services to report `up=true`;
- a valid active adapter credential bundle;
- successful CA-validated adapter TLS;
- authenticated `/control/v1/health`;
- authenticated `/control/v1/version`;
- healthy CLI, conversation API, and PostgreSQL event-store checks;
- the expected Hermes release and commit.

## Automated evidence

Static contract:

```text
$ pnpm hermes:image:check
Hermes combined image static contract: PASS
```

Isolated container acceptance:

```text
$ HERMES_RUNTIME_SKIP_BUILD=1 pnpm hermes:image:verify
Hermes combined runtime container acceptance: PASS
```

The acceptance test used fresh temporary framework data, credentials, CA, TLS certificate, Docker network, PostgreSQL database, and adapter schema. Cleanup removed all test containers, networks, and volumes.

It proved:

- invalid control credentials return HTTP 401;
- identity and version match the pinned framework;
- adapter health includes healthy CLI, conversations, and event store;
- a real project write through the control adapter is visible through the real Hermes CLI;
- a native conversation created through the adapter is read back through the loopback API;
- both supervised child processes run as UID `10000`;
- the native API listens on loopback only;
- the adapter listens on TLS port `28082`;
- terminating either child causes s6 to restart it;
- deliberately disabling either service makes Docker mark the container unhealthy;
- restoring each service returns the container to healthy.

## Phase 14.1 exit decision

The Phase 14.1 exit gate is satisfied. This acceptance authorizes Phase 14.2 implementation and testing only. It does not authorize production cutover, data migration, registration changes, or retirement of the current topology.
