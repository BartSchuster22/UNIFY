# D2 unified clean installation

Status: implementation candidate; public clean-host acceptance is blocked until the first-party OCI candidates are published without private Aquiero credentials.

## Boundary

D2 is a separately authorized mutation gate. It does not widen the D1 `preflight`, `status`, or `verify` commands, which remain read-only. D2 adds native `alicactl plan` and `alicactl install` commands for an empty `dsh-minimal/v1` host.

One release operation owns these runtime components:

- Caddy ingress;
- UNIUI;
- UNIFY Core;
- Keycloak;
- PostgreSQL;
- Alica;
- Herman;
- MemoryV4.

AInbA, Doghouse, backup/restore, alerting and trusted update remain D3–D5 work. D2 does not authorize production publication.

## Inputs

`alicactl` requires:

1. the closed `alica-release/v1` manifest;
2. its detached Ed25519 signature;
3. the explicitly pinned trust key;
4. one closed `alica-clean-install/v1` request.

The request contains Cell identity, installation root, public hostname/origin, Compose project, local administrator username and explicit acceptance of the exact EULA digest. It contains no password, provider credential or registry credential. Unknown/duplicate fields, malformed JSON, BOM, invalid UTF-8, traversal-shaped roots and production Aquiero origins fail closed.

Example:

```sh
alicactl plan \
  --manifest alica-release.json \
  --signature alica-release.signature.json \
  --public-key alica-release-key.json \
  --request install-request.json \
  --json

sudo alicactl install \
  --manifest alica-release.json \
  --signature alica-release.signature.json \
  --public-key alica-release-key.json \
  --request install-request.json \
  --json
```

`plan` is read-only. `install` is the only D2 lifecycle writer.

## Supported clean host

Production preflight requires the signed manifest's frozen platform envelope:

- Debian 13;
- amd64;
- systemd;
- Docker `[28.4.0,29.0.0)`;
- Docker Compose `[2.39.4,3.0.0)`;
- at least 4 vCPU, 8 GiB RAM and 100 GiB free disk.

The installation root must be an absolute clean path. Foreign entries are rejected. A nonblocking filesystem lock prevents concurrent writers.

## Transaction model

The durable journal transition is:

```text
planned -> preflight -> running -> verify -> accepted
                                \-> failed
```

- `planned` and `preflight` authorize no mutation.
- Runtime mutation starts only after the durable `running` record.
- Images are selected only from immutable manifest references.
- Secrets, TLS material, Compose input and database initialization are staged below an operation-specific directory.
- PostgreSQL, Keycloak and MemoryV4 start first.
- UNIFY migrations and local-administrator bootstrap run as bounded jobs.
- The eight required services must all report running before acceptance.
- Failure removes the staged runtime and its volumes, removes any unaccepted state, and durably terminates the operation as `failed`.
- A retry detects a nonterminal journal and operation staging, cleans the interrupted runtime, terminates the old operation as `failed`, then begins a new operation.

## Atomic accepted state

The Cell declaration, lifecycle state and complete hash-chained journal are written to an operation-specific accepted-state staging directory. Files and directories are fsynced. One directory rename publishes the complete `accepted/` bundle atomically. D1 observation reads this bundle and retains compatibility with the original D1 flat-file layout.

The runtime release directory is prepared before accepted-state publication. A crash before atomic publication leaves no accepted pointer and is recoverable. No command reports success from a partial state/journal transition.

A same-Cell, same-release reinstall is non-mutating only after all eight services are checked again. A different Cell, release or manifest digest is rejected; update belongs to D5.

## Secret handling

The installer generates independent random values for database authorities, Keycloak bootstrap, UNIFY authentication, MemoryV4 and both framework adapters. Values are mounted read-only and are absent from:

- the install result;
- Cell declaration;
- lifecycle state;
- operation journal;
- Compose environment file;
- Caddy configuration.

A local administrator password is generated into the protected release secret directory. D2 does not accept BYOK/provider credentials; local BYOK setup belongs to D3.

## Verification

Run:

```sh
pnpm dsh:d2:verify
```

The focused verifier checks strict signed inputs, reproducible static binaries, Go vet/race tests, read-only planning, exact eight-component installation, atomic accepted publication, secret non-disclosure, no-op reinstall, failure cleanup, journal termination, production-origin rejection and signature tampering.

The checked-in D2 fixture and its deterministic key are test-only. They are deliberately not production release trust material.

## Publication gate

D2 is complete only after all first-party candidate images are publicly pullable by digest without private Aquiero credentials and the exact bytes pass installation on an isolated clean host inside the frozen platform envelope. Local builds and fake-Docker failure tests cannot satisfy that gate.
